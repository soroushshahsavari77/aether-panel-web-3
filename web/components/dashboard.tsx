"use client"

import { useState } from "react"
import useSWR from "swr"
import { DEFAULT_OPTIONS, type AetherStatus, type StartOptions } from "@/lib/types"
import { BestCard } from "./best-card"
import { ConnectionCard } from "./connection-card"
import { ExitCard } from "./exit-card"
import { HealthCard } from "./health-card"
import { InstallCard } from "./install-card"
import { LogsPanel } from "./logs-panel"
import { PersistenceBanner } from "./persistence-banner"
import { SettingsCard } from "./settings-card"
import { ShareCard } from "./share-card"
import { StatusPill } from "./status-pill"

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json() as Promise<AetherStatus>)

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "درخواست ناموفق بود")
  return data as T
}

export function Dashboard({ initialStatus }: { initialStatus: AetherStatus }) {
  const { data, mutate } = useSWR("/api/aether/status", fetcher, {
    fallbackData: initialStatus,
    refreshInterval: 1500,
  })
  const status = data ?? initialStatus
  const [draft, setDraft] = useState<StartOptions>(initialStatus.options ?? initialStatus.savedOptions ?? DEFAULT_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const options = status.running && status.options ? status.options : draft

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      await mutate()
      setBusy(false)
    }
  }

  const toggle = () =>
    act(() =>
      status.running ? postJson("/api/aether/stop") : postJson<AetherStatus>("/api/aether/start", draft),
    )

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" width={36} height={36} className="size-9 rounded-xl" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">Aether</h1>
            <p className="text-xs text-muted">پنل کنترل تونل (غیررسمی)</p>
          </div>
        </div>
        <StatusPill phase={status.phase} />
      </header>

      <PersistenceBanner persistence={status.persistence} />

      <main className="flex flex-col gap-4">
        {!status.binary ? (
          <InstallCard onInstall={() => act(() => postJson("/api/aether/install"))} busy={busy} />
        ) : (
          <ConnectionCard status={status} options={options} busy={busy} onToggle={toggle} />
        )}

        {actionError && (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {actionError}
          </p>
        )}

        {(status.running || status.share.phase !== "off") && (
          <ShareCard
            share={status.share}
            tunnelReady={status.phase === "connected"}
            busy={busy}
            onStart={() => act(() => postJson("/api/aether/share/start"))}
            onStop={() => act(() => postJson("/api/aether/share/stop"))}
            onSave={(settings) => act(() => postJson("/api/aether/share/settings", settings))}
          />
        )}

        {status.phase === "connected" && <ExitCard exit={status.exit} />}

        {status.binary && (
          <BestCard
            best={status.bestConfig}
            lastGood={status.lastGood}
            busy={busy}
            onStart={() => act(() => postJson("/api/aether/best"))}
            onCancel={() => act(() => postJson("/api/aether/best/cancel"))}
          />
        )}

        <SettingsCard value={options} onChange={setDraft} disabled={status.running || status.bestConfig.state === "running"} />

        <HealthCard status={status} />

        <LogsPanel logs={status.logs} />
      </main>
    </div>
  )
}
