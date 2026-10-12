// Mock `bore` client. share.ts runs `$TMPDIR/.aether/bore local <port> --to <server> [--port N]` and waits for
// "listening at host:port". The mock prints that line (random remote port unless --port is given), stays alive,
// and records its pid so tests can kill it to simulate a dropped relay.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const to = args[args.indexOf("--to") + 1] || "bore.pub"
const i = args.indexOf("--port")
const port = i >= 0 ? Number(args[i + 1]) : 20000 + Math.floor(Math.random() * 40000)
if (process.env.MOCK_BORE_PIDFILE) fs.writeFileSync(process.env.MOCK_BORE_PIDFILE, String(process.pid))
if (process.env.MOCK_BORE_FAIL === "1") { console.error("error: mock bore refused"); process.exit(1) }
console.log("INFO bore_cli::client: connected to server remote_port=" + port)
console.log("INFO bore_cli::client: listening at " + to + ":" + port)
process.on("SIGTERM", () => process.exit(0))
setInterval(() => {}, 1000)
`

export function installMockBore(aetherDir: string) {
  mkdirSync(aetherDir, { recursive: true })
  const bin = path.join(aetherDir, "bore")
  writeFileSync(bin, SCRIPT)
  chmodSync(bin, 0o755)
  return bin
}
