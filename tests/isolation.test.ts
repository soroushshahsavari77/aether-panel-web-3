// Bug A: bore and Railway are fully independent. Also covers provider parsing (fake `ssh`) and fallback-only relays.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { freePort, socksLogin, startFakeUpstream, waitFor } from "./helpers.ts"
import { installMockBore } from "./mock-bore.ts"

const tmp = mkdtempSync(path.join(os.tmpdir(), "aether-iso-"))
const relayPort = await freePort()
const upstream = await startFakeUpstream()

// Fake `ssh`: prints what Serveo / Pinggy print once connected.
const fakeBin = path.join(tmp, "fakebin")
mkdirSync(fakeBin)
writeFileSync(
  path.join(fakeBin, "ssh"),
  `#!/usr/bin/env node
const a = process.argv.slice(2).join(" ")
if (a.includes("serveo.test")) console.log("Forwarding TCP connections from serveo.test:5151")
else if (a.includes("pinggy.test")) console.log("tcp://rg-1-2-3-4.pinggy.test:42424")
setInterval(() => {}, 1000)
process.on("SIGTERM", () => process.exit(0))
`,
)
chmodSync(path.join(fakeBin, "ssh"), 0o755)

process.env.PATH = `${fakeBin}:${process.env.PATH}`
process.env.TMPDIR = tmp
process.env.SHARE_USERNAME = "tester01"
process.env.SHARE_PASSWORD = "secret-pass-123"
process.env.MOCK_BORE_FAIL = "1" // bore is unreachable
process.env.BORE_SERVER = "mock.bore.test"
process.env.RELAY_PORT = String(relayPort)
process.env.RELAY_BIND_HOST = "127.0.0.1"
process.env.RELAY_PUBLIC_HOST = "relay.test"
process.env.RELAY_PUBLIC_PORT = "4000"
process.env.PINGGY_ENABLE = "1"
process.env.PINGGY_SERVER = "pinggy.test"
process.env.SERVEO_ENABLE = "1"
process.env.SERVEO_HOST = "serveo.test"
process.env.INBOUND_WS = "off"
installMockBore(path.join(tmp, ".aether", "bin"))

const share = await import("../web/lib/share.ts")
const relay = (id: string) => share.getShareStatus().relays.find((r) => r.id === id)!

after(async () => {
  await share.stopShare()
  await upstream.close()
})

test("bore failing does not take Railway (or the share) down", async () => {
  await share.startShare(upstream.port) // does not throw
  assert.equal(relay("bore").phase, "error")
  assert.match(relay("bore").error!, /mock bore refused|exited/)
  assert.equal(relay("railway").phase, "on")
  assert.equal(share.getShareStatus().phase, "on")
  assert.equal(await socksLogin(relayPort, "tester01", "secret-pass-123"), 0)
})

test("a primary tunnel (Pinggy) is parsed independently of the failing one", () => {
  const p = relay("pinggy")
  assert.equal(p.phase, "on")
  assert.deepEqual([p.host, p.port], ["rg-1-2-3-4.pinggy.test", 42424])
  assert.equal(p.tier, "primary")
})

test("fallback relays (Serveo) stay in standby while any primary is live", async () => {
  assert.equal(relay("serveo").phase, "standby")
  assert.equal(relay("serveo").tier, "fallback")
  assert.equal(relay("serveo").links.length, 0)
})

test("stopping the share stops every relay", async () => {
  await share.stopShare()
  const s = share.getShareStatus()
  assert.equal(s.phase, "off")
  assert.ok(s.relays.every((r) => r.phase === "off"))
})

test("with no primary live, the fallback relay takes over", async () => {
  // Same config minus Railway and Pinggy: only a failing bore (primary) and Serveo (fallback) remain.
  const saved = { RELAY_PORT: process.env.RELAY_PORT, PINGGY_ENABLE: process.env.PINGGY_ENABLE }
  delete process.env.RELAY_PORT
  delete process.env.PINGGY_ENABLE
  try {
    await share.startShare(upstream.port)
    await waitFor(() => relay("serveo").phase === "on", 8000, "serveo fallback on")
    assert.deepEqual([relay("serveo").host, relay("serveo").port], ["serveo.test", 5151])
    assert.equal(relay("bore").phase === "error" || relay("bore").phase === "reconnecting", true)
    assert.equal(share.getShareStatus().phase, "on")
  } finally {
    await share.stopShare()
    Object.assign(process.env, saved)
  }
})
