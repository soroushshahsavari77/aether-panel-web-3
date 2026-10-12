import assert from "node:assert/strict"
import { test } from "node:test"
import { detectPersistence, findMount } from "../web/lib/config-store.ts"
import { createNotifier, loadNotifierConfig } from "../web/lib/notifier.ts"
import { backoffMs, RateLimiter } from "../web/lib/ratelimit.ts"
import { buildLinks, loadRelayConfig } from "../web/lib/relay.ts"
import { parseBestRequest } from "../web/lib/bestconfig.ts"

test("relay config: Railway variables, overrides and collisions", () => {
  const cfg = loadRelayConfig({
    RELAY_PORT: "1080",
    RAILWAY_TCP_PROXY_DOMAIN: "x.proxy.rlwy.net.",
    RAILWAY_TCP_PROXY_PORT: "12345",
  })
  assert.deepEqual([cfg.enabled, cfg.bindPort, cfg.publicHost, cfg.publicPort, cfg.bindHost], [true, 1080, "x.proxy.rlwy.net", 12345, "0.0.0.0"])
  assert.equal(loadRelayConfig({ RAILWAY_TCP_APPLICATION_PORT: "7000" }).bindPort, 7000)
  assert.equal(loadRelayConfig({ RELAY_PORT: "3000", PORT: "3000" }).enabled, false)
  assert.equal(loadRelayConfig({ RELAY_PORT: "abc" }).enabled, false)
  assert.equal(loadRelayConfig({}).enabled, false)
  assert.ok(loadRelayConfig({ RELAY_PORT: "1080" }).warnings[0].includes("TCP Proxy"))
})

test("links: classic, import and Telegram formats", () => {
  const l = buildLinks({ host: "h.example", port: 99, username: "user1", password: "pass~word.1" })
  assert.equal(l.uriClassic, "socks5://user1:pass~word.1@h.example:99")
  assert.equal(l.telegramLink, "https://t.me/socks?server=h.example&port=99&user=user1&pass=pass%7Eword.1")
  assert.equal(l.uri, `socks://${encodeURIComponent(Buffer.from("user1:pass~word.1").toString("base64"))}@h.example:99#Aether`)
})

test("rate limiter: window, block, reset, key cap", () => {
  let now = 0
  const rl = new RateLimiter({ max: 2, windowMs: 1000, blockMs: 5000, now: () => now, maxKeys: 3 })
  assert.equal(rl.hit("a").allowed, true)
  assert.equal(rl.hit("a").allowed, true)
  const third = rl.hit("a")
  assert.equal(third.allowed, false)
  assert.equal(third.retryAfterMs, 5000)
  now = 4000
  assert.equal(rl.check("a").allowed, false)
  now = 6000
  assert.equal(rl.check("a").allowed, true)
  rl.hit("b"); rl.hit("c"); rl.hit("d"); rl.hit("e")
  assert.ok(rl.size <= 3)
  rl.reset("e")
  assert.equal(rl.check("e").count, 0)
})

test("exponential backoff is capped", () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => backoffMs(n, 2000, 300000)), [2000, 4000, 8000, 16000])
  assert.equal(backoffMs(20, 2000, 300000), 300000)
})

test("notifier: channels, event filter, cooldown, redaction", async () => {
  const calls: { url: string; body: any }[] = []
  let fail = false
  const fakeFetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return fail ? new Response("no", { status: 500 }) : new Response("ok")
  }) as unknown as typeof fetch
  let now = 1_000_000
  const env = {
    NOTIFY_WEBHOOK_URL: "https://hooks.example/h",
    NOTIFY_TELEGRAM_BOT_TOKEN: "123:SECRET",
    NOTIFY_TELEGRAM_CHAT_ID: "42",
    NOTIFY_EVENTS: "tunnel_down,relay_error",
    NOTIFY_COOLDOWN_SEC: "60",
  }
  const n = createNotifier(() => loadNotifierConfig(env), { fetch: fakeFetch, now: () => now })

  const first = await n.notify("tunnel_down", "down!")
  assert.deepEqual(first.sent.sort(), ["telegram", "webhook"])
  const tg = calls.find((c) => c.url.includes("/bot123:SECRET/sendMessage"))!
  assert.deepEqual([tg.body.chat_id, tg.body.text], ["42", "down!"])
  assert.equal(calls.find((c) => c.url === "https://hooks.example/h")!.body.event, "tunnel_down")

  assert.equal((await n.notify("tunnel_down", "again")).skipped, "cooldown")
  assert.equal((await n.notify("tunnel_down", "other key", { key: "k2" })).skipped, null)
  assert.equal((await n.notify("subscription_changed", "x")).skipped, "event-disabled")
  now += 61_000
  assert.equal((await n.notify("tunnel_down", "later")).skipped, null)

  fail = true
  const bad = await n.notify("relay_error", "boom")
  assert.equal(bad.sent.length, 0)
  assert.ok(bad.errors.every((e) => !e.includes("SECRET")))

  const none = createNotifier(() => loadNotifierConfig({}), { fetch: fakeFetch })
  assert.equal((await none.notify("tunnel_down", "x")).skipped, "no-channel")
})

