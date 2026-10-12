// Relay configuration + link builders. Every relay is an independent provider: its own config, lifecycle and
// status. Nothing here couples one relay to another (bore never depends on Railway and vice versa).
//
// Tiers:
//   primary  - railway (TCP Proxy + HTTP/WS inbound), bore, playit, pinggy, ngrok, chisel, frp, rathole
//   fallback - serveo, localtonet (unreliable: only started while NO primary relay is live)

type Env = Record<string, string | undefined>

export const PRIMARY_KINDS = ["railway", "ws", "bore", "playit", "pinggy", "ngrok", "chisel", "frp", "rathole"] as const
export const FALLBACK_KINDS = ["serveo", "localtonet"] as const
export type PrimaryKind = (typeof PRIMARY_KINDS)[number]
export type FallbackKind = (typeof FALLBACK_KINDS)[number]
export type RelayKind = PrimaryKind | FallbackKind
export type RelayTier = "primary" | "fallback"

export const RELAY_LABELS: Record<RelayKind, string> = {
  railway: "Railway TCP Proxy",
  ws: "Panel domain (WebSocket, 443)",
  bore: "bore.pub",
  playit: "playit.gg",
  pinggy: "Pinggy",
  ngrok: "ngrok TCP",
  chisel: "chisel (self-hosted, HTTP/WS)",
  frp: "frp (self-hosted)",
  rathole: "rathole (self-hosted)",
  serveo: "Serveo (fallback)",
  localtonet: "LocalToNet (fallback)",
}

export const tierOf = (kind: RelayKind): RelayTier => ((FALLBACK_KINDS as readonly string[]).includes(kind) ? "fallback" : "primary")

export const PROTOCOLS = ["socks", "http", "ss"] as const
export type GatewayProtocol = (typeof PROTOCOLS)[number]
export const SS_CIPHERS = ["chacha20-ietf-poly1305", "aes-256-gcm", "aes-128-gcm"] as const
export type SsCipher = (typeof SS_CIPHERS)[number]

const truthy = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase())
const falsy = (v: string | undefined) => ["0", "false", "off", "no"].includes((v ?? "").trim().toLowerCase())

