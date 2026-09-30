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
  phantom?: boolean
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
      phantom: false,
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
        phantom: true,
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

interface RemoveCoreSkillsDialogProps {
  skillNames: string[]
  busy: boolean
  onClose: () => void
  onConfirm: (mode: "detach" | "purge") => Promise<void>
}

function RemoveCoreSkillsDialog({
  skillNames,
  busy,
  onClose,
  onConfirm,
}: RemoveCoreSkillsDialogProps) {
  const [mode, setMode] = useState<"detach" | "purge">("detach")
  const isMultiple = skillNames.length > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-foreground mb-1">
          {isMultiple ? t("Remove core skills in batch") : t("Remove core skill")}
        </h3>
        <p className="text-[12px] text-muted mb-4">
          <span className="font-semibold text-foreground mr-1.5">
            {isMultiple ? `${skillNames.length} ${t("skills")}` : `${skillNames[0]}.`}
          </span>
          <span>
            {isMultiple
              ? t("Choose how you want to handle these skills and their underlying files.")
              : t("Choose how you want to handle this skill and its underlying files.")}
          </span>
        </p>

        <div className="space-y-2.5 text-[12px] text-foreground mb-5">
          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              mode === "detach"
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:border-foreground/30"
            }`}
          >
            <input
              type="radio"
              name="coreRemoveMode"
              checked={mode === "detach"}
              onChange={() => setMode("detach")}
              className="mt-0.5 accent-primary"
            />
            <div>
              <span className="font-semibold block text-foreground">
                {t("Remove from Core only (Preserve in library / store)")}
              </span>
              <span className="text-[11px] text-muted block mt-0.5">
                {t(
                  "Unlinks from Core and all connected AI tools. The skill files are preserved in your local store or skills library, and can be re-added to Core at any time.",
                )}
              </span>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              mode === "purge"
                ? "border-red-500 bg-red-500/5"
                : "border-border bg-background hover:border-foreground/30"
            }`}
          >
            <input
              type="radio"
              name="coreRemoveMode"
              checked={mode === "purge"}
              onChange={() => setMode("purge")}
              className="mt-0.5 accent-red-600"
            />
            <div>
              <span className="font-semibold block text-red-600">
                {t("Delete completely from disk")}
              </span>
              <span className="text-[11px] text-muted block mt-0.5">
                {isMultiple
                  ? t(
                      "Permanently deletes these skills from Core, Store, skills library, and all tool directories. This action cannot be undone.",
                    )
                  : t(
                      "Permanently deletes this skill from Core, Store, skills library, and all tool directories. This action cannot be undone.",
                    )}
              </span>
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border bg-background px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface disabled:opacity-40"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(mode)}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40 ${
              mode === "purge"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-primary hover:bg-primary/90"
            }`}
          >
            {mode === "purge"
              ? isMultiple
                ? `${t("Delete permanently")} (${skillNames.length})`
                : t("Delete permanently")
              : isMultiple
              ? `${t("Remove from Core")} (${skillNames.length})`
              : t("Remove from Core")}
          </button>
        </div>
      </div>
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
  const [selectedSourceFilter, setSelectedSourceFilter] = useState("all")
  const [selectedSkillNames, setSelectedSkillNames] = useState<Set<string>>(new Set())
  // Target skills for removal (single or batch)
  const [removeTargetSkills, setRemoveTargetSkills] = useState<string[] | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null)
  // Row actions happen far below the header card, so their failure has to be
  // rendered next to the row — a header-only banner reads as "nothing happened".
  const [rowError, setRowError] = useState<{ key: string; msg: string } | null>(null)

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

  const sources = useMemo(() => list?.sources ?? {}, [list?.sources])

  interface SourceOption {
    value: string
    label: string
    count: number
  }

  const sourceOptions = useMemo(() => {
    const countsByGroup = new Map<string, number>()
    const countsByRepo = new Map<string, number>()
    const countsByType = new Map<string, number>()

    for (const src of Object.values(sources)) {
      countsByGroup.set(src.label, (countsByGroup.get(src.label) || 0) + 1)
      if (src.type === "git" && src.repoDisplayName) {
        countsByRepo.set(src.repoDisplayName, (countsByRepo.get(src.repoDisplayName) || 0) + 1)
      } else {
        countsByType.set(src.type, (countsByType.get(src.type) || 0) + 1)
      }
    }

    const options: SourceOption[] = [
      { value: "all", label: `${t("All sources")} (${list?.count ?? 0})`, count: list?.count ?? 0 },
    ]

    const sortedRepos = [...countsByRepo.keys()].sort()
    for (const repo of sortedRepos) {
      const repoCount = countsByRepo.get(repo) || 0
      options.push({
        value: `repo:${repo}`,
        label: `${repo} (${repoCount})`,
        count: repoCount,
      })

      for (const [label, count] of countsByGroup.entries()) {
        if (label.startsWith(`${repo} / `)) {
          options.push({
            value: `label:${label}`,
            label: `  ↳ ${label} (${count})`,
            count,
          })
        }
      }
    }

    if (countsByType.has("store")) {
      const count = countsByType.get("store")!
      options.push({ value: "type:store", label: `${t("Store")} (${count})`, count })
    }
    if (countsByType.has("core-native")) {
      const count = countsByType.get("core-native")!
      options.push({ value: "type:core-native", label: `${t("Core (Native)")} (${count})`, count })
    }
    if (countsByType.has("local-path")) {
      const count = countsByType.get("local-path")!
      options.push({ value: "type:local-path", label: `${t("Local Path")} (${count})`, count })
    }

    return options
  }, [sources, list?.count])

  const visibleSkills = useMemo(() => {
    let result = fanout
    const q = query.trim().toLowerCase()
    if (q) {
      result = result.filter((entry) => entry.name.toLowerCase().includes(q))
    }
    if (selectedSourceFilter !== "all") {
      if (selectedSourceFilter.startsWith("repo:")) {
        const repo = selectedSourceFilter.slice(5)
        result = result.filter((entry) => sources[entry.name]?.repoDisplayName === repo)
      } else if (selectedSourceFilter.startsWith("label:")) {
        const label = selectedSourceFilter.slice(6)
        result = result.filter((entry) => sources[entry.name]?.label === label)
      } else if (selectedSourceFilter.startsWith("type:")) {
        const type = selectedSourceFilter.slice(5)
        result = result.filter((entry) => sources[entry.name]?.type === type)
      }
    }
    return result
  }, [fanout, query, selectedSourceFilter, sources])

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

  async function runRow(fn: () => Promise<unknown>, key = "row") {
    setBusy("row")
    setError(null)
    setRowError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRowError({ key, msg })
      setError(msg)
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

        {/* ---- dangling entries: core symlinks whose source moved away ---- */}
        {list && list.danglingEntries.length > 0 && (
          <div className="rounded-2xl border border-amber-600/40 bg-amber-600/5 p-5 mb-6">
            <h3 className="text-[13px] font-semibold text-foreground">
              {t("Broken links in Core")} ({list.danglingEntries.length})
            </h3>
            <p className="text-[12px] text-muted mt-1 mb-2">
              {t("These core entries symlink to a folder that no longer exists. Re-add the skill by its new path, or remove the dead link.")}
            </p>
            <ul className="space-y-1">
              {list.danglingEntries.map((d) => (
                <li key={d.name} className="flex items-center gap-2 text-[12px]">
                  <span className="font-mono text-foreground">{d.name}</span>
                  <span className="text-muted truncate">{d.pointsTo}</span>
                  <button
                    onClick={() =>
                      void runRow(
                        () => electronAPI.coreRemove(d.name, "detach"),
                        `dangling:${d.name}`,
                      )
                    }
                    disabled={busy !== null}
                    className="ml-auto shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:text-red-400 disabled:opacity-40"
                  >
                    {t("Remove")}
                  </button>
                  {rowError?.key === `dangling:${d.name}` && (
                    <span className="shrink-0 text-[11px] text-red-600">
                      {rowError.msg}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">
                {t("Core skills")}
              </h3>
              <p className="text-[12px] text-muted mt-0.5">
                {t("Fan-out per skill. Excluding a skill removes it from one tool without touching the core set.")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Source filter dropdown */}
              <select
                value={selectedSourceFilter}
                onChange={(e) => {
                  setSelectedSourceFilter(e.target.value)
                  setSelectedSkillNames(new Set())
                }}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-foreground/40 max-w-[260px] truncate"
                title={t("Filter by source")}
              >
                {sourceOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Search input */}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Filter skills...")}
                className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-foreground/40"
              />
            </div>
          </div>

          {/* Batch operations toolbar */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-border bg-background mb-3 text-[12px]">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={visibleSkills.length > 0 && visibleSkills.every((s) => selectedSkillNames.has(s.name))}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedSkillNames(new Set(visibleSkills.map((s) => s.name)))
                  } else {
                    setSelectedSkillNames(new Set())
                  }
                }}
                disabled={visibleSkills.length === 0}
                className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                title={t("Select all visible")}
              />
              <span className="text-muted">
                {selectedSkillNames.size > 0 ? (
                  <span className="font-medium text-foreground">
                    {t("Selected")} {selectedSkillNames.size} / {visibleSkills.length}
                  </span>
                ) : (
                  <span>
                    {t("Showing")} {visibleSkills.length} {t("skills")}
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {selectedSkillNames.size > 0 ? (
                <>
                  <button
                    onClick={() => setSelectedSkillNames(new Set())}
                    className="text-muted hover:text-foreground px-2 py-1 text-[11px]"
                  >
                    {t("Clear selection")}
                  </button>
                  <button
                    onClick={() => setRemoveTargetSkills([...selectedSkillNames])}
                    disabled={busy !== null}
                    className="rounded-lg bg-red-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    {t("Batch remove from Core")} ({selectedSkillNames.size})
                  </button>
                </>
              ) : selectedSourceFilter !== "all" && visibleSkills.length > 0 ? (
                <button
                  onClick={() => setRemoveTargetSkills(visibleSkills.map((s) => s.name))}
                  disabled={busy !== null}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-40"
                >
                  {t("Remove all from this source")} ({visibleSkills.length})
                </button>
              ) : null}
            </div>
          </div>

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
                const skillSource = sources[skill.name]
                return (
                  <div
                    key={skill.name}
                    className={`rounded-xl border ${
                      skill.phantom
                        ? "border-amber-600/30 bg-amber-600/5"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSkillNames.has(skill.name)}
                        onChange={(e) => {
                          const next = new Set(selectedSkillNames)
                          if (e.target.checked) next.add(skill.name)
                          else next.delete(skill.name)
                          setSelectedSkillNames(next)
                        }}
                        className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                      />
                      <button
                        onClick={() => setOpenSkill(open ? null : skill.name)}
                        className="flex items-center gap-3 flex-1 text-left min-w-0"
                      >
                        <span className="text-[13px] text-foreground font-mono shrink-0">
                          {skill.name}
                        </span>
                        {skillSource && (
                          <span
                            className="text-[10px] font-mono px-2 py-0.5 rounded border border-border/80 bg-surface/80 text-muted truncate max-w-[220px]"
                            title={skillSource.label}
                          >
                            {skillSource.label}
                          </span>
                        )}
                        <span
                          className="text-[12px] font-mono text-muted shrink-0"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {skill.linked}/{total}
                        </span>
                        {skill.phantom ? (
                          <Chip tone="warn">{t("stale-link only")}</Chip>
                        ) : (
                          <>
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
                          </>
                        )}
                      </button>
                      {skill.phantom ? (
                        <button
                          disabled={busy !== null}
                          onClick={() =>
                            void runRow(
                              () => electronAPI.coreRemove(skill.name, "detach"),
                              `skill:${skill.name}`,
                            )
                          }
                          className="rounded-md border border-amber-300 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-40"
                          title={t("Clean up stale links across all tools")}
                        >
                          {t("Clean up stale links")}
                        </button>
                      ) : (
                        <button
                          disabled={busy !== null}
                          onClick={() => setRemoveTargetSkills([skill.name])}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-40 hover:text-red-600 hover:border-red-200"
                          title={t("Remove from the core set and unlink everywhere")}
                        >
                          {t("Remove")}
                        </button>
                      )}
                    </div>

                    {rowError?.key === `skill:${skill.name}` && (
                      <p className="px-4 pb-3 -mt-1 text-[11px] text-red-600">
                        {rowError.msg}
                      </p>
                    )}

                    {open && (
                      <div className="px-4 pb-4 flex flex-col gap-2">
                        {status.map((entry) => {
                          const action = skill.byAgent[entry.agent]
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
                                        : action === "skip-present"
                                          ? t("linked")
                                          : t("not linked")}
                              </span>
                              {!skill.phantom && (
                                <button
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void runRow(
                                      () =>
                                        electronAPI.coreSetExclusion(
                                          entry.agent,
                                          skill.name,
                                          !excluded,
                                        ),
                                      `skill:${skill.name}`,
                                    )
                                  }
                                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-40 hover:text-foreground hover:bg-surface-hover"
                                >
                                  {excluded ? t("include") : t("exclude")}
                                </button>
                              )}
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

      {removeTargetSkills && removeTargetSkills.length > 0 && (
        <RemoveCoreSkillsDialog
          skillNames={removeTargetSkills}
          busy={busy !== null}
          onClose={() => setRemoveTargetSkills(null)}
          onConfirm={async (mode) => {
            const targets = removeTargetSkills
            setRemoveTargetSkills(null)
            await runRow(async () => {
              if (targets.length === 1) {
                await electronAPI.coreRemove(targets[0], mode)
              } else {
                await electronAPI.coreBatchRemove(targets, mode)
              }
              setSelectedSkillNames(new Set())
            }, `batch-remove:${targets.length}`)
          }}
        />
      )}
    </div>
  )
}
