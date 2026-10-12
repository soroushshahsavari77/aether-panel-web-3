import "server-only"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { ProviderConfig, RelayKind } from "./relay"

const run = promisify(execFile)
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

// Per-provider launch plans + a generic process launcher. This module knows nothing about share state: every
// provider is started, supervised and stopped on its own by share.ts, so one provider failing never affects another.

export interface Endpoint {
  host: string
  port: number
  scheme: "tcp" | "tls" | "https"
}

export interface TunnelContext {
  dir: string
  gatewayPort: number
  panelPort: number
  /** bore only: fixed remote port from the share settings. */
  fixedPort: number | null
}

export interface TunnelPlan {
  bin: string
  args: string[]
  env: Record<string, string>
  /** Extracts the public endpoint from the process output; null = the endpoint is static. */
  parse: ((text: string) => Endpoint | null) | null
  staticEndpoint: Endpoint | null
  /** Output that proves the tunnel is up (used with staticEndpoint). */
  ready: RegExp | null
  /** Static endpoint without a ready line is accepted after this long if the process is still alive. */
  graceMs: number
  timeoutMs: number
}

// ---------------------------------------------------------------------------------------------------------
// Binaries (downloaded on first use into <TMPDIR>/.aether/bin; override with <KIND>_BIN)
// ---------------------------------------------------------------------------------------------------------

type Archive = "raw" | "gz" | "tgz" | "zip"
interface BinSpec {
  name: string
  archive: Archive
  url: (arch: "x86_64" | "aarch64") => string
}

const V = (env: string, fallback: string) => (process.env[env] || fallback).replace(/^v/, "")

function binSpec(kind: RelayKind): BinSpec | null {
  const amd = (a: "x86_64" | "aarch64", x: string, y: string) => (a === "x86_64" ? x : y)
  switch (kind) {
    case "bore": {
      const v = process.env.BORE_VERSION || "v0.6.0"
      return { name: "bore", archive: "tgz", url: (a) => `https://github.com/ekzhang/bore/releases/download/${v}/bore-${v}-${a}-unknown-linux-musl.tar.gz` }
    }
    case "playit": {
      const v = V("PLAYIT_VERSION", "0.15.26")
      return { name: "playit", archive: "raw", url: (a) => `https://github.com/playit-cloud/playit-agent/releases/download/v${v}/playit-linux-${amd(a, "amd64", "aarch64")}` }
    }
    case "ngrok":
      return { name: "ngrok", archive: "tgz", url: (a) => `https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${amd(a, "amd64", "arm64")}.tgz` }
    case "chisel": {
      const v = V("CHISEL_VERSION", "1.10.1")
      return { name: "chisel", archive: "gz", url: (a) => `https://github.com/jpillora/chisel/releases/download/v${v}/chisel_${v}_linux_${amd(a, "amd64", "arm64")}.gz` }
    }
    case "frp": {
      const v = V("FRP_VERSION", "0.61.1")
      return { name: "frpc", archive: "tgz", url: (a) => `https://github.com/fatedier/frp/releases/download/v${v}/frp_${v}_linux_${amd(a, "amd64", "arm64")}.tar.gz` }
    }
    case "rathole": {
      const v = V("RATHOLE_VERSION", "0.5.0")
      return { name: "rathole", archive: "zip", url: (a) => `https://github.com/rapiz1/rathole/releases/download/v${v}/rathole-${amd(a, "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-musl")}.zip` }
    }
    case "localtonet":
      return { name: "localtonet", archive: "zip", url: (a) => `https://localtonet.com/download/localtonet-linux-${amd(a, "x64", "arm64")}.zip` }
    default:
      return null
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = await findFile(full, name)
      if (hit) return hit
    } else if (entry.name === name) return full
  }
  return null
}

const downloads = new Map<string, Promise<string>>()

