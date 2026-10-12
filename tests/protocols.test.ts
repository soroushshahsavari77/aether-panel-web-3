// End-to-end: SOCKS5, HTTP CONNECT and Shadowsocks AEAD on the same gateway port, plus the VLESS / Trojan
// WebSocket inbound, all exiting through a fake Aether SOCKS5 to a local echo server.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import http from "node:http"
import net from "node:net"
import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { collect, freePort, startEcho, startSocksUpstream, waitFor } from "./helpers.ts"
import { installMockBore } from "./mock-bore.ts"

const tmp = mkdtempSync(path.join(os.tmpdir(), "aether-proto-"))
const relayPort = await freePort()
const echo = await startEcho()
const upstream = await startSocksUpstream()

process.env.TMPDIR = tmp
process.env.SHARE_USERNAME = "tester01"
process.env.SHARE_PASSWORD = "secret-pass-123"
process.env.SHARE_BORE = "0"
process.env.RELAY_PORT = String(relayPort)
process.env.RELAY_BIND_HOST = "127.0.0.1"
process.env.RELAY_PUBLIC_HOST = "relay.test"
process.env.RELAY_PUBLIC_PORT = "4000"
process.env.INBOUND_PUBLIC_HOST = "panel.test"
process.env.SS_CIPHER = "chacha20-ietf-poly1305"
installMockBore(path.join(tmp, ".aether", "bin"))

const share = await import("../web/lib/share.ts")
const gw = await import("../web/lib/gateway.ts")

// The panel's HTTP server is out of scope here: wire the hook exactly as server.mjs does.
const panel = http.createServer((_req, res) => res.end("ok"))
panel.on("upgrade", (req, socket, head) => {
  const hook = (globalThis as unknown as { __aetherWsUpgrade?: (a: unknown, b: unknown, c: unknown) => boolean }).__aetherWsUpgrade
  if (!hook?.(req, socket, head)) socket.destroy()
})
await new Promise<void>((r) => panel.listen(0, "127.0.0.1", r))
const panelPort = (panel.address() as net.AddressInfo).port

await share.startShare(upstream.port)

after(async () => {
  await share.stopShare()
  panel.closeAllConnections?.()
  await new Promise<void>((r) => panel.close(() => r()))
  await echo.close()
  await upstream.close()
})

const connect = (port: number) =>
  new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1")
    s.once("connect", () => resolve(s))
    s.once("error", reject)
  })

const ipv4Addr = (port: number) => Buffer.concat([Buffer.from([1, 127, 0, 0, 1]), Buffer.from([port >> 8, port & 255])])

test("shadowsocks codec round-trips every cipher and rejects tampering", () => {
  for (const cipher of ["chacha20-ietf-poly1305", "aes-256-gcm", "aes-128-gcm"] as const) {
    const codec = gw.createSsCodec(cipher, "pw-123456")
    const enc = codec.encryptor()
    const dec = codec.decryptor()
    const big = Buffer.alloc(40_000, 7)
    const wire = Buffer.concat([enc.seal(Buffer.from("hello")), enc.seal(big)])
    // feed in awkward slices
    const out: Buffer[] = []
    for (let i = 0; i < wire.length; i += 997) out.push(...dec.feed(wire.subarray(i, i + 997)))
    assert.equal(Buffer.concat(out).length, 5 + big.length)
    assert.equal(Buffer.concat(out).subarray(0, 5).toString(), "hello")

    const bad = Buffer.from(codec.encryptor().seal(Buffer.from("x")))
    bad[bad.length - 1] ^= 1
    assert.throws(() => codec.decryptor().feed(bad))
  }
})

test("SOCKS5 with credentials reaches the target through the upstream", async () => {
  const s = await connect(relayPort)
  s.write(Buffer.from([5, 1, 2]))
  assert.deepEqual([...(await collect(s, 2))], [5, 2])
  s.write(Buffer.concat([Buffer.from([1, 8]), Buffer.from("tester01"), Buffer.from([15]), Buffer.from("secret-pass-123")]))
  assert.deepEqual([...(await collect(s, 2))], [1, 0])
  s.write(Buffer.concat([Buffer.from([5, 1, 0]), ipv4Addr(echo.port)]))
  const reply = await collect(s, 10)
  assert.equal(reply[1], 0)
  s.write("ping-socks")
  assert.equal((await collect(s, 10)).toString(), "ping-socks")
  s.destroy()
})

test("HTTP CONNECT: wrong password gets 407, right one tunnels", async () => {
  const bad = await connect(relayPort)
  bad.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: Basic ${Buffer.from("tester01:nope").toString("base64")}\r\n\r\n`)
  assert.match((await collect(bad, 12)).toString(), /^HTTP\/1\.1 407/)
  bad.destroy()

  const s = await connect(relayPort)
  s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: Basic ${Buffer.from("tester01:secret-pass-123").toString("base64")}\r\n\r\nping-http`)
  const head = await collect(s, 39 + 9)
  assert.match(head.toString(), /^HTTP\/1\.1 200 Connection Established\r\n\r\nping-http$/)
  s.destroy()
})

