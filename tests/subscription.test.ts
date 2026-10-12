// End-to-end subscription tests against the mock bore: URL generation, change detection, notifications,
// fixed-port stability, the Railway TCP-proxy relay and the panel WebSocket inbound. Each test file runs in its
// own process.
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { freePort, socksLogin, startFakeUpstream, startWebhook, waitFor, type Hook } from "./helpers.ts"
import { installMockBore } from "./mock-bore.ts"

const tmp = mkdtempSync(path.join(os.tmpdir(), "aether-test-"))
const pidFile = path.join(tmp, "mock-bore.pid")
const relayPort = await freePort()

const webhook = await startWebhook()
const upstream = await startFakeUpstream()

// Everything share.ts reads at import time must be set before the dynamic import below.
process.env.TMPDIR = tmp
process.env.BORE_SERVER = "mock.bore.test"
process.env.MOCK_BORE_PIDFILE = pidFile
process.env.SHARE_USERNAME = "tester01"
process.env.SHARE_PASSWORD = "secret-pass-123"
process.env.NOTIFY_WEBHOOK_URL = webhook.url
process.env.NOTIFY_COOLDOWN_SEC = "0"
process.env.RELAY_PORT = String(relayPort)
process.env.RELAY_BIND_HOST = "127.0.0.1"
process.env.RAILWAY_TCP_PROXY_DOMAIN = "relay.proxy.test"
process.env.RAILWAY_TCP_PROXY_PORT = "45678"
process.env.RAILWAY_PUBLIC_DOMAIN = "panel.test"

const share = await import("../web/lib/share.ts")
const { buildLinks } = await import("../web/lib/relay.ts")

installMockBore(path.join(tmp, ".aether", "bin"))

const subs = () => webhook.received.filter((h: Hook) => h.event === "subscription_changed")
const killBore = () => process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL")
const relay = (id: string) => share.getShareStatus().relays.find((r) => r.id === id)!

after(async () => {
  await share.stopShare()
  await upstream.close()
  await webhook.close()
})

test("share start builds links on the mock relay and announces every relay's subscription URL", async () => {
  await share.startShare(upstream.port)
  const s = share.getShareStatus()
  assert.equal(s.phase, "on")

  const bore = relay("bore")
  assert.equal(bore.phase, "on")
  assert.equal(bore.host, "mock.bore.test")
  assert.ok(bore.port && bore.port >= 20000)

  const expected = buildLinks({ host: bore.host!, port: bore.port!, username: "tester01", password: "secret-pass-123" })
  const socks = bore.links.find((l) => l.protocol === "socks5")!
  assert.equal(socks.uri, expected.uri)
  assert.match(socks.uri, /^socks:\/\/[^@]+@mock\.bore\.test:\d+#Aether$/)
  assert.equal(socks.extra, `https://t.me/socks?server=mock.bore.test&port=${bore.port}&user=tester01&pass=secret-pass-123`)
  assert.deepEqual(bore.links.map((l) => l.protocol).sort(), ["http", "shadowsocks", "socks5"])
  assert.match(bore.links.find((l) => l.protocol === "http")!.uri, new RegExp(`^http://tester01:secret-pass-123@mock\\.bore\\.test:${bore.port}$`))
  assert.match(bore.clientBlock!, /Server: mock\.bore\.test\nPort: \d+\nUsername: tester01/)

  const railway = relay("railway")
  assert.equal(railway.phase, "on")
  assert.equal(railway.host, "relay.proxy.test")
  assert.equal(railway.port, 45678)
  assert.equal(railway.links[0].extra?.startsWith("https://t.me/socks?server=relay.proxy.test&port=45678"), true)

  const ws = relay("ws")
  assert.equal(ws.phase, "on")
  assert.deepEqual(ws.links.map((l) => l.protocol).sort(), ["trojan-ws", "vless-ws"])
  const vless = ws.links.find((l) => l.protocol === "vless-ws")!.uri
  assert.match(vless, /^vless:\/\/[0-9a-f-]{36}@panel\.test\?/)
  assert.ok(vless.includes("type=ws") && vless.includes("security=tls"))

  await waitFor(() => subs().length >= 3, 5000, "three subscription notifications")
  assert.deepEqual(new Set(subs().map((h) => h.data.relay)), new Set(["bore", "railway", "ws"]))
  assert.ok(subs().every((h) => h.data.changed === false))
})

test("the Railway relay gateway listens on the fixed port and enforces credentials", async () => {
  assert.equal(await socksLogin(relayPort, "tester01", "secret-pass-123"), 0)
  assert.equal(await socksLogin(relayPort, "tester01", "wrong-password"), 1)
})

test("a dropped bore relay reconnects on a NEW port without touching Railway", async () => {
  const before = relay("bore")
  const railwayBefore = relay("railway")
  const seen = subs().length
  killBore()
  await waitFor(() => relay("bore").phase === "reconnecting", 5000, "bore reconnecting")
  // Bore is down, Railway keeps serving and the share as a whole stays on.
  assert.equal(relay("railway").phase, "on")
  assert.equal(share.getShareStatus().phase, "on")
  assert.equal(await socksLogin(relayPort, "tester01", "secret-pass-123"), 0)

  await waitFor(() => relay("bore").phase === "on", 15_000, "bore back on")
  const after = relay("bore")
  assert.notEqual(after.port, before.port)
  assert.deepEqual(relay("railway").links, railwayBefore.links)

  await waitFor(() => subs().length > seen, 5000, "changed notification")
  const last = subs().at(-1)!
  assert.equal(last.data.relay, "bore")
  assert.equal(last.data.changed, true)
  assert.equal(last.data.uri, after.links[0].uri)
  assert.match(last.text, /Subscription URL changed/)
  assert.equal(subs().length, seen + 1) // Railway URL did not change → no extra message
})

test("with a fixed bore port the URL survives a reconnect and nothing is announced", async () => {
  await share.stopShare()
  share.saveShareSettings({ username: "tester01", password: "secret-pass-123", port: 34000, auto: false })
  await share.startShare(upstream.port)
  assert.equal(relay("bore").port, 34000)
  await waitFor(() => subs().some((h) => String(h.data.uri).includes(":34000")), 5000, "fixed-port announcement")

  const seen = subs().length
  killBore()
  await waitFor(() => relay("bore").phase === "reconnecting", 5000, "bore reconnecting")
  await waitFor(() => relay("bore").phase === "on", 15_000, "bore back on")
  assert.equal(relay("bore").port, 34000)
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(subs().length, seen)
})

test("SHARE_BORE=0 style relay-only config is rejected when no Railway relay exists", async () => {
  const { loadRelayConfig } = await import("../web/lib/relay.ts")
  const cfg = loadRelayConfig({ SHARE_BORE: "0" })
  assert.equal(cfg.boreEnabled, false)
  assert.equal(cfg.enabled, false)
})