test("persistence detection from mountinfo", () => {
  const info = [
    "22 1 0:21 / / rw,relatime - overlay overlay rw,lowerdir=/x",
    "40 22 8:1 / /data rw,relatime - ext4 /dev/sda1 rw",
    "41 22 0:30 / /tmp rw,nosuid - tmpfs tmpfs rw",
  ].join("\n")
  assert.equal(findMount(info, "/data/tmp/.aether")?.mountPoint, "/data")
  const dir = (d: string, env = {}) => detectPersistence({ dir: d, mountinfo: info, env })
  assert.equal(dir("/data/tmp/.aether").persistent, true)
  assert.equal(dir("/var/tmp/.aether").persistent, false) // overlay root
  assert.equal(dir("/tmp/.aether").persistent, false) // tmpfs
  assert.equal(dir("/tmp/.aether", { PERSISTENCE_OK: "1" }).persistent, true)
  assert.equal(dir("/vol/x/.aether", { RAILWAY_VOLUME_MOUNT_PATH: "/vol" }).persistent, true)
  assert.equal(detectPersistence({ dir: "/x", mountinfo: null, env: {} }).persistent, null)
})

test("best-config request parsing keeps only valid values", () => {
  const r = parseBestRequest({ protocols: ["masque", "nope"], scans: ["ironclad"] })
  assert.deepEqual(r.protocols, ["masque"])
  assert.deepEqual(r.scans, ["ironclad"])
  assert.deepEqual(parseBestRequest(null).scans, ["turbo", "balanced"])
})

test("relay providers: tiers, required variables and fallback-only relays", async () => {
  const { loadProviders, loadInboundConfig, loadGatewayConfig, tierOf } = await import("../web/lib/relay.ts")
  const get = (env: Record<string, string>, kind: string) => loadProviders(env).find((p) => p.kind === kind)!

  assert.equal(get({}, "bore").enabled, true)
  assert.equal(get({ SHARE_BORE: "0" }, "bore").enabled, false)
  assert.equal(get({}, "serveo").enabled, false)
  assert.equal(get({ SERVEO_ENABLE: "1" }, "serveo").tier, "fallback")
  assert.equal(tierOf("localtonet"), "fallback")
  assert.equal(tierOf("chisel"), "primary")
  assert.equal(tierOf("ws"), "primary")

  // playit / localtonet need the dashboard-assigned address
  assert.equal(get({ PLAYIT_SECRET: "s" }, "playit").enabled, false)
  const playit = get({ PLAYIT_SECRET: "s", PLAYIT_PUBLIC_ADDR: "abc.gl.at.ply.gg:1234" }, "playit")
  assert.deepEqual([playit.enabled, playit.publicHost, playit.publicPort, playit.needsLocalPort], [true, "abc.gl.at.ply.gg", 1234, true])

  // chisel: HTTP(S) server URL + remote port; public host defaults to the server host
  const chisel = get({ CHISEL_SERVER: "https://edge.example.com:443", CHISEL_REMOTE_PORT: "8443", CHISEL_AUTH: "u:p" }, "chisel")
  assert.deepEqual([chisel.enabled, chisel.publicHost, chisel.publicPort], [true, "edge.example.com", 8443])
  assert.ok(get({ CHISEL_SERVER: "edge.example.com:80", CHISEL_REMOTE_PORT: "1" }, "chisel").warnings.some((w) => w.includes("https://")))
  assert.equal(get({ CHISEL_SERVER: "https://x" }, "chisel").enabled, false)

  assert.equal(get({ FRP_SERVER: "1.2.3.4:7000", FRP_REMOTE_PORT: "6000" }, "frp").enabled, true)
  assert.equal(get({ FRP_SERVER: "1.2.3.4", FRP_REMOTE_PORT: "6000", FRP_TRANSPORT: "quic" }, "frp").enabled, false)
  assert.equal(get({ RATHOLE_SERVER: "1.2.3.4:2333", RATHOLE_PUBLIC_ADDR: "1.2.3.4:5000" }, "rathole").enabled, true)
  assert.equal(get({ NGROK_AUTHTOKEN: "t" }, "ngrok").enabled, true)
  assert.equal(get({ PINGGY_TOKEN: "t", PINGGY_MODE: "bogus" }, "pinggy").enabled, false)

  // inbound + gateway
  const inbound = loadInboundConfig({ RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })
  assert.deepEqual([inbound.enabled, inbound.vless, inbound.trojan, inbound.publicHost, inbound.publicPort, inbound.tls], [true, true, true, "x.up.railway.app", 443, true])
  assert.equal(loadInboundConfig({ INBOUND_WS: "off" }).enabled, false)
  assert.equal(loadInboundConfig({ INBOUND_WS: "trojan" }).vless, false)
  assert.equal(loadInboundConfig({ INBOUND_WS_PATH: "/api/x" }).path, null)
  assert.equal(loadInboundConfig({ INBOUND_WS_PATH: "/tunnel/" }).path, "/tunnel")
  assert.deepEqual(loadGatewayConfig({}).protocols, ["socks", "http", "ss"])
  assert.deepEqual(loadGatewayConfig({ SHARE_PROTOCOLS: "ss", SS_CIPHER: "aes-256-gcm" }).protocols, ["ss"])
  assert.equal(loadGatewayConfig({ SS_CIPHER: "rc4" }).ssCipher, "chacha20-ietf-poly1305")
})