export function parsePort(value: string | undefined): number | null {
  if (!value || !value.trim()) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

function cleanHost(value: string | undefined): string | null {
  return (value ?? "").trim().replace(/\.$/, "") || null
}

function splitHostPort(value: string | undefined): { host: string; port: number | null } | null {
  const v = (value ?? "").trim().replace(/^[a-z+]+:\/\//i, "").replace(/\/.*$/, "")
  if (!v) return null
  const m = v.match(/^(.*?)(?::(\d+))?$/)
  if (!m || !m[1]) return null
  return { host: m[1], port: m[2] ? parsePort(m[2]) : null }
}

export interface RailwayConfig {
  enabled: boolean
  bindHost: string
  /** Fixed container port the gateway listens on. Must match the "port" configured in Railway's TCP Proxy. */
  bindPort: number | null
  /** Public host:port that clients use (Railway's TCP proxy domain + external port). */
  publicHost: string | null
  publicPort: number | null
  warnings: string[]
}

export interface InboundConfig {
  /** VLESS/Trojan over WebSocket behind the panel's HTTP domain (Railway edge, port 443). */
  enabled: boolean
  vless: boolean
  trojan: boolean
  /** null = derived from the share credentials (stable, unguessable). */
  path: string | null
  /** Public HTTP(S) domain of the panel (Railway injects RAILWAY_PUBLIC_DOMAIN). */
  publicHost: string | null
  publicPort: number
  tls: boolean
  warnings: string[]
}

export interface GatewayConfig {
  protocols: GatewayProtocol[]
  ssCipher: SsCipher
  /** Fixed local gateway port (needed by providers whose tunnel target is configured in a dashboard). */
  localPort: number | null
}

export interface ProviderConfig {
  kind: RelayKind
  tier: RelayTier
  enabled: boolean
  /** Why the provider is disabled / misconfigured (shown in the UI). */
  warnings: string[]
  /** Fixed public endpoint when the provider cannot report it itself. */
  publicHost: string | null
  publicPort: number | null
  /** Provider-specific options (already validated). */
  opts: Record<string, string>
  /** true = needs a fixed local gateway port (GATEWAY_PORT). */
  needsLocalPort: boolean
}

export interface RelayConfig extends RailwayConfig {
  /** SHARE_BORE=0 turns the public bore relay off. Kept for compatibility. */
  boreEnabled: boolean
  gateway: GatewayConfig
  inbound: InboundConfig
  providers: ProviderConfig[]
}

export function loadRailwayConfig(env: Env = process.env): RailwayConfig {
  const warnings: string[] = []
  let bindPort = parsePort(env.RELAY_PORT)
  if (env.RELAY_PORT && bindPort === null) warnings.push("RELAY_PORT is not a valid port (1-65535); relay disabled")
  if (bindPort === null && env.RELAY_PORT === undefined) bindPort = parsePort(env.RAILWAY_TCP_APPLICATION_PORT)

  const panelPort = parsePort(env.PORT) ?? 3000
  if (bindPort !== null && (bindPort === panelPort || bindPort === panelPort + 1)) {
    warnings.push(`RELAY_PORT ${bindPort} collides with the panel port (${panelPort}); relay disabled`)
    bindPort = null
  }

  const publicHost = cleanHost(env.RELAY_PUBLIC_HOST || env.RAILWAY_TCP_PROXY_DOMAIN)
  const publicPort = parsePort(env.RELAY_PUBLIC_PORT) ?? parsePort(env.RAILWAY_TCP_PROXY_PORT)
  if (bindPort !== null && (!publicHost || !publicPort)) {
    warnings.push("TCP Proxy host:port unknown. Enable TCP Proxy in Railway or set RELAY_PUBLIC_HOST / RELAY_PUBLIC_PORT")
  }
  return { enabled: bindPort !== null, bindHost: (env.RELAY_BIND_HOST || "0.0.0.0").trim(), bindPort, publicHost, publicPort, warnings }
}

export function loadInboundConfig(env: Env = process.env): InboundConfig {
  const warnings: string[] = []
  const kinds = (env.INBOUND_WS ?? "vless,trojan")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const off = kinds.length === 0 || kinds.includes("off") || kinds.includes("0") || falsy(env.INBOUND_WS)
  const vless = !off && kinds.includes("vless")
  const trojan = !off && kinds.includes("trojan")
  let path: string | null = null
  if (env.INBOUND_WS_PATH?.trim()) {
    const p = env.INBOUND_WS_PATH.trim()
    if (/^\/[A-Za-z0-9._~\-/]{1,120}$/.test(p) && !p.startsWith("/api/") && !p.startsWith("/_next")) path = p.replace(/\/+$/, "") || "/"
    else warnings.push("INBOUND_WS_PATH must look like /some-path (letters, digits, . _ ~ - /); using the derived path")
  }
  const publicHost = cleanHost(env.INBOUND_PUBLIC_HOST || env.RAILWAY_PUBLIC_DOMAIN || env.RENDER_EXTERNAL_HOSTNAME)
  if ((vless || trojan) && !publicHost) warnings.push("Panel HTTP domain unknown. Generate a Railway domain or set INBOUND_PUBLIC_HOST")
  const tls = !falsy(env.INBOUND_TLS)
  const publicPort = parsePort(env.INBOUND_PUBLIC_PORT) ?? (tls ? 443 : 80)
  return { enabled: vless || trojan, vless, trojan, path, publicHost, publicPort, tls, warnings }
}

export function loadGatewayConfig(env: Env = process.env): GatewayConfig {
  const list = (env.SHARE_PROTOCOLS ?? "socks,http,ss")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is GatewayProtocol => (PROTOCOLS as readonly string[]).includes(s))
  const protocols = list.length ? Array.from(new Set(list)) : ["socks" as GatewayProtocol]
  const cipher = (env.SS_CIPHER ?? "").trim().toLowerCase()
  const ssCipher = (SS_CIPHERS as readonly string[]).includes(cipher) ? (cipher as SsCipher) : "chacha20-ietf-poly1305"
  return { protocols, ssCipher, localPort: parsePort(env.GATEWAY_PORT) }
}

function provider(kind: RelayKind, enabled: boolean, extra: Partial<ProviderConfig> = {}): ProviderConfig {
  return { kind, tier: tierOf(kind), enabled, warnings: [], publicHost: null, publicPort: null, opts: {}, needsLocalPort: false, ...extra }
}

export function loadProviders(env: Env = process.env): ProviderConfig[] {
  const out: ProviderConfig[] = []

  // bore: on by default (existing behaviour), SHARE_BORE=0 disables it.
  out.push(provider("bore", !falsy(env.SHARE_BORE === undefined ? "1" : env.SHARE_BORE), { opts: { server: env.BORE_SERVER || "bore.pub" } }))

  // playit.gg: agent + secret; the tunnel (and its address) is created in the playit dashboard and must point at
  // 127.0.0.1:GATEWAY_PORT.
  {
    const secret = (env.PLAYIT_SECRET ?? "").trim()
    const pub = splitHostPort(env.PLAYIT_PUBLIC_ADDR)
    const warnings: string[] = []
    if (secret && !pub?.port) warnings.push("PLAYIT_PUBLIC_ADDR (host:port shown in the playit dashboard) is required")
    out.push(
      provider("playit", Boolean(secret) && Boolean(pub?.port), {
        warnings,
        publicHost: pub?.host ?? null,
        publicPort: pub?.port ?? null,
        opts: { secret },
        needsLocalPort: true,
      }),
    )
  }

  // Pinggy: SSH based, no binary download. PINGGY_MODE=tcp exposes the gateway; ws exposes the panel HTTP port (WS inbound).
  {
    const mode = (env.PINGGY_MODE ?? "tcp").trim().toLowerCase()
    const enabled = truthy(env.PINGGY_ENABLE) || Boolean(env.PINGGY_TOKEN?.trim())
    const warnings: string[] = []
    if (!["tcp", "tls", "ws"].includes(mode)) warnings.push("PINGGY_MODE must be tcp, tls or ws")
    out.push(
      provider("pinggy", enabled && ["tcp", "tls", "ws"].includes(mode), {
        warnings,
        opts: { mode, token: (env.PINGGY_TOKEN ?? "").trim(), host: (env.PINGGY_SERVER || "a.pinggy.io").trim() },
      }),
    )
  }

  // ngrok TCP: needs an authtoken.
  {
    const token = (env.NGROK_AUTHTOKEN ?? "").trim()
    out.push(provider("ngrok", Boolean(token), { opts: { token, region: (env.NGROK_REGION ?? "").trim() } }))
  }

  // chisel: reverse tunnel to your own server, over HTTP/WebSocket (optionally TLS / behind a CDN).
  {
    const server = (env.CHISEL_SERVER ?? "").trim()
    const remotePort = parsePort(env.CHISEL_REMOTE_PORT)
    const warnings: string[] = []
    let host = cleanHost(env.CHISEL_PUBLIC_HOST)
    if (!host && server) host = splitHostPort(server)?.host ?? null
    if (server && !/^(https?|wss?):\/\//i.test(server)) warnings.push("CHISEL_SERVER should start with https:// (or http://) so it travels over HTTP/WebSocket")
    if (server && !remotePort) warnings.push("CHISEL_REMOTE_PORT (port opened on your server) is required")
    out.push(
      provider("chisel", Boolean(server) && Boolean(remotePort), {
        warnings,
        publicHost: host,
        publicPort: remotePort,
        opts: {
          server,
          auth: (env.CHISEL_AUTH ?? "").trim(),
          fingerprint: (env.CHISEL_FINGERPRINT ?? "").trim(),
          headers: (env.CHISEL_HEADERS ?? "").trim(),
          hostHeader: (env.CHISEL_HOST_HEADER ?? "").trim(),
          tlsSkipVerify: truthy(env.CHISEL_TLS_SKIP_VERIFY) ? "1" : "",
          keepalive: (env.CHISEL_KEEPALIVE ?? "25s").trim(),
          wsRemotePort: String(parsePort(env.CHISEL_WS_REMOTE_PORT) ?? ""),
        },
      }),
    )
  }

  // frp: frpc to your own frps (TCP / websocket / wss transport).
  {
    const server = splitHostPort(env.FRP_SERVER)
    const remotePort = parsePort(env.FRP_REMOTE_PORT)
    const transport = (env.FRP_TRANSPORT ?? "websocket").trim().toLowerCase()
    const warnings: string[] = []
    if (server && !remotePort) warnings.push("FRP_REMOTE_PORT is required")
    if (!["tcp", "websocket", "wss"].includes(transport)) warnings.push("FRP_TRANSPORT must be tcp, websocket or wss")
    out.push(
      provider("frp", Boolean(server?.host) && Boolean(remotePort) && ["tcp", "websocket", "wss"].includes(transport), {
        warnings,
        publicHost: cleanHost(env.FRP_PUBLIC_HOST) ?? server?.host ?? null,
        publicPort: remotePort,
        opts: {
          serverHost: server?.host ?? "",
          serverPort: String(server?.port ?? 7000),
          token: (env.FRP_TOKEN ?? "").trim(),
          transport,
        },
      }),
    )
  }

  // rathole: client to your own rathole server. The public port is whatever the server binds for the service.
  {
    const server = splitHostPort(env.RATHOLE_SERVER)
    const pub = splitHostPort(env.RATHOLE_PUBLIC_ADDR)
    const transport = (env.RATHOLE_TRANSPORT ?? "tcp").trim().toLowerCase()
    const warnings: string[] = []
    if (server && !server.port) warnings.push("RATHOLE_SERVER must be host:port")
    if (server && !pub?.port) warnings.push("RATHOLE_PUBLIC_ADDR (host:port of the service on your server) is required")
    if (!["tcp", "noise", "websocket"].includes(transport)) warnings.push("RATHOLE_TRANSPORT must be tcp, noise or websocket")
    out.push(
      provider("rathole", Boolean(server?.port) && Boolean(pub?.port) && ["tcp", "noise", "websocket"].includes(transport), {
        warnings,
        publicHost: pub?.host ?? server?.host ?? null,
        publicPort: pub?.port ?? null,
        opts: {
          remote: server ? `${server.host}:${server.port ?? ""}` : "",
          service: (env.RATHOLE_SERVICE ?? "aether").trim() || "aether",
          token: (env.RATHOLE_TOKEN ?? "").trim(),
          transport,
          tls: truthy(env.RATHOLE_TLS) ? "1" : "",
          noisePattern: (env.RATHOLE_NOISE_PATTERN ?? "Noise_NK_25519_ChaChaPoly_BLAKE2s").trim(),
          remotePublicKey: (env.RATHOLE_REMOTE_PUBLIC_KEY ?? "").trim(),
        },
      }),
    )
  }

  // ---- fallback only (never primary) ----
  out.push(provider("serveo", truthy(env.SERVEO_ENABLE), { opts: { host: (env.SERVEO_HOST || "serveo.net").trim() } }))

  {
    const token = (env.LOCALTONET_AUTHTOKEN ?? "").trim()
    const pub = splitHostPort(env.LOCALTONET_PUBLIC_ADDR)
    const warnings: string[] = []
    if (token && !pub?.port) warnings.push("LOCALTONET_PUBLIC_ADDR (host:port shown in the LocalToNet dashboard) is required")
    out.push(
      provider("localtonet", Boolean(token) && Boolean(pub?.port), {
        warnings,
        publicHost: pub?.host ?? null,
        publicPort: pub?.port ?? null,
        opts: { token },
        needsLocalPort: true,
      }),
    )
  }
  return out
}

export function loadRelayConfig(env: Env = process.env): RelayConfig {
  const railway = loadRailwayConfig(env)
  const providers = loadProviders(env)
  return {
    ...railway,
    boreEnabled: providers.find((p) => p.kind === "bore")?.enabled ?? true,
    gateway: loadGatewayConfig(env),
    inbound: loadInboundConfig(env),
    providers,
  }
}

// ---------------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------------

export type LinkProtocol = "socks5" | "http" | "shadowsocks" | "vless-ws" | "trojan-ws"

export interface RelayLink {
  protocol: LinkProtocol
  label: string
  /** Importable URI. */
  uri: string
  /** Extra one-tap link (Telegram) when the protocol supports it. */
  extra: string | null
  /** false = the hop to the client is not encrypted by the protocol itself. */
  encrypted: boolean
}

export interface LinkInput {
  host: string
  port: number
  username: string
  password: string
  name?: string
  protocols?: GatewayProtocol[]
  ssCipher?: SsCipher
}

export interface Links {
  /** socks://BASE64(user:pass)@host:port#name (v2ray-style import link) */
  uri: string
  /** socks5://user:pass@host:port */
  uriClassic: string
  /** https://t.me/socks?server=…&port=…&user=…&pass=… */
  telegramLink: string
  /** Copy-ready block with every field and link. */
  clientBlock: string
  /** Every enabled protocol (socks5 / http / shadowsocks) for this endpoint. */
  links: RelayLink[]
}

export function shadowsocksUri(host: string, port: number, password: string, cipher: SsCipher, name: string) {
  const userinfo = Buffer.from(`${cipher}:${password}`).toString("base64url")
  return `ss://${userinfo}@${host}:${port}#${encodeURIComponent(name)}`
}

export function buildLinks({ host, port, username, password, name = "Aether", protocols = ["socks"], ssCipher = "chacha20-ietf-poly1305" }: LinkInput): Links {
  const credentials = Buffer.from(`${username}:${password}`).toString("base64")
  const uri = `socks://${encodeURIComponent(credentials)}@${host}:${port}#${name}`
  const uriClassic = `socks5://${username}:${password}@${host}:${port}`
  const q = new URLSearchParams({ server: host, port: String(port), user: username, pass: password })
  const telegramLink = `https://t.me/socks?${q.toString()}`

  const links: RelayLink[] = []
  const block: string[] = []
  if (protocols.includes("socks")) {
    links.push({ protocol: "socks5", label: "SOCKS5", uri, extra: telegramLink, encrypted: false })
    block.push("Type: SOCKS5", `Server: ${host}`, `Port: ${port}`, `Username: ${username}`, `Password: ${password}`, "", `Import: ${uri}`, `Classic: ${uriClassic}`, `Telegram: ${telegramLink}`)
  }
  if (protocols.includes("ss")) {
    const ss = shadowsocksUri(host, port, password, ssCipher, `${name}-SS`)
    links.push({ protocol: "shadowsocks", label: `Shadowsocks (${ssCipher})`, uri: ss, extra: null, encrypted: true })
    if (block.length) block.push("")
    block.push(`Shadowsocks: ${ss}`, `  cipher=${ssCipher} password=${password}`)
  }
  if (protocols.includes("http")) {
    const http = `http://${username}:${password}@${host}:${port}`
    links.push({ protocol: "http", label: "HTTP CONNECT (unencrypted)", uri: http, extra: null, encrypted: false })
    if (block.length) block.push("")
    block.push(`HTTP proxy (CONNECT, unencrypted): ${http}`)
  }
  return { uri, uriClassic, telegramLink, clientBlock: block.join("\n"), links }
}