export function ensureBinary(kind: RelayKind, dir: string): Promise<string> {
  const override = process.env[`${kind.toUpperCase()}_BIN`]
  if (override) {
    if (!existsSync(override)) return Promise.reject(new Error(`${kind.toUpperCase()}_BIN points to a missing file: ${override}`))
    return Promise.resolve(override)
  }
  const spec = binSpec(kind)
  if (!spec) return Promise.reject(new Error(`no binary for ${kind}`))
  const bin = path.join(dir, "bin", spec.name)
  if (existsSync(bin)) return Promise.resolve(bin)
  const pending = downloads.get(spec.name)
  if (pending) return pending
  const job = download(spec, bin, dir).finally(() => downloads.delete(spec.name))
  downloads.set(spec.name, job)
  return job
}

async function download(spec: BinSpec, bin: string, dir: string): Promise<string> {
  if (process.platform !== "linux") throw new Error(`${process.platform} is not supported`)
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : null
  if (!arch) throw new Error(`${process.arch} is not supported`)
  const url = spec.url(arch)
  const res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`download of ${spec.name} failed (${res.status}): ${url}`)
  const work = path.join(dir, `dl-${spec.name}`)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await mkdir(path.join(dir, "bin"), { recursive: true })
  const archive = path.join(work, "archive")
  await writeFile(archive, Buffer.from(await res.arrayBuffer()))
  try {
    if (spec.archive === "raw") await copyFile(archive, bin)
    else if (spec.archive === "gz") {
      const { stdout } = await run("gunzip", ["-c", archive], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 })
      await writeFile(bin, stdout)
    } else {
      const out = path.join(work, "out")
      await mkdir(out)
      if (spec.archive === "tgz") await run("tar", ["-xzf", archive, "-C", out])
      else await run("unzip", ["-o", "-q", archive, "-d", out])
      const found = await findFile(out, spec.name)
      if (!found) throw new Error(`${spec.name} not found inside the downloaded archive`)
      await copyFile(found, bin)
    }
    await chmod(bin, 0o755)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  return bin
}

// ---------------------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------------------

