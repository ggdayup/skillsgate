import { t } from "../lib/i18n"
import { useCallback, useEffect, useMemo, useState } from "react"
import { electronAPI } from "../lib/electron-api"
import { AgentLogo } from "../components/agent-logo"

// ---------------------------------------------------------------------------
// Core skill set — ~/.agents/skills, symlinked into every detected tool.
//
// One data source drives both views: `corePlan()` is a read-only dry run that
// yields one item per (core skill x tool). Everything below — per-tool badges
// and per-skill fan-out — is a different grouping of those same items, so the
// two panels can never disagree.
// ---------------------------------------------------------------------------

type Action = CoreSyncItem["action"]
type Busy = "plan" | "apply" | "row" | null

interface PlanCounts {
  link: number
  unlink: number
  conflict: number
  excluded: number
  present: number
}

function countPlan(items: CoreSyncItem[]): PlanCounts {
  const counts: PlanCounts = { link: 0, unlink: 0, conflict: 0, excluded: 0, present: 0 }
  for (const item of items) {
    switch (item.action) {
      case "link":
        counts.link += 1
        break
      case "unlink":
        counts.unlink += 1
        break
      case "skip-conflict":
        counts.conflict += 1
        break
      case "skip-excluded":
        counts.excluded += 1
        break
      case "skip-present":
        counts.present += 1
        break
    }
  }
  return counts
}

/** Per-skill fan-out, regrouped from the plan. */
interface SkillFanout {
  name: string
  linked: number
  pending: number
  stale: number
  conflicts: string[]
  excluded: string[]
  /** action keyed by tool id */
  byAgent: Record<string, Action>
}

function groupBySkill(items: CoreSyncItem[], coreNames: string[]): SkillFanout[] {
  const map = new Map<string, SkillFanout>()
  for (const name of coreNames) {
    map.set(name, {
      name,
      linked: 0,
      pending: 0,
      stale: 0,
      conflicts: [],
      excluded: [],
      byAgent: {},
    })
  }
  for (const item of items) {
    let entry = map.get(item.skill)
    if (!entry) {
      entry = {
        name: item.skill,
        linked: 0,
        pending: 0,
        stale: 0,
        conflicts: [],
        excluded: [],
        byAgent: {},
      }
      map.set(item.skill, entry)
    }
    entry.byAgent[item.agent] = item.action
    switch (item.action) {
      case "skip-present":
        entry.linked += 1
        break
      case "link":
        entry.pending += 1
        break
      case "unlink":
        entry.stale += 1
        break
      case "skip-conflict":
        entry.conflicts.push(item.agent)
        break
      case "skip-excluded":
        entry.excluded.push(item.agent)
        break
    }
  }
  return [...map.values()]
}

const CHIP: Record<string, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  bad: "border-red-200 bg-red-50 text-red-600",
  info: "border-border bg-surface-hover text-muted",
}