test("Shadowsocks AEAD on the same port tunnels, wrong key is silently dropped", async () => {
  const codec = gw.createSsCodec("chacha20-ietf-poly1305", "secret-pass-123")
  const enc = codec.encryptor()
  const dec = codec.decryptor()
  const s = await connect(relayPort)
  s.write(enc.seal(Buffer.concat([ipv4Addr(echo.port), Buffer.from("ping-ss")])))
  const got: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no ss reply")), 5000)
    s.on("data", (d) => {
      got.push(...dec.feed(d))
      if (Buffer.concat(got).length >= 7) {
        clearTimeout(t)
        resolve()
      }
    })
  })
  assert.equal(Buffer.concat(got).toString(), "ping-ss")
  s.destroy()

  const wrong = gw.createSsCodec("chacha20-ietf-poly1305", "other-password").encryptor()
  const w = await connect(relayPort)
  w.on("error", () => {})
  w.write(wrong.seal(Buffer.concat([ipv4Addr(echo.port), Buffer.from("x")])))
  const reply = await collect(w, 1, 3000).catch(() => Buffer.alloc(0))
  assert.equal(reply.length, 0) // no bytes ever come back to a prober
  w.destroy()
})

// ---- WebSocket inbound ----------------------------------------------------------------------------------

function wsLinkParts(proto: "vless-ws" | "trojan-ws") {
  const ws = share.getShareStatus().relays.find((r) => r.id === "ws")!
  const uri = new URL(ws.links.find((l) => l.protocol === proto)!.uri)
  return { uri, path: uri.searchParams.get("path")! }
}

function wsRoundTrip(pathName: string, firstMessage: Buffer, expectBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${panelPort}${pathName}`)
    sock.binaryType = "arraybuffer"
    let got = Buffer.alloc(0)
    const t = setTimeout(() => {
      sock.close()
      resolve(got)
    }, expectBytes === 0 ? 1500 : 5000)
    sock.onopen = () => sock.send(firstMessage)
    sock.onmessage = (ev) => {
      got = Buffer.concat([got, Buffer.from(ev.data as ArrayBuffer)])
      if (expectBytes && got.length >= expectBytes) {
        clearTimeout(t)
        sock.close()
        resolve(got)
      }
    }
    sock.onerror = () => {
      clearTimeout(t)
      resolve(got)
    }
    sock.onclose = () => {
      clearTimeout(t)
      resolve(got)
    }
  })
}

test("VLESS over WebSocket: valid uuid tunnels (response header + echo), wrong uuid gets nothing", async () => {
  const { uri, path: p } = wsLinkParts("vless-ws")
  const uuid = Buffer.from(uri.username.replace(/-/g, ""), "hex")
  const port = Buffer.from([echo.port >> 8, echo.port & 255])
  const header = Buffer.concat([Buffer.from([0]), uuid, Buffer.from([0, 1]), port, Buffer.from([1, 127, 0, 0, 1]), Buffer.from("ping-vless")])
  const got = await wsRoundTrip(p, header, 2 + 10)
  assert.deepEqual([...got.subarray(0, 2)], [0, 0])
  assert.equal(got.subarray(2).toString(), "ping-vless")

  const wrong = Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 1), Buffer.from([0, 1]), port, Buffer.from([1, 127, 0, 0, 1]), Buffer.from("x")])
  assert.equal((await wsRoundTrip(p, wrong, 0)).length, 0)
})

test("Trojan over WebSocket: valid password tunnels, wrong one gets nothing", async () => {
  const { p } = { p: wsLinkParts("trojan-ws").path }
  const hash = (pw: string) => Buffer.from(createHash("sha224").update(pw).digest("hex"))
  const port = Buffer.from([echo.port >> 8, echo.port & 255])
  const req = (pw: string, payload: string) => Buffer.concat([hash(pw), Buffer.from("\r\n"), Buffer.from([1, 1, 127, 0, 0, 1]), port, Buffer.from("\r\n"), Buffer.from(payload)])
  const got = await wsRoundTrip(p, req("secret-pass-123", "ping-trojan"), 11)
  assert.equal(got.toString(), "ping-trojan")
  assert.equal((await wsRoundTrip(p, req("wrong-pass", "x"), 0)).length, 0)
})

test("the WebSocket path answers 404 while sharing is off and unknown paths are not claimed", async () => {
  const { path: p } = wsLinkParts("vless-ws")
  const hook = (globalThis as unknown as { __aetherWsUpgrade: (a: unknown, b: unknown, c: unknown) => boolean }).__aetherWsUpgrade
  // not our path -> not claimed
  const fake = { url: "/somewhere-else", headers: {}, method: "GET" }
  const sock = { end() {}, write() {}, destroy() {} }
  assert.equal(hook(fake, sock, Buffer.alloc(0)), false)

  await share.stopShare()
  const res = await new Promise<string>((resolve) => {
    const s = net.connect(panelPort, "127.0.0.1", () => {
      s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    let buf = ""
    s.on("data", (d) => (buf += d))
    s.on("close", () => resolve(buf))
  })
  assert.match(res, /^HTTP\/1\.1 404/)
  await waitFor(() => share.getShareStatus().phase === "off", 2000, "share off")
})