const tomlStr = (s: string) => JSON.stringify(s)
const sshBase = ["-T", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ExitOnForwardFailure=yes", "-o", "LogLevel=ERROR"]

function urlEndpoint(text: string, schemes: Endpoint["scheme"][]): Endpoint | null {
  const re = /\b(tcp|tls|https):\/\/([A-Za-z0-9.-]+)(?::(\d+))?/g
  for (const m of text.matchAll(re)) {
    const scheme = m[1] as Endpoint["scheme"]
    if (!schemes.includes(scheme)) continue
    return { host: m[2], port: m[3] ? Number(m[3]) : scheme === "https" || scheme === "tls" ? 443 : 0, scheme }
  }
  return null
}

export async function planTunnel(cfg: ProviderConfig, ctx: TunnelContext): Promise<TunnelPlan> {
  const base = { env: {} as Record<string, string>, parse: null, staticEndpoint: null, ready: null, graceMs: 10_000, timeoutMs: 25_000 }
  const staticEp = (): Endpoint => ({ host: cfg.publicHost as string, port: cfg.publicPort as number, scheme: "tcp" })

  switch (cfg.kind) {
    case "bore": {
      const bin = await ensureBinary("bore", ctx.dir)
      const args = ["local", String(ctx.gatewayPort), "--to", cfg.opts.server]
      if (ctx.fixedPort) args.push("--port", String(ctx.fixedPort))
      return {
        ...base,
        bin,
        args,
        env: { NO_COLOR: "1" },
        timeoutMs: 20_000,
        parse: (t) => {
          const m = t.match(/listening at ([^\s:]+):(\d+)/)
          return m ? { host: m[1], port: Number(m[2]), scheme: "tcp" } : null
        },
      }
    }

    case "playit": {
      if (!ctx.gatewayPort) throw new Error("playit needs a fixed local port: set GATEWAY_PORT and point the playit tunnel at 127.0.0.1:GATEWAY_PORT")
      const bin = await ensureBinary("playit", ctx.dir)
      const extra = (process.env.PLAYIT_ARGS ?? "").split(/\s+/).filter(Boolean)
      return {
        ...base,
        bin,
        args: extra.length ? extra : ["--secret", cfg.opts.secret, "--stdout"],
        env: { SECRET_KEY: cfg.opts.secret, PLAYIT_SECRET: cfg.opts.secret },
        staticEndpoint: staticEp(),
        ready: /tunnel running|agent.*(connected|running)|connected to playit/i,
      }
    }

    case "pinggy": {
      const mode = cfg.opts.mode
      const user = `${cfg.opts.token ? `${cfg.opts.token}+` : ""}${mode === "ws" ? "http" : mode}`
      const target = mode === "ws" ? ctx.panelPort : ctx.gatewayPort
      return {
        ...base,
        bin: "ssh",
        args: [...sshBase, "-p", "443", `-R0:127.0.0.1:${target}`, `${user}@${cfg.opts.host}`],
        timeoutMs: 30_000,
        parse: (t) => (mode === "ws" ? urlEndpoint(t, ["https"]) : urlEndpoint(t, mode === "tls" ? ["tls", "tcp"] : ["tcp"])),
      }
    }

    case "ngrok": {
      const bin = await ensureBinary("ngrok", ctx.dir)
      const args = ["tcp", String(ctx.gatewayPort), "--log", "stdout", "--log-format", "logfmt"]
      if (cfg.opts.region) args.push("--region", cfg.opts.region)
      return {
        ...base,
        bin,
        args,
        env: { NGROK_AUTHTOKEN: cfg.opts.token },
        parse: (t) => {
          const m = t.match(/url=tcp:\/\/([^\s:]+):(\d+)/)
          return m ? { host: m[1], port: Number(m[2]), scheme: "tcp" } : null
        },
      }
    }

    case "chisel": {
      const bin = await ensureBinary("chisel", ctx.dir)
      const o = cfg.opts
      const args = ["client", "--keepalive", o.keepalive || "25s"]
      if (o.fingerprint) args.push("--fingerprint", o.fingerprint)
      if (o.tlsSkipVerify) args.push("--tls-skip-verify")
      if (o.hostHeader) args.push("--hostname", o.hostHeader)
      for (const h of o.headers.split(",").map((s) => s.trim()).filter(Boolean)) args.push("--header", h.replace(/^([^:]+):\s*/, "$1: "))
      args.push(o.server, `R:${cfg.publicPort}:127.0.0.1:${ctx.gatewayPort}`)
      // Optionally also expose the panel's HTTP port (VLESS/Trojan WS inbound) on your server for a TLS reverse proxy.
      if (o.wsRemotePort) args.push(`R:${o.wsRemotePort}:127.0.0.1:${ctx.panelPort}`)
      return {
        ...base,
        bin,
        args,
        env: o.auth ? { AUTH: o.auth } : {},
        staticEndpoint: staticEp(),
        ready: /connected \(latency/i,
        graceMs: 15_000,
      }
    }

    case "frp": {
      const bin = await ensureBinary("frp", ctx.dir)
      const o = cfg.opts
      const file = path.join(ctx.dir, "frpc.toml")
      const lines = [
        `serverAddr = ${tomlStr(o.serverHost)}`,
        `serverPort = ${Number(o.serverPort) || 7000}`,
        `loginFailExit = false`,
        `transport.protocol = ${tomlStr(o.transport)}`,
        ...(o.token ? [`auth.method = "token"`, `auth.token = ${tomlStr(o.token)}`] : []),
        "",
        "[[proxies]]",
        `name = ${tomlStr("aether-" + cfg.publicPort)}`,
        `type = "tcp"`,
        `localIP = "127.0.0.1"`,
        `localPort = ${ctx.gatewayPort}`,
        `remotePort = ${cfg.publicPort}`,
        "",
      ]
      await mkdir(ctx.dir, { recursive: true })
      await writeFile(file, lines.join("\n"), { mode: 0o600 })
      return { ...base, bin, args: ["-c", file], staticEndpoint: staticEp(), ready: /start proxy success/i }
    }

    case "rathole": {
      const bin = await ensureBinary("rathole", ctx.dir)
      const o = cfg.opts
      const file = path.join(ctx.dir, "rathole-client.toml")
      const lines = [
        "[client]",
        `remote_addr = ${tomlStr(o.remote)}`,
        ...(o.token ? [`default_token = ${tomlStr(o.token)}`] : []),
        "",
        "[client.transport]",
        `type = ${tomlStr(o.transport)}`,
      ]
      if (o.transport === "noise") {
        lines.push("", "[client.transport.noise]", `pattern = ${tomlStr(o.noisePattern)}`)
        if (o.remotePublicKey) lines.push(`remote_public_key = ${tomlStr(o.remotePublicKey)}`)
      }
      if (o.transport === "websocket") lines.push("", "[client.transport.websocket]", `tls = ${o.tls ? "true" : "false"}`)
      lines.push("", `[client.services.${o.service || "aether"}]`, `local_addr = ${tomlStr(`127.0.0.1:${ctx.gatewayPort}`)}`, "")
      await mkdir(ctx.dir, { recursive: true })
      await writeFile(file, lines.join("\n"), { mode: 0o600 })
      return { ...base, bin, args: ["--client", file], staticEndpoint: staticEp(), ready: /control channel established/i }
    }

    case "serveo":
      return {
        ...base,
        bin: "ssh",
        args: [...sshBase, `-R0:127.0.0.1:${ctx.gatewayPort}`, cfg.opts.host],
        timeoutMs: 30_000,
        parse: (t) => {
          const m = t.match(/Forwarding TCP connections from ([^\s:]+):(\d+)/i)
          return m ? { host: m[1], port: Number(m[2]), scheme: "tcp" } : null
        },
      }

    case "localtonet": {
      if (!ctx.gatewayPort) throw new Error("LocalToNet needs a fixed local port: set GATEWAY_PORT and point the tunnel at 127.0.0.1:GATEWAY_PORT")
      const bin = await ensureBinary("localtonet", ctx.dir)
      return { ...base, bin, args: ["--authtoken", cfg.opts.token], staticEndpoint: staticEp(), ready: /connected|tunnel.*(started|running)/i }
    }

    default:
      throw new Error(`unsupported relay ${cfg.kind}`)
  }
}

// ---------------------------------------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------------------------------------

export interface LaunchHooks {
  /** The process ended. `wasReady` = it had been reported as up. */
  onExit: (info: { code: number | null; wasReady: boolean; lastLine: string }) => void
}

export interface Launched {
  proc: ChildProcess
  ready: Promise<Endpoint>
}

export function launch(plan: TunnelPlan, hooks: LaunchHooks): Launched {
  const proc = spawn(plan.bin, plan.args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...plan.env } })
  let settled = false
  let up = false
  let lastLine = ""
  let tail = ""
  let timers: ReturnType<typeof setTimeout>[] = []

  const ready = new Promise<Endpoint>((resolve, reject) => {
    const clear = () => timers.forEach(clearTimeout)
    const ok = (ep: Endpoint) => {
      if (settled) return
      settled = true
      up = true
      clear()
      resolve(ep)
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clear()
      proc.kill("SIGKILL")
      reject(err)
    }

    const onOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(ANSI, "")
      const last = text.trim().split("\n").pop()?.trim()
      if (last) lastLine = last.slice(0, 300)
      tail = (tail + text).slice(-4000)
      if (settled) return
      if (plan.parse) {
        const ep = plan.parse(tail)
        if (ep && ep.port) ok(ep)
      } else if (plan.staticEndpoint && plan.ready?.test(tail)) {
        ok(plan.staticEndpoint)
      }
    }
    proc.stdout?.on("data", onOutput)
    proc.stderr?.on("data", onOutput)

    proc.once("error", (err: NodeJS.ErrnoException) => {
      fail(new Error(err.code === "ENOENT" ? `${plan.bin} is not installed` : err.message))
    })
    proc.once("exit", (code) => {
      clear()
      if (!settled) {
        settled = true
        reject(new Error(`${path.basename(plan.bin)} exited with code ${code}${lastLine ? `: ${lastLine}` : ""}`))
      }
      hooks.onExit({ code, wasReady: up, lastLine })
    })

    if (plan.staticEndpoint) timers.push(setTimeout(() => ok(plan.staticEndpoint as Endpoint), plan.graceMs))
    else timers.push(setTimeout(() => fail(new Error(`${path.basename(plan.bin)}: no public address within ${Math.round(plan.timeoutMs / 1000)}s${lastLine ? ` (${lastLine})` : ""}`)), plan.timeoutMs))
  })
  // Avoid an unhandled rejection when the caller stops the relay while it is still starting.
  ready.catch(() => {})
  return { proc, ready }
}