function Chip({
  tone,
  children,
}: {
  tone: keyof typeof CHIP
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${CHIP[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * `label` is already translated at the call site. Passing a raw string and
 * calling `t()` here would make every label a *dynamic* call site, which the
 * drift checker cannot resolve and reports as an orphaned key.
 */
function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div
        className={`text-lg font-semibold ${tone ?? "text-foreground"}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted mt-0.5">{label}</div>
    </div>
  )
}

export function Core() {
  const [list, setList] = useState<CoreListResult | null>(null)
  const [status, setStatus] = useState<CoreStatusEntry[]>([])
  const [summary, setSummary] = useState<CoreSummary | null>(null)
  const [items, setItems] = useState<CoreSyncItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CoreSyncResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  // Both of these delete or relocate real directories, so they arm first and
  // act on a second, distinct click. Keyed so only one row is ever armed.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [l, s, sum, plan] = await Promise.all([
      electronAPI.coreList(),
      electronAPI.coreStatus(),
      electronAPI.coreSummary(),
      electronAPI.corePlan(),
    ])
    setList(l)
    setStatus(s)
    setSummary(sum)
    setItems(plan.items)
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    refresh()
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    // Re-read after any install/removal elsewhere in the app.
    const unsubscribe = electronAPI.onSkillsUpdated(() => {
      void refresh().catch(() => undefined)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [refresh])

  const counts = useMemo(() => countPlan(items), [items])
  const fanout = useMemo(
    () => groupBySkill(items, list?.skills ?? []),
    [items, list?.skills],
  )

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return fanout
    return fanout.filter((entry) => entry.name.toLowerCase().includes(q))
  }, [fanout, query])

  const actionable = counts.link + counts.unlink

  async function runPlan() {
    setBusy("plan")
    setError(null)
    setResult(null)
    try {
      const plan = await electronAPI.corePlan()
      setItems(plan.items)
      setShowPreview(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function runApply() {
    setBusy("apply")
    setError(null)
    try {
      const { result: applied } = await electronAPI.coreSync()
      setResult(applied)
      setShowPreview(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function runRow(fn: () => Promise<unknown>) {
    setBusy("row")
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (loading && !list) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <p className="text-[12px] text-muted">{t("Loading core skills...")}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="max-w-5xl">
        {/* ---- header ---- */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-foreground mb-1">
            {t("Core Skills")}
          </h2>
          <p className="text-[12px] text-muted">
            {t("One canonical set of skills, symlinked into every detected tool. Tools can still keep their own skills on top.")}
          </p>
          {list && (
            <code className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted">
              {list.coreDir}
            </code>
          )}
        </div>

        {/* ---- summary ---- */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <Stat label={t("Core skills")} value={summary.coreCount} />
            <Stat label={t("Tools")} value={summary.agents} />
            <Stat
              label={t("Fully synced")}
              value={summary.inSync}
              tone={summary.inSync === summary.agents ? "text-emerald-600" : undefined}
            />
            <Stat
              label={t("Needs sync")}
              value={summary.needsWork}
              tone={summary.needsWork > 0 ? "text-amber-600" : undefined}
            />
            <Stat
              label={t("Conflicts")}
              value={summary.conflicts}
              tone={summary.conflicts > 0 ? "text-red-600" : undefined}
            />
          </div>
        )}

        {/* ---- sync controls ---- */}
        <div className="rounded-2xl border border-border bg-surface p-5 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">
                {t("Fan out to tools")}
              </h3>
              <p className="text-[12px] text-muted mt-1">
                {t("Creates the missing symlinks. Never overwrites a real directory — same-name conflicts are skipped and reported.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void runPlan()}
                disabled={busy !== null}
                className="rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-foreground disabled:opacity-40 hover:bg-surface-hover"
              >
                {busy === "plan" ? t("Checking...") : t("Check for changes")}
              </button>
              <button
                onClick={() => void runApply()}
                disabled={busy !== null || actionable === 0}
                className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background disabled:opacity-40"
              >
                {busy === "apply" ? t("Syncing...") : t("Sync now")}
              </button>
            </div>
          </div>

          {showPreview && (
            <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
              {actionable === 0 ? (
                <p className="text-[12px] text-emerald-700">
                  {t("Everything is already fanned out. Nothing to do.")}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {counts.link > 0 && <Chip tone="ok">{counts.link} {t("to link")}</Chip>}
                    {counts.unlink > 0 && <Chip tone="warn">{counts.unlink} {t("stale, to unlink")}</Chip>}
                    {counts.conflict > 0 && <Chip tone="bad">{counts.conflict} {t("conflicts, skipped")}</Chip>}
                    {counts.excluded > 0 && <Chip tone="info">{counts.excluded} {t("excluded")}</Chip>}
                  </div>
                  <button
                    onClick={() => void runApply()}
                    disabled={busy !== null}
                    className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background disabled:opacity-40"
                  >
                    {busy === "apply" ? t("Applying...") : t("Apply changes")}
                  </button>
                </>
              )}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-[12px] text-foreground">
                {t("Linked")} {result.linked} · {t("Unlinked")} {result.unlinked} ·{" "}
                {t("Already present")} {result.alreadyPresent} · {t("Skipped conflicts")}{" "}
                {result.skippedConflicts} · {t("Skipped excluded")}{" "}
                {result.skippedExcluded}
              </p>
              {result.failed.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {result.failed.slice(0, 5).map((f) => (
                    <li key={`${f.agent}-${f.skill}`} className="text-[11px] text-red-600">
                      {f.skill} → {f.agent}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 text-[12px] text-red-600">{error}</p>
          )}
        </div>

        {/* ---- per-tool ---- */}
        <div className="rounded-2xl border border-border bg-surface p-5 mb-6">
          <h3 className="text-[13px] font-semibold text-foreground mb-1">
            {t("Tools")}
          </h3>
          <p className="text-[12px] text-muted mb-4">
            {t("How much of the core set each tool currently has linked.")}
          </p>

          <div className="flex flex-col gap-2">
            {status.map((entry) => {
              const total = list?.count ?? 0
              const complete = entry.missing.length === 0 && entry.dangling.length === 0
              const open = openTool === entry.agent
              return (
                <div
                  key={entry.agent}
                  className="rounded-xl border border-border bg-background"
                >
                  <button
                    onClick={() => setOpenTool(open ? null : entry.agent)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    <AgentLogo name={entry.displayName} size={18} />
                    <span className="text-[13px] font-medium text-foreground flex-1">
                      {entry.displayName}
                    </span>
                    <span
                      className="text-[12px] font-mono text-muted"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {entry.linked}/{total}
                    </span>
                    {complete ? (
                      <Chip tone="ok">{t("synced")}</Chip>
                    ) : (
                      <Chip tone="warn">{entry.missing.length} {t("missing")}</Chip>
                    )}
                    {entry.dangling.length > 0 && (
                      <Chip tone="warn">{entry.dangling.length} {t("stale")}</Chip>
                    )}
                    {entry.conflicts.length > 0 && (
                      <Chip tone="bad">{entry.conflicts.length} {t("conflict")}</Chip>
                    )}
                    {entry.excluded.length > 0 && (
                      <Chip tone="info">{entry.excluded.length} {t("excluded")}</Chip>
                    )}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`text-muted transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      {entry.conflicts.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                            {t("Conflicts")} — {t("a real directory already sits at this name")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {entry.conflicts.map((name) => (
                              <button
                                key={name}
                                disabled={busy !== null}
                                onClick={() => {
                                  const key = `${entry.agent}:${name}`
                                  if (confirmReplace !== key) {
                                    setConfirmReplace(key)
                                    return
                                  }
                                  setConfirmReplace(null)
                                  void runRow(() =>
                                    electronAPI.coreReplaceConflict(name, entry.agent),
                                  )
                                }}
                                className={`rounded-md border px-2 py-1 text-[11px] disabled:opacity-40 ${
                                  confirmReplace === `${entry.agent}:${name}`
                                    ? "border-red-500 bg-red-500 text-white"
                                    : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                                }`}
                                title={t("Back up the existing directory, then link the core skill")}
                              >
                                {name} ·{" "}
                                {confirmReplace === `${entry.agent}:${name}`
                                  ? t("click again to confirm")
                                  : t("backup & link")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.excluded.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                            {t("Excluded")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {entry.excluded.map((name) => (
                              <button
                                key={name}
                                disabled={busy !== null}
                                onClick={() =>
                                  void runRow(() =>
                                    electronAPI.coreSetExclusion(entry.agent, name, false),
                                  )
                                }
                                className="rounded-md border border-border bg-surface-hover px-2 py-1 text-[11px] text-muted disabled:opacity-40 hover:text-foreground"
                                title={t("Include this skill in this tool again")}
                              >
                                {name} · {t("include")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.missing.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                            {t("Missing")} ({entry.missing.length})
                          </p>
                          <p className="text-[11px] text-muted">
                            {entry.missing.slice(0, 40).join(", ")}
                            {entry.missing.length > 40 ? " …" : ""}
                          </p>
                        </div>
                      )}

                      {entry.dangling.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                            {t("Stale links")} ({entry.dangling.length})
                          </p>
                          <p className="text-[11px] text-muted">
                            {entry.dangling.slice(0, 20).join(", ")}
                            {entry.dangling.length > 20 ? " …" : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ---- per-skill ---- */}
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h3 className="text-[13px] font-semibold text-foreground">
              {t("Core skills")}
            </h3>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Filter skills...")}
              className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground"
            />
          </div>
          <p className="text-[12px] text-muted mb-4">
            {t("Fan-out per skill. Excluding a skill removes it from one tool without touching the core set.")}
          </p>

          <div className="flex flex-col gap-2">
            {visibleSkills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                <p className="text-[12px] text-muted">
                  {t("No core skills match your search.")}
                </p>
              </div>
            ) : (
              visibleSkills.map((skill) => {
                const open = openSkill === skill.name
                const total = status.length
                return (
                  <div
                    key={skill.name}
                    className="rounded-xl border border-border bg-background"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button
                        onClick={() => setOpenSkill(open ? null : skill.name)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <span className="text-[13px] text-foreground font-mono">
                          {skill.name}
                        </span>
                        <span
                          className="text-[12px] font-mono text-muted"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {skill.linked}/{total}
                        </span>
                        {skill.pending > 0 && (
                          <Chip tone="warn">{skill.pending} {t("pending")}</Chip>
                        )}
                        {skill.stale > 0 && (
                          <Chip tone="warn">{skill.stale} {t("stale")}</Chip>
                        )}
                        {skill.conflicts.length > 0 && (
                          <Chip tone="bad">{skill.conflicts.length} {t("conflict")}</Chip>
                        )}
                        {skill.excluded.length > 0 && (
                          <Chip tone="info">{skill.excluded.length} {t("excluded")}</Chip>
                        )}
                      </button>
                      {confirmRemove === skill.name ? (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <button
                            disabled={busy !== null}
                            onClick={() => {
                              setConfirmRemove(null)
                              void runRow(() => electronAPI.coreRemove(skill.name))
                            }}
                            className="rounded-md border border-red-500 bg-red-500 px-2 py-1 text-[11px] text-white disabled:opacity-40"
                            title={t("Remove from the core set and unlink everywhere")}
                          >
                            {t("Confirm")}
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                          >
                            {t("Cancel")}
                          </button>
                        </span>
                      ) : (
                        <button
                          disabled={busy !== null}
                          onClick={() => setConfirmRemove(skill.name)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-40 hover:text-red-600 hover:border-red-200"
                          title={t("Remove from the core set and unlink everywhere")}
                        >
                          {t("Remove")}
                        </button>
                      )}
                    </div>

                    {open && (
                      <div className="px-4 pb-4 flex flex-col gap-2">
                        {status.map((entry) => {
                          const action = skill.byAgent[entry.agent]
                          const linked = action === "skip-present"
                          const excluded = action === "skip-excluded"
                          return (
                            <div
                              key={entry.agent}
                              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                            >
                              <AgentLogo name={entry.displayName} size={14} />
                              <span className="text-[12px] text-foreground flex-1">
                                {entry.displayName}
                              </span>
                              <span className="text-[11px] text-muted">
                                {action === "skip-conflict"
                                  ? t("conflict")
                                  : action === "link"
                                    ? t("missing")
                                    : action === "unlink"
                                      ? t("stale")
                                      : excluded
                                        ? t("excluded")
                                        : t("linked")}
                              </span>
                              <button
                                disabled={busy !== null}
                                onClick={() =>
                                  void runRow(() =>
                                    electronAPI.coreSetExclusion(
                                      entry.agent,
                                      skill.name,
                                      !excluded,
                                    ),
                                  )
                                }
                                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-40 hover:text-foreground hover:bg-surface-hover"
                              >
                                {excluded ? t("include") : t("exclude")}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
