import "server-only"
import { createHash, timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type net from "node:net"
import type { Duplex } from "node:stream"
import { connectViaUpstream } from "./gateway"
import type { InboundConfig } from "./relay"

// VLESS / Trojan inbound over WebSocket, served on the panel's own HTTP port (so Railway's edge terminates TLS on
// 443 and forwards the WebSocket upgrade). Traffic exits through the local Aether SOCKS5. No external dependency:
// the RFC 6455 framing needed here is implemented below. TCP only (UDP/mux commands are refused).

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const MAX_FRAME = 1 << 20
const MAX_SESSIONS = 512
const PING_MS = 25_000

export interface InboundIdentity {
  uuid: string
  /** hex(sha224(password)) as Trojan sends it. */
  trojanHash: string
  path: string
}

export function deriveInbound(username: string, password: string, pathOverride: string | null): InboundIdentity {
  const h = createHash("sha256").update(`aether-vless-v1:${username}:${password}`).digest()
  h[6] = (h[6] & 0x0f) | 0x40
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString("hex")
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  const trojanHash = createHash("sha224").update(password).digest("hex")
  const path = pathOverride ?? `/ws/${createHash("sha256").update(`aether-path-v1:${password}`).digest("hex").slice(0, 12)}`
  return { uuid, trojanHash, path }
}

export interface InboundLink {
  protocol: "vless-ws" | "trojan-ws"
  label: string
  uri: string
}

export function buildInboundLinks(cfg: InboundConfig, ident: InboundIdentity, password: string, name = "Aether"): InboundLink[] {
  if (!cfg.enabled || !cfg.publicHost) return []
  const host = cfg.publicHost
  const hostPort = cfg.publicPort === (cfg.tls ? 443 : 80) ? host : `${host}:${cfg.publicPort}`
  const common = new URLSearchParams({ security: cfg.tls ? "tls" : "none", type: "ws", host, path: ident.path })
  if (cfg.tls) {
    common.set("sni", host)
    common.set("fp", "chrome")
    common.set("alpn", "http/1.1")
  }
  const out: InboundLink[] = []
  if (cfg.vless) {
    const q = new URLSearchParams({ encryption: "none", ...Object.fromEntries(common) })
    out.push({ protocol: "vless-ws", label: "VLESS + WebSocket + TLS", uri: `vless://${ident.uuid}@${hostPort}?${q.toString()}#${encodeURIComponent(`${name}-VLESS-WS`)}` })
  }
  if (cfg.trojan) {
    out.push({
      protocol: "trojan-ws",
      label: "Trojan + WebSocket + TLS",
      uri: `trojan://${encodeURIComponent(password)}@${hostPort}?${common.toString()}#${encodeURIComponent(`${name}-Trojan-WS`)}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// WebSocket framing
// ---------------------------------------------------------------------------------------------------------

interface Frame {
  fin: boolean
  opcode: number
  payload: Buffer
}

export class FrameParser {
  private buf: Buffer = Buffer.alloc(0)

  /** Returns complete frames. Throws on protocol violations (unmasked client frame, oversized frame). */
  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const frames: Frame[] = []
    for (;;) {
      const b = this.buf
      if (b.length < 2) break
      const fin = (b[0] & 0x80) !== 0
      const opcode = b[0] & 0x0f
      const masked = (b[1] & 0x80) !== 0
      let len = b[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (b.length < 4) break
        len = b.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (b.length < 10) break
        const big = b.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME)) throw new Error("frame too large")
        len = Number(big)
        off = 10
      }
      if (!masked) throw new Error("unmasked client frame")
      if (len > MAX_FRAME) throw new Error("frame too large")
      if (b.length < off + 4 + len) break
      const mask = b.subarray(off, off + 4)
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len))
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      frames.push({ fin, opcode, payload })
      this.buf = b.subarray(off + 4 + len)
    }
    return frames
  }
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length
  let head: Buffer
  if (n < 126) head = Buffer.from([0x80 | opcode, n])
  else if (n < 65536) {
    head = Buffer.alloc(4)
    head[0] = 0x80 | opcode
    head[1] = 126
    head.writeUInt16BE(n, 2)
  } else {
    head = Buffer.alloc(10)
    head[0] = 0x80 | opcode
    head[1] = 127
    head.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([head, payload])
}

// ---------------------------------------------------------------------------------------------------------
// VLESS / Trojan request headers
// ---------------------------------------------------------------------------------------------------------

export interface Target {
  host: string
  port: number
}
export type HeaderResult = { ok: true; target: Target; consumed: number; protocol: "vless" | "trojan" } | { ok: false; reason: string } | null

function ipv6(buf: Buffer) {
  const g: string[] = []
  for (let i = 0; i < 8; i++) g.push(buf.readUInt16BE(i * 2).toString(16))
  return g.join(":")
}

function eqHex(a: Buffer, hexExpected: string) {
  const b = Buffer.from(hexExpected, "latin1")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** null = need more bytes. */
export function parseRequestHeader(buf: Buffer, ident: InboundIdentity, allow: { vless: boolean; trojan: boolean }): HeaderResult {
  if (buf.length < 1) return null
  if (buf[0] === 0 && allow.vless) {
    if (buf.length < 18) return null
    const uuid = Buffer.from(ident.uuid.replace(/-/g, ""), "hex")
    if (!timingSafeEqual(buf.subarray(1, 17), uuid)) return { ok: false, reason: "bad uuid" }
    const addons = buf[17]
    let off = 18 + addons
    if (buf.length < off + 4) return null
    const cmd = buf[off]
    if (cmd !== 1) return { ok: false, reason: "only TCP is supported" }
    const port = buf.readUInt16BE(off + 1)
    const atyp = buf[off + 3]
    off += 4
    let host: string
    if (atyp === 1) {
      if (buf.length < off + 4) return null
      host = [...buf.subarray(off, off + 4)].join(".")
      off += 4
    } else if (atyp === 2) {
      if (buf.length < off + 1) return null
      const len = buf[off]
      if (len === 0) return { ok: false, reason: "empty host" }
      if (buf.length < off + 1 + len) return null
      host = buf.subarray(off + 1, off + 1 + len).toString("utf8")
      off += 1 + len
    } else if (atyp === 3) {
      if (buf.length < off + 16) return null
      host = ipv6(buf.subarray(off, off + 16))
      off += 16
    } else return { ok: false, reason: "bad address type" }
    return { ok: true, target: { host, port }, consumed: off, protocol: "vless" }
  }
  if (allow.trojan && /^[0-9a-f]$/i.test(String.fromCharCode(buf[0]))) {
    if (buf.length < 58) return null
    if (!eqHex(buf.subarray(0, 56), ident.trojanHash) || buf[56] !== 0x0d || buf[57] !== 0x0a) return { ok: false, reason: "bad password" }
    let off = 58
    if (buf.length < off + 2) return null
    if (buf[off] !== 1) return { ok: false, reason: "only CONNECT is supported" }
    const atyp = buf[off + 1]
    off += 2
    let host: string
    if (atyp === 1) {
      if (buf.length < off + 4) return null
      host = [...buf.subarray(off, off + 4)].join(".")
      off += 4
    } else if (atyp === 3) {
      if (buf.length < off + 1) return null
      const len = buf[off]
      if (len === 0) return { ok: false, reason: "empty host" }
      if (buf.length < off + 1 + len) return null
      host = buf.subarray(off + 1, off + 1 + len).toString("utf8")
      off += 1 + len
    } else if (atyp === 4) {
      if (buf.length < off + 16) return null
      host = ipv6(buf.subarray(off, off + 16))
      off += 16
    } else return { ok: false, reason: "bad address type" }
    if (buf.length < off + 4) return null
    const port = buf.readUInt16BE(off)
    if (buf[off + 2] !== 0x0d || buf[off + 3] !== 0x0a) return { ok: false, reason: "bad request" }
    return { ok: true, target: { host, port }, consumed: off + 4, protocol: "trojan" }
  }
  return { ok: false, reason: "unknown protocol" }
}

// ---------------------------------------------------------------------------------------------------------
// Upgrade handler
// ---------------------------------------------------------------------------------------------------------

export interface InboundRuntime {
  /** false while sharing is off: the path answers 404 like any unknown page. */
  active: boolean
  vless: boolean
  trojan: boolean
  ident: InboundIdentity
  upstreamPort: number | null
  /** Registers the socket in the share state (counters + closed on stop). */
  track: (socket: net.Socket) => void
  onAuthFailure: (remote: string | undefined) => Promise<void>
}

let sessions = 0

function reject(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function remoteOf(req: IncomingMessage) {
  const real = req.headers["x-real-ip"]
  if (typeof real === "string" && real) return real.trim()
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return fwd.at(-1) ?? req.socket.remoteAddress
}

/** Returns true when the request was claimed (handled or refused), false when it is not for this inbound. */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, rt: InboundRuntime | null): boolean {
  if (!rt) return false
  let url: URL
  try {
    url = new URL(req.url ?? "/", "http://localhost")
  } catch {
    return false
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/"
  if (pathname !== rt.ident.path) return false

  const upgrade = String(req.headers.upgrade ?? "").toLowerCase()
  const key = String(req.headers["sec-websocket-key"] ?? "")
  if (!rt.active || !rt.upstreamPort) {
    reject(socket, "404 Not Found")
    return true
  }
  if (req.method !== "GET" || upgrade !== "websocket" || String(req.headers["sec-websocket-version"]) !== "13" || !key) {
    reject(socket, "400 Bad Request")
    return true
  }
  if (sessions >= MAX_SESSIONS) {
    reject(socket, "503 Service Unavailable")
    return true
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64")
  const protoHeader = String(req.headers["sec-websocket-protocol"] ?? "").split(",")[0].trim()
  let early: Buffer | null = null
  if (protoHeader && url.searchParams.has("ed")) {
    // Xray-style early data: the first payload travels base64url-encoded in Sec-WebSocket-Protocol.
    try {
      early = Buffer.from(protoHeader, "base64url")
    } catch {
      early = null
    }
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n` +
      (protoHeader ? `Sec-WebSocket-Protocol: ${protoHeader}\r\n` : "") +
      "\r\n",
  )
  runSession(socket as net.Socket, head, early, rt, remoteOf(req))
  return true
}

function runSession(socket: net.Socket, head: Buffer, early: Buffer | null, rt: InboundRuntime, remote: string | undefined) {
  sessions += 1
  rt.track(socket)
  socket.setNoDelay(true)
  socket.setKeepAlive(true, 30_000)
  socket.setTimeout(0)

  const parser = new FrameParser()
  let hbuf: Buffer = Buffer.alloc(0)
  let upstream: net.Socket | null = null
  let connecting = false
  let closed = false
  let vlessReply = false
  let rejected = false
  const pending: Buffer[] = []

  const ping = setInterval(() => {
    if (!closed && !socket.destroyed) socket.write(encodeFrame(9, Buffer.alloc(0)))
  }, PING_MS)
  ping.unref?.()

  const cleanup = () => {
    if (closed) return
    closed = true
    sessions -= 1
    clearInterval(ping)
    upstream?.destroy()
    socket.destroy()
  }
  socket.on("close", cleanup)
  socket.on("error", cleanup)

  const closeWs = (code: number) => {
    if (closed || socket.destroyed) return
    const p = Buffer.alloc(2)
    p.writeUInt16BE(code)
    socket.end(encodeFrame(8, p))
  }

  const toUpstream = (data: Buffer) => {
    if (!data.length) return
    if (!upstream) {
      pending.push(data)
      return
    }
    if (!upstream.write(data)) {
      socket.pause()
      upstream.once("drain", () => socket.resume())
    }
  }

  const open = async (target: Target, firstPayload: Buffer, protocol: "vless" | "trojan") => {
    connecting = true
    try {
      const up = await connectViaUpstream(rt.upstreamPort as number, target.host, target.port)
      if (closed) return up.sock.destroy()
      upstream = up.sock
      up.sock.on("error", () => closeWs(1011))
      up.sock.on("close", () => closeWs(1000))
      up.sock.on("data", (d: Buffer | string) => {
        const chunk: Buffer = typeof d === "string" ? Buffer.from(d) : d
        if (!socket.write(encodeFrame(2, chunk))) {
          up.sock.pause()
          socket.once("drain", () => up.sock.resume())
        }
      })
      up.sock.resume()
      if (protocol === "vless" && !vlessReply) {
        vlessReply = true
        socket.write(encodeFrame(2, Buffer.from([0, 0])))
      }
      if (up.rest.length) socket.write(encodeFrame(2, up.rest))
      toUpstream(firstPayload)
      for (const p of pending.splice(0)) toUpstream(p)
    } catch {
      closeWs(1011)
    }
  }

  const onMessageBytes = (data: Buffer) => {
    if (rejected) return
    if (connecting) return toUpstream(data)
    hbuf = hbuf.length ? Buffer.concat([hbuf, data]) : data
    if (hbuf.length > 4096) return closeWs(1009)
    const res = parseRequestHeader(hbuf, rt.ident, { vless: rt.vless, trojan: rt.trojan })
    if (!res) return
    if (!res.ok) {
      void rt.onAuthFailure(remote).finally(() => closeWs(1008))
      rejected = true
      return
    }
    void open(res.target, hbuf.subarray(res.consumed), res.protocol)
  }

  const onData = (chunk: Buffer) => {
    let frames: Frame[]
    try {
      frames = parser.push(chunk)
    } catch {
      return closeWs(1002)
    }
    for (const f of frames) {
      if (f.opcode === 0 || f.opcode === 1 || f.opcode === 2) onMessageBytes(f.payload)
      else if (f.opcode === 9) socket.write(encodeFrame(10, f.payload))
      else if (f.opcode === 8) return closeWs(1000)
    }
  }

  socket.on("data", onData)
  if (early?.length) onMessageBytes(early)
  if (head.length) onData(head)
  socket.resume()
}