test("links: Shadowsocks SIP002 + HTTP formats, protocol filter", () => {
  const l = buildLinks({ host: "h.example", port: 99, username: "user1", password: "pass1234", protocols: ["ss", "http"], ssCipher: "aes-256-gcm", name: "N" })
  const ss = l.links.find((x) => x.protocol === "shadowsocks")!
  assert.equal(ss.uri, `ss://${Buffer.from("aes-256-gcm:pass1234").toString("base64url")}@h.example:99#N-SS`)
  assert.equal(ss.encrypted, true)
  const http = l.links.find((x) => x.protocol === "http")!
  assert.equal(http.uri, "http://user1:pass1234@h.example:99")
  assert.equal(http.encrypted, false)
  assert.equal(l.links.some((x) => x.protocol === "socks5"), false)
})

test("inbound: identity is stable, links are importable, request headers parse", async () => {
  const { deriveInbound, buildInboundLinks, parseRequestHeader, FrameParser, encodeFrame } = await import("../web/lib/inbound.ts")
  const a = deriveInbound("u", "password1", null)
  assert.deepEqual(a, deriveInbound("u", "password1", null))
  assert.notEqual(a.uuid, deriveInbound("u", "password2", null).uuid)
  assert.match(a.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(a.path, /^\/ws\/[0-9a-f]{12}$/)
  assert.equal(a.trojanHash.length, 56)

  const cfg = { enabled: true, vless: true, trojan: true, path: null, publicHost: "p.example", publicPort: 443, tls: true, warnings: [] }
  const links = buildInboundLinks(cfg, a, "password1")
  assert.equal(links.length, 2)
  assert.ok(links[1].uri.startsWith("trojan://password1@p.example?"))
  assert.deepEqual(buildInboundLinks({ ...cfg, publicHost: null }, a, "password1"), [])

  // incomplete header = need more bytes
  const vless = Buffer.concat([Buffer.from([0]), Buffer.from(a.uuid.replace(/-/g, ""), "hex"), Buffer.from([0, 1, 1, 187, 2, 11]), Buffer.from("example.com")])
  assert.equal(parseRequestHeader(vless.subarray(0, 25), a, { vless: true, trojan: true }), null)
  const ok = parseRequestHeader(vless, a, { vless: true, trojan: true })
  assert.deepEqual(ok && ok.ok && ok.target, { host: "example.com", port: 443 })
  assert.equal(parseRequestHeader(vless, a, { vless: false, trojan: true })?.ok, false)

  // frames: masked client frame in, unmasked server frame out
  const payload = Buffer.from("hi")
  const mask = Buffer.from([1, 2, 3, 4])
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))
  const frames = new FrameParser().push(Buffer.concat([Buffer.from([0x82, 0x80 | 2]), mask, masked]))
  assert.equal(frames[0].payload.toString(), "hi")
  assert.throws(() => new FrameParser().push(Buffer.from([0x82, 2, 1, 2])))
  assert.deepEqual([...encodeFrame(2, payload)], [0x82, 2, 104, 105])
  assert.equal(encodeFrame(2, Buffer.alloc(300))[1], 126)
})
