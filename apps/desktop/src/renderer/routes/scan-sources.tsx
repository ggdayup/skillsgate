import { t } from "../lib/i18n"
import { useEffect, useMemo, useRef, useState } from "react"
import { electronAPI } from "../lib/electron-api"

/**
 * What a finished refresh actually did, including the delta against what the
 * renderer was already showing. Without the delta a refresh that changed
 * nothing is indistinguishable from one that failed.
 */
interface RefreshSummary {
  repoCount: number
  skillCount: number
  durationMs: number
  updated: number
  upToDate: number
  skipped: number
  failed: number
  /** Repos that actually moved to a new commit, for naming in the status line. */
  updatedRepos: string[]
  /** Git's own message per failed repo, as `repo: message`. */
  errors: string[]
  addedRepos: number
  addedSkills: number
  removedSkills: number
}

/** Renders a duration as the user reads it: `0.4s`, `2.1s`, `1m 05s`. */
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  return `${mins}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`
}

/**
 * Renders a last-checked stamp as the user reads it: `14:32` today,
 * `10-4 14:32` otherwise. Coarse by design — it answers "is this fresh?",
 * not "exactly when?".
 */
function formatCheckedAt(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return `${hh}:${mm}`
  return `${d.getMonth() + 1}-${d.getDate()} ${hh}:${mm}`
}

/**
 * The settled state of a refresh. Leads with the delta, because "what changed"
 * is the question the user clicked Refresh to answer; the counts are the
 * fallback when nothing changed.
 */
function RefreshStatusBar({ summary }: { summary: RefreshSummary }) {
  const { updated, upToDate, skipped, failed } = summary
  const parts = [
    { label: t("Updated"), value: updated, className: "text-emerald-400" },
    { label: t("Up to date"), value: upToDate, className: "text-muted" },
    { label: t("Skipped"), value: skipped, className: "text-amber-400" },
    {
      label: t("Failed"),
      value: failed,
      className: "text-red-400",
      // Show why it failed inline; git's message is often the only actionable part.
      title: summary.errors.length > 0 ? summary.errors.join(" · ") : undefined,
    },
  ]

  // Singular and plural need separate keys: the dictionary is keyed by literal
// source strings, so "2 repo" would otherwise be what the user reads.
const deltas: string[] = []
  if (summary.addedRepos > 0) {
    deltas.push(
      (summary.addedRepos === 1 ? t("+{n} repo") : t("+{n} repos")).replace(
        "{n}",
        String(summary.addedRepos),
      ),
    )
  }
  if (summary.addedSkills > 0) {
    deltas.push(
      (summary.addedSkills === 1 ? t("+{n} skill") : t("+{n} skills")).replace(
        "{n}",
        String(summary.addedSkills),
      ),
    )
  }
  if (summary.removedSkills > 0) {
    deltas.push(
      (summary.removedSkills === 1 ? t("−{n} skill") : t("−{n} skills")).replace(
        "{n}",
        String(summary.removedSkills),
      ),
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      <span className="flex items-center gap-2">
        {parts.map(
          (part) =>
            part.value > 0 && (
              <span
                key={part.label}
                title={part.title}
                className={`font-medium ${part.className}`}
              >
                {part.value} {part.label}
              </span>
            ),
        )}
        {updated === 0 && upToDate === 0 && skipped === 0 && failed === 0 && (
          <span className="font-medium text-muted">{t("Nothing to update")}</span>
        )}
      </span>

      {summary.updatedRepos.length > 0 && (
        <span className="min-w-0 truncate font-mono text-[11px] text-emerald-400">
          {summary.updatedRepos.join(", ")}
        </span>
      )}

      {deltas.length > 0 ? (
        <span className="font-mono text-[11px] text-emerald-400">{deltas.join("  ")}</span>
      ) : summary.updatedRepos.length === 0 ? (
        <span className="text-muted">{t("No new commits, no skill changes")}</span>
      ) : null}

      <span className="ml-auto font-mono text-[11px] text-muted">
        {summary.repoCount} {t("repos")} · {summary.skillCount} {t("skills")} ·{" "}
        {formatDuration(summary.durationMs)}
      </span>
    </div>
  )
}

export function ScanSources() {
  const [activeTab, setActiveTab] = useState<"git" | "local">("git")

  // --- Local paths state ---
  const [paths, setPaths] = useState<string[]>([])
  const [newPath, setNewPath] = useState("")
  const [savingLocal, setSavingLocal] = useState(false)

  // --- Git sources state ---
  const [gitRepos, setGitRepos] = useState<GitRepoSummary[]>([])
  // Mirrors `gitRepos` for the refresh handler, which needs a click-time
  // snapshot to diff against but must not close over render-scoped state.
  const gitReposRef = useRef<GitRepoSummary[]>([])
  const [loadingGit, setLoadingGit] = useState(true)
  const [gitError, setGitError] = useState<string | null>(null)
  const [selectedRepoName, setSelectedRepoName] = useState<string | null>(null)
  const [skillSearch, setSkillSearch] = useState("")
  const [pullingRepo, setPullingRepo] = useState<Record<string, boolean>>({})
  const [pullResults, setPullResults] = useState<
    Record<string, { status: "updated" | "up-to-date" | "dirty" | "error"; commit?: string; error?: string }>
  >({})
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<GitRefreshProgress | null>(null)
  const [refreshSummary, setRefreshSummary] = useState<RefreshSummary | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // --- Remote update discovery (read-only; pulling stays explicit) ---
  const [updateChecks, setUpdateChecks] = useState<Record<string, GitUpdateCheck>>({})
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  // View-open, background-event, and post-pull re-checks can otherwise pile
  // onto the same timeout-bound round trips.
  const checkingUpdatesRef = useRef(false)
  const [installingSkill, setInstallingSkill] = useState<string | null>(null)
  const [removingSkill, setRemovingSkill] = useState<string | null>(null)
  const [batchRemovingCore, setBatchRemovingCore] = useState(false)
  const [selectedSkillNames, setSelectedSkillNames] = useState<Set<string>>(new Set())
  const [batchConfirmModal, setBatchConfirmModal] = useState<{
    repo: GitRepoSummary
    skillNames: string[]
    action: "install" | "remove"
  } | null>(null)

  // --- Add Source Modal state ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addUrl, setAddUrl] = useState("")
  const [addingRepo, setAddingRepo] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccessRepo, setAddSuccessRepo] = useState<GitRepoSummary | null>(null)

  // --- Remove Modal state ---
  const [removeTargetRepo, setRemoveTargetRepo] = useState<GitRepoSummary | null>(null)
  const [removeAction, setRemoveAction] = useState<"unlink" | "detach" | "keep-links">("unlink")
  const [removingRepo, setRemovingRepo] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Load initial data
  useEffect(() => {
    loadLocalPaths()
    // The list is local disk state; the update check that follows is what
    // tells the user whether upstream moved since the last pull.
    void loadGitRepos().then(() => {
      void runUpdateCheck()
    })
  }, [])

  // The 24h background check pushes its full result, so the page just merges
  // it — no second round trip needed to learn what changed.
  useEffect(() => {
    return electronAPI.onGitSourcesUpdatesAvailable((payload) => {
      applyUpdateCheckResult(payload)
    })
  }, [])

  // Progress events only matter while the Sources page is mounted, so subscribe
  // here rather than keeping a listener alive for the app's lifetime.
  useEffect(() => {
    return electronAPI.onGitSourcesProgress((progress) => {
      setRefreshProgress(progress)
      if (progress.phase === "error") {
        setRefreshing(false)
        setRefreshSummary(null)
        setGitError(progress.message ?? t("Refresh failed"))
      }
    })
  }, [])

  // A ticking elapsed timer is what makes a slow refresh legible: the progress
  // bar alone can sit still for seconds on a large repo with no sign of life.
  useEffect(() => {
    if (!refreshing || !refreshProgress) return
    const tick = () => setElapsed(Date.now() - refreshProgress.startedAt)
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [refreshing, refreshProgress])

  function loadLocalPaths() {
    electronAPI
      .settingsAll()
      .then((settings) => {
        setPaths((settings["scan.customPaths"] as string[]) || [])
      })
      .catch(() => {
        setPaths([])
      })
  }

  async function loadGitRepos() {
    setLoadingGit(true)
    setGitError(null)
    try {
      const list = await electronAPI.gitSourcesList()
      setGitRepos(list)
      gitReposRef.current = list
      setSelectedRepoName((prev) => {
        if (prev && list.some((r) => r.name === prev)) return prev
        return list[0]?.name ?? null
      })
    } catch (err: unknown) {
      setGitError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingGit(false)
    }
  }

  function applyUpdateCheckResult(result: GitUpdateCheckResult) {
    setUpdateChecks(result.checks)
    setLastCheckedAt(result.checkedAt)
  }

  /**
   * Read-only remote check over every tracked repo. Never pulls, never writes.
   * A transport failure keeps the previous markers rather than clearing them —
   * no signal is more honest than a false "everything is up to date".
   */
  async function runUpdateCheck() {
    if (checkingUpdatesRef.current) return
    checkingUpdatesRef.current = true
    setCheckingUpdates(true)
    try {
      applyUpdateCheckResult(await electronAPI.gitSourcesCheckUpdates())
    } catch {
      // Keep previous markers on transport failure.
    } finally {
      checkingUpdatesRef.current = false
      setCheckingUpdates(false)
    }
  }

  async function persistLocalPaths(next: string[]) {
    setSavingLocal(true)
    try {
      await electronAPI.settingsSet("scan.customPaths", next)
      setPaths(next)
    } finally {
      setSavingLocal(false)
    }
  }

  async function handlePullSingle(repo: GitRepoSummary) {
    if (repo.isDirty) return
    setPullingRepo((prev) => ({ ...prev, [repo.name]: true }))
    try {
      const res = await electronAPI.gitSourcesPull(repo.name)
      setPullResults((prev) => ({ ...prev, [repo.name]: res }))
      await loadGitRepos()
      // A pull moves local HEAD, so any update-available marker for this repo
      // is stale. Re-check rather than guessing the new state.
      void runUpdateCheck()
    } catch (err: unknown) {
      setPullResults((prev) => ({
        ...prev,
        [repo.name]: {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      setPullingRepo((prev) => ({ ...prev, [repo.name]: false }))
    }
  }

  /**
   * One Refresh does the whole job: pull every repo that is not dirty, then
   * re-read them. The result arrives with the fresh list, so there is no second
   * request, and the per-repo pull badges are fed from the same response.
   */
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setGitError(null)
    setRefreshSummary(null)
    setRefreshProgress(null)
    setElapsed(0)

    // The snapshot the delta is measured against has to be read at click time.
    // `gitRepos` in a closure would be stale by the time the awaits resolve.
    const before = gitReposRef.current
    const startedAt = Date.now()

    try {
      const { repos, sync } = await electronAPI.gitSourcesRefresh()

      setPullResults((prev) => ({ ...prev, ...sync }))
      setGitRepos(repos)
      gitReposRef.current = repos
      setSelectedRepoName((prev) => {
        if (prev && repos.some((r) => r.name === prev)) return prev
        return repos[0]?.name ?? null
      })

      const beforeRepoNames = new Set(before.map((r) => r.name))
      const beforeSkills = new Set(before.flatMap((r) => r.skills.map((s) => s.name)))
      const afterSkills = new Set(repos.flatMap((r) => r.skills.map((s) => s.name)))

      const nameOf = (repoName: string) =>
        repos.find((r) => r.name === repoName)?.displayName ?? repoName

      setRefreshSummary({
        repoCount: repos.length,
        skillCount: afterSkills.size,
        durationMs: Date.now() - startedAt,
        updated: Object.values(sync).filter((r) => r.status === "updated").length,
        upToDate: Object.values(sync).filter((r) => r.status === "up-to-date").length,
        skipped: Object.values(sync).filter((r) => r.status === "dirty").length,
        failed: Object.values(sync).filter((r) => r.status === "error").length,
        updatedRepos: Object.entries(sync)
          .filter(([, r]) => r.status === "updated")
          .map(([repoName]) => nameOf(repoName)),
        errors: Object.entries(sync)
          .filter(([, r]) => r.status === "error")
          .map(([repoName, r]) => `${nameOf(repoName)}: ${r.error ?? t("Unknown error")}`),
        addedRepos: repos.filter((r) => !beforeRepoNames.has(r.name)).length,
        addedSkills: [...afterSkills].filter((name) => !beforeSkills.has(name)).length,
        removedSkills: [...beforeSkills].filter((name) => !afterSkills.has(name)).length,
      })

      // Same staleness reasoning as the single pull above.
      void runUpdateCheck()
    } catch (err: unknown) {
      setGitError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
      setRefreshProgress(null)
    }
  }

  async function handleAddSourceSubmit() {
    if (!addUrl.trim()) return
    setAddingRepo(true)
    setAddError(null)
    setAddSuccessRepo(null)
    try {
      const res = await electronAPI.gitSourcesAdd(addUrl.trim())
      if (!res.ok || !res.repo) {
        setAddError(res.error || "添加仓库失败")
      } else {
        setAddSuccessRepo(res.repo)
        setAddUrl("")
        await loadGitRepos()
      }
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingRepo(false)
    }
  }

  async function handleRemoveRepoSubmit() {
    if (!removeTargetRepo) return
    setRemovingRepo(true)
    setRemoveError(null)
    try {
      const res = await electronAPI.gitSourcesRemove(removeTargetRepo.name, removeAction)
      if (!res.ok) {
        setRemoveError(res.error || "删除仓库失败")
      } else {
        setRemoveTargetRepo(null)
        await loadGitRepos()
      }
    } catch (err: unknown) {
      setRemoveError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingRepo(false)
    }
  }

  async function handleInstallSkillToCore(repo: GitRepoSummary, skillName: string) {
    setInstallingSkill(skillName)
    try {
      await electronAPI.coreInstall(repo.originUrl, [skillName])
      await loadGitRepos()
    } catch (err: unknown) {
      alert(`安装到 Core 失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstallingSkill(null)
    }
  }

  async function handleRemoveSkillFromCore(skillName: string) {
    setRemovingSkill(skillName)
    try {
      await electronAPI.coreRemove(skillName, "detach")
      await loadGitRepos()
    } catch (err: unknown) {
      alert(`从 Core 移除失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRemovingSkill(null)
    }
  }

  async function handleBatchRemoveFromCore(skillNames: string[]) {
    if (skillNames.length === 0) return
    setBatchRemovingCore(true)
    try {
      await electronAPI.coreBatchRemove(skillNames, "detach")
      setSelectedSkillNames(new Set())
      await loadGitRepos()
    } catch (err: unknown) {
      alert(`批量从 Core 移除失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchRemovingCore(false)
      setBatchConfirmModal(null)
    }
  }

  async function handleBatchInstallToCore(repo: GitRepoSummary, skillNames: string[]) {
    if (skillNames.length === 0) return
    setBatchRemovingCore(true)
    try {
      await electronAPI.coreInstall(repo.originUrl, skillNames)
      setSelectedSkillNames(new Set())
      await loadGitRepos()
    } catch (err: unknown) {
      alert(`批量安装到 Core 失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchRemovingCore(false)
      setBatchConfirmModal(null)
    }
  }

  const selectedRepo =
    gitRepos.find((r) => r.name === selectedRepoName) ?? gitRepos[0] ?? null

  const filteredSkills = useMemo(() => {
    if (!selectedRepo) return []
    const q = skillSearch.trim().toLowerCase()
    if (!q) return selectedRepo.skills
    return selectedRepo.skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        s.subPath.toLowerCase().includes(q),
    )
  }, [selectedRepo, skillSearch])

  const totalDiscoveredSkills = gitRepos.reduce((acc, r) => acc + r.skills.length, 0)
  const updateAvailableCount = Object.values(updateChecks).filter(
    (check) => check.status === "update-available",
  ).length

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className={activeTab === "git" ? "w-full max-w-[1440px]" : "max-w-5xl"}>
        {/* Header with Title and Tabs */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">{t("Sources")}</h2>
            <p className="text-[12px] text-muted">
              {t("Manage upstream Git skill repositories and local filesystem scan roots.")}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-border bg-surface p-1 self-start">
            <button
              onClick={() => setActiveTab("git")}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeTab === "git"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t("Git Sources")} ({gitRepos.length})
            </button>
            <button
              onClick={() => setActiveTab("local")}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeTab === "local"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t("Local Paths")} ({paths.length})
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: GIT REPOSITORIES                                                   */}
        {/* ========================================================================= */}
        {activeTab === "git" && (
          <div>
            {/* Top Toolbar */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-foreground">
                  {t("Tracked GitHub Sources")}
                </span>
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-[11px] font-medium text-muted">
                  {gitRepos.length} repos · {totalDiscoveredSkills} skills
                </span>
                {checkingUpdates ? (
                  <span className="text-[11px] text-muted">
                    {t("Checking for updates...")}
                  </span>
                ) : (
                  <>
                    {updateAvailableCount > 0 && (
                      <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                        {(updateAvailableCount === 1
                          ? t("{n} source has updates")
                          : t("{n} sources have updates")
                        ).replace("{n}", String(updateAvailableCount))}
                      </span>
                    )}
                    {lastCheckedAt !== null && (
                      <span className="text-[11px] text-muted/70 font-mono">
                        {t("Last checked {time}").replace(
                          "{time}",
                          formatCheckedAt(lastCheckedAt),
                        )}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleRefresh()}
                  disabled={refreshing || loadingGit}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface disabled:opacity-50"
                  title="拉取所有 Git 仓库的最新提交，并重新扫描本机状态"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={refreshing ? "animate-spin" : ""}
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    {refreshing ? t("Refreshing...") : t("Refresh")}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setIsAddModalOpen(true)
                    setAddError(null)
                    setAddSuccessRepo(null)
                  }}
                  className="rounded-lg bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background hover:opacity-90 shadow-sm"
                >
                  + {t("Add GitHub Source")}
                </button>
              </div>
            </div>

            {/* Refresh status bar. Sits inside the toolbar so it is visible while
                the repos list is still on screen, and persists after the refresh
                so the outcome is readable without re-running it. */}
            {(refreshing || refreshSummary) && (
              <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
                {refreshing && refreshProgress && (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3 text-[12px]">
                      <span className="truncate font-medium text-foreground">
                        {refreshProgress.phase === "pulling"
                          ? t("Pulling {repo} ({index}/{total})")
                              .replace("{repo}", refreshProgress.repoName ?? "")
                              .replace("{index}", String(refreshProgress.index ?? 0))
                              .replace("{total}", String(refreshProgress.total ?? 0))
                          : t("Reading local state...")}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">
                        {formatDuration(elapsed)}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-foreground transition-all duration-200"
                        style={{
                          width:
                            refreshProgress.phase === "pulling" && refreshProgress.total
                              ? `${Math.round(((refreshProgress.index ?? 0) / refreshProgress.total) * 100)}%`
                              : "60%",
                        }}
                      />
                    </div>
                  </div>
                )}

                {refreshing && !refreshProgress && (
                  <p className="text-[12px] text-muted">{t("Starting refresh...")}</p>
                )}

                {!refreshing && refreshSummary && (
                  <RefreshStatusBar summary={refreshSummary} />
                )}
              </div>
            )}

            {/* Error Banner */}
            {gitError && (
              <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[12px] text-red-400">
                {gitError}
              </div>
            )}

            {/* Loading state */}
            {loadingGit && gitRepos.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface p-12 text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent mb-3" />
                <p className="text-[12px] text-muted">{t("Loading skills...")}</p>
              </div>
            )}

            {/* Empty state */}
            {!loadingGit && gitRepos.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background text-foreground/80">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                  </svg>
                </div>
                <h3 className="text-[14px] font-semibold text-foreground mb-1">
                  {t("No Git sources tracked yet.")}
                </h3>
                <p className="text-[12px] text-muted max-w-md mx-auto mb-6">
                  {t(
                    "Track upstream GitHub repositories to browse their skills, receive updates on demand, and link them to Core or local tools.",
                  )}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => {
                      setIsAddModalOpen(true)
                      setAddUrl("https://github.com/stablyai/orca/tree/main/skills")
                    }}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                  >
                    + stablyai/orca
                  </button>
                  <button
                    onClick={() => {
                      setIsAddModalOpen(true)
                      setAddUrl("https://github.com/mattpocock/skills/tree/main/skills")
                    }}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                  >
                    + mattpocock/skills
                  </button>
                  <button
                    onClick={() => {
                      setIsAddModalOpen(true)
                      setAddUrl("https://github.com/humanlayer/skills")
                    }}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                  >
                    + humanlayer/skills
                  </button>
                </div>
              </div>
            )}

            {/* Master-Detail Layout: Sources on Left, Skills on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
              {/* Left Column: Sources List */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">
                    {t("Tracked GitHub Sources")}
                  </span>
                  <span className="text-[11px] text-muted font-mono">
                    {gitRepos.length}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {gitRepos.map((repo) => {
                    const isSelected = selectedRepo?.name === repo.name
                    const isPulling = pullingRepo[repo.name] ?? false
                    const pullRes = pullResults[repo.name]
                    const updateCheck = updateChecks[repo.name]

                    return (
                      <div
                        key={repo.name}
                        onClick={() => {
                          setSelectedRepoName(repo.name)
                          setSkillSearch("")
                        }}
                        className={`group relative flex flex-col rounded-2xl border p-4 transition-all cursor-pointer text-left ${
                          isSelected
                            ? "border-foreground/40 bg-surface shadow-md ring-1 ring-foreground/20"
                            : "border-border bg-surface/50 hover:bg-surface hover:border-border/80"
                        }`}
                      >
                        {/* Selected Indicator Bar */}
                        {isSelected && (
                          <div className="absolute left-0 top-3.5 bottom-3.5 w-1 rounded-r-full bg-foreground" />
                        )}

                        {/* Top: Icon + Name + Skill Count Badge */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/80">
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                                <path d="M9 18c-4.51 2-5-2-7-2" />
                              </svg>
                            </div>
                            <span className="text-[13px] font-bold text-foreground truncate">
                              {repo.displayName}
                            </span>
                          </div>

                          <span className="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                            {repo.skills.length} {t("skills")}
                          </span>
                        </div>

                        {/* Middle: Branch, Commit, Date, Dirty */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted font-mono mb-3">
                          <span>{repo.branch || "main"}</span>
                          <span>·</span>
                          <span title={repo.commitMessage}>
                            {repo.commit ? repo.commit.slice(0, 7) : "HEAD"}
                          </span>
                          {repo.commitDate && (
                            <>
                              <span>·</span>
                              <span>{repo.commitDate}</span>
                            </>
                          )}
                          {repo.isDirty && (
                            <span
                              className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[10px] font-semibold text-amber-400 ml-1"
                              title="本地仓库包含未提交修改，更新已跳过以防止冲突"
                            >
                              {t("Dirty")}
                            </span>
                          )}
                          {updateCheck?.status === "update-available" && (
                            <span
                              className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-400 ml-1"
                              title={t(
                                "Pull updates the repo in place. Symlink installs take effect immediately; copied installs need a re-sync.",
                              )}
                            >
                              {t("Update available: {local} → {remote}")
                                .replace("{local}", (updateCheck.local ?? "").slice(0, 7))
                                .replace("{remote}", (updateCheck.remote ?? "").slice(0, 7))}
                            </span>
                          )}
                          {updateCheck?.status === "unknown" && (
                            <span
                              className="text-[10px] text-muted/60 ml-1"
                              title={updateCheck.error ?? ""}
                            >
                              {t("Remote check failed")}
                            </span>
                          )}
                        </div>

                        {/* Bottom: Pull Status + Action Buttons */}
                        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border/40">
                          {/* Pull Feedback */}
                          <div className="min-w-0 flex-1">
                            {pullRes ? (
                              <span
                                // A bare "Failed" tells the user nothing about what to
                                // do next, so surface git's own message on hover.
                                title={pullRes.error}
                                className={`text-[10px] font-medium px-1.5 py-0.5 rounded truncate inline-block max-w-full ${
                                  pullRes.status === "updated"
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : pullRes.status === "up-to-date"
                                    ? "text-muted"
                                    : pullRes.status === "dirty"
                                    ? "bg-amber-500/20 text-amber-400"
                                    : "bg-red-500/20 text-red-400"
                                }`}
                              >
                                {pullRes.status === "updated"
                                  ? `${t("Updated to")} ${pullRes.commit?.slice(0, 7)}`
                                  : pullRes.status === "up-to-date"
                                  ? t("Already up to date")
                                  : pullRes.status === "dirty"
                                  ? t("Skipped (dirty)")
                                  : t("Failed")}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted/60 truncate block">
                                {repo.skills.filter((s) => s.isCoreInstalled || s.installedAgents.length > 0).length}{" "}
                                {t("installed")}
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void handlePullSingle(repo)
                              }}
                              disabled={repo.isDirty || isPulling}
                              className="rounded-lg border border-border bg-background p-1.5 text-muted hover:text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                repo.isDirty
                                  ? "本地有未提交修改，已禁止拉取"
                                  : t("Pull latest")
                              }
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={isPulling ? "animate-spin" : ""}
                              >
                                <path d="M12 3v12" />
                                <path d="m8 11 4 4 4-4" />
                                <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
                              </svg>
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void electronAPI.openInFinder(repo.path)
                              }}
                              className="rounded-lg border border-border bg-background p-1.5 text-muted hover:text-foreground hover:bg-surface"
                              title="在访达中显示仓库文件夹"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setRemoveTargetRepo(repo)
                                setRemoveAction("unlink")
                                setRemoveError(null)
                              }}
                              className="rounded-lg border border-border bg-background p-1.5 text-muted hover:text-red-400 hover:bg-surface"
                              title="取消跟踪并删除本地仓库"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3 6h18" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Right Column: Selected Source's Skills */}
              <div className="flex flex-col gap-4 min-w-0">
                {!selectedRepo ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-12 text-center text-[12px] text-muted">
                    {t("Select a source to view skills")}
                  </div>
                ) : (
                  <>
                    {/* Selected Source Header & Stats */}
                    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-foreground font-mono truncate">
                              {selectedRepo.displayName}
                            </h3>
                            {selectedRepo.isDirty && (
                              <span className="shrink-0 rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                                {t("Dirty")}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted font-mono mt-1">
                            <span>{selectedRepo.branch || "main"}</span>
                            <span>·</span>
                            <span title={selectedRepo.commitMessage}>
                              {selectedRepo.commit ? selectedRepo.commit.slice(0, 7) : "HEAD"}
                            </span>
                            {selectedRepo.commitDate && (
                              <>
                                <span>·</span>
                                <span>{selectedRepo.commitDate}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Counts Pill & Batch Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {selectedRepo.skills.filter((s) => s.isCoreInstalled).length > 0 && (
                            <button
                              onClick={() => {
                                const coreSkills = selectedRepo.skills
                                  .filter((s) => s.isCoreInstalled)
                                  .map((s) => s.name)
                                setBatchConfirmModal({
                                  repo: selectedRepo,
                                  skillNames: coreSkills,
                                  action: "remove",
                                })
                              }}
                              disabled={batchRemovingCore}
                              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                              title={t("Batch remove from Core")}
                            >
                              {t("Batch remove from Core")} (
                              {selectedRepo.skills.filter((s) => s.isCoreInstalled).length})
                            </button>
                          )}
                          <span className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-semibold text-foreground">
                            {selectedRepo.skills.length} {t("skills")}
                          </span>
                          <span className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-muted">
                            {selectedRepo.skills.filter((s) => s.isCoreInstalled || s.installedAgents.length > 0).length}{" "}
                            {t("installed")}
                          </span>
                        </div>
                      </div>

                      {/* Commit message banner */}
                      {selectedRepo.commitMessage && (
                        <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-1.5 text-[11px] text-muted truncate">
                          <span className="font-mono text-[10px] text-foreground/60 mr-2">
                            latest:
                          </span>
                          {selectedRepo.commitMessage}
                        </div>
                      )}

                      {/* Filter skills search box & selection toolbar */}
                      {selectedRepo.skills.length > 0 && (
                        <div className="mt-4 pt-3.5 border-t border-border/40 flex flex-col gap-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="relative flex-1 max-w-sm">
                              <input
                                type="text"
                                value={skillSearch}
                                onChange={(e) => setSkillSearch(e.target.value)}
                                placeholder={t("Filter skills in this source...")}
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 pl-8 text-[12px] text-foreground placeholder:text-muted/60 focus:outline-none focus:border-foreground/40"
                              />
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                              >
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.3-4.3" />
                              </svg>
                            </div>
                            <div className="flex items-center gap-2">
                              {skillSearch && (
                                <button
                                  onClick={() => setSkillSearch("")}
                                  className="text-[11px] text-muted hover:text-foreground transition-colors mr-2"
                                >
                                  {t("Clear filter")}
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  const coreSkills = selectedRepo.skills
                                    .filter((s) => s.isCoreInstalled)
                                    .map((s) => s.name)
                                  setSelectedSkillNames(new Set(coreSkills))
                                }}
                                className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted hover:text-foreground hover:bg-surface transition-colors"
                              >
                                {t("Select all installed in Core")}
                              </button>
                            </div>
                          </div>

                          {/* Selected Batch Action Bar */}
                          {selectedSkillNames.size > 0 && (
                            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-border bg-background text-[12px]">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">
                                  {t("Selected")} {selectedSkillNames.size} {t("skills")}
                                </span>
                                <button
                                  onClick={() => setSelectedSkillNames(new Set())}
                                  className="text-muted hover:text-foreground text-[11px] ml-2"
                                >
                                  {t("Clear selection")}
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                {(() => {
                                  const selInstalled = selectedRepo.skills.filter(
                                    (s) => selectedSkillNames.has(s.name) && s.isCoreInstalled,
                                  )
                                  const selNotInstalled = selectedRepo.skills.filter(
                                    (s) => selectedSkillNames.has(s.name) && !s.isCoreInstalled,
                                  )
                                  return (
                                    <>
                                      {selNotInstalled.length > 0 && (
                                        <button
                                          onClick={() =>
                                            setBatchConfirmModal({
                                              repo: selectedRepo,
                                              skillNames: selNotInstalled.map((s) => s.name),
                                              action: "install",
                                            })
                                          }
                                          disabled={batchRemovingCore}
                                          className="rounded-lg bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:opacity-90 disabled:opacity-40"
                                        >
                                          {t("Install selected to Core")} ({selNotInstalled.length})
                                        </button>
                                      )}
                                      {selInstalled.length > 0 && (
                                        <button
                                          onClick={() =>
                                            setBatchConfirmModal({
                                              repo: selectedRepo,
                                              skillNames: selInstalled.map((s) => s.name),
                                              action: "remove",
                                            })
                                          }
                                          disabled={batchRemovingCore}
                                          className="rounded-lg bg-red-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
                                        >
                                          {t("Remove selected from Core")} ({selInstalled.length})
                                        </button>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Discovered Skills Grid */}
                    {selectedRepo.skills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-[12px] text-muted">
                        {t("No skills found in this source.")}
                      </div>
                    ) : filteredSkills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-[12px] text-muted">
                        {t("No skills match your filter.")}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredSkills.map((skill) => {
                          const isInstallingThis = installingSkill === skill.name

                          return (
                            <div
                              key={skill.name}
                              className="flex flex-col justify-between rounded-xl border border-border bg-surface p-3.5 shadow-sm hover:border-border/80 transition-colors"
                            >
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
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
                                    <span className="text-[13px] font-bold text-foreground font-mono truncate">
                                      {skill.name}
                                    </span>
                                  </div>
                                  {skill.isCoreInstalled ? (
                                    <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 shrink-0">
                                      Core
                                    </span>
                                  ) : skill.installedAgents.length > 0 ? (
                                    <span className="rounded-full bg-blue-500/20 border border-blue-500/40 px-2 py-0.5 text-[10px] font-semibold text-blue-400 shrink-0">
                                      {skill.installedAgents.length} tools
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-medium text-muted shrink-0">
                                      {t("Not installed")}
                                    </span>
                                  )}
                                </div>

                                {skill.description ? (
                                  <p className="text-[11px] text-muted line-clamp-2 leading-relaxed mb-3">
                                    {skill.description}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-muted/60 italic mb-3">
                                    No description
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-border/40 gap-2">
                                <span className="text-[10px] font-mono text-muted/80 truncate">
                                  {skill.subPath}
                                </span>

                                {!skill.isCoreInstalled ? (
                                  <button
                                    onClick={() =>
                                      void handleInstallSkillToCore(selectedRepo, skill.name)
                                    }
                                    disabled={isInstallingThis}
                                    className="rounded-md bg-foreground px-2.5 py-1 text-[10px] font-medium text-background hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {isInstallingThis
                                      ? t("Installing...")
                                      : t("Install to Core")}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      void handleRemoveSkillFromCore(skill.name)
                                    }
                                    disabled={removingSkill === skill.name}
                                    className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted hover:text-red-500 hover:border-red-500/40 disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {removingSkill === skill.name
                                      ? t("Removing...")
                                      : t("Remove from Core")}
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: LOCAL PATHS                                                        */}
        {/* ========================================================================= */}
        {activeTab === "local" && (
          <div>
            <div className="rounded-2xl border border-border bg-surface p-5 mb-6">
              <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground mb-2">
                    {t("Bring Your Own Skill Folders")}
                  </h3>
                  <p className="text-[12px] text-muted leading-relaxed mb-4">
                    Point SkillsGate at places like `~/projects`, `~/workspaces`, or `~/my-skills`. It will discover:
                  </p>
                  <div className="flex flex-col gap-2 text-[12px] text-foreground">
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      Direct skill folders:
                      <code className="ml-2 text-muted">~/my-skills/example/SKILL.md</code>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      Project-local tool paths:
                      <code className="ml-2 text-muted">
                        ~/projects/app/.claude/skills/foo/SKILL.md
                      </code>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                    {t("Current Coverage")}
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="rounded-md border border-border px-3 py-2 text-[12px] text-foreground">
                      {paths.length} custom scan source{paths.length === 1 ? "" : "s"}
                    </div>
                    <div className="rounded-md border border-border px-3 py-2 text-[12px] text-foreground">
                      {t("Global installs still scanned automatically")}
                    </div>
                    <div className="rounded-md border border-border px-3 py-2 text-[12px] text-foreground">
                      {t("Project-local paths discovered under each root")}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground">
                    {t("Custom Roots")}
                  </h3>
                  <p className="text-[12px] text-muted">
                    {t("Add and remove folders to include in local skill discovery.")}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="~/projects or ~/my-skills"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPath.trim()) {
                      const value = newPath.trim()
                      if (!paths.includes(value)) {
                        void persistLocalPaths([...paths, value])
                      }
                      setNewPath("")
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const value = newPath.trim()
                    if (!value || paths.includes(value)) return
                    void persistLocalPaths([...paths, value])
                    setNewPath("")
                  }}
                  disabled={savingLocal}
                  className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background disabled:opacity-40"
                >
                  {t("Add Root")}
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {paths.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                    <p className="text-[12px] text-muted">
                      No custom roots yet. Add one above to start discovering extra local skills.
                    </p>
                  </div>
                ) : (
                  paths.map((scanPath) => (
                    <div
                      key={scanPath}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3"
                    >
                      <div>
                        <code className="block text-[12px] text-foreground">{scanPath}</code>
                        <p className="text-[11px] text-muted mt-1">
                          Direct skills and project-local tool paths under this root will be discovered.
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          void persistLocalPaths(paths.filter((item) => item !== scanPath))
                        }
                        className="rounded-md border border-border px-3 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-surface"
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: ADD GITHUB SOURCE                                                  */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground mb-1">
              {t("Add GitHub Source")}
            </h3>
            <p className="text-[12px] text-muted mb-4">
              输入 GitHub 仓库链接以持续跟踪。支持仓库根目录或带子路径的链接。
            </p>

            <div className="mb-4">
              <input
                type="text"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="https://github.com/owner/repo 或 .../tree/main/skills"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                disabled={addingRepo}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !addingRepo) {
                    void handleAddSourceSubmit()
                  }
                }}
              />
            </div>

            {/* Quick Suggestions */}
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-wider text-muted mb-2 font-medium">
                推荐源快捷填入
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAddUrl("https://github.com/stablyai/orca/tree/main/skills")}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                >
                  stablyai/orca
                </button>
                <button
                  type="button"
                  onClick={() => setAddUrl("https://github.com/mattpocock/skills/tree/main/skills")}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                >
                  mattpocock/skills
                </button>
                <button
                  type="button"
                  onClick={() => setAddUrl("https://github.com/humanlayer/skills")}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-mono text-muted hover:text-foreground hover:bg-surface"
                >
                  humanlayer/skills
                </button>
              </div>
            </div>

            {/* Error Message */}
            {addError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-400 whitespace-pre-line break-words font-mono">
                {addError}
              </div>
            )}

            {/* Success Message & Discovered Skills preview */}
            {addSuccessRepo && (
              <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-[12px] font-semibold text-emerald-400 mb-2">
                  ✓ 成功克隆并纳管 {addSuccessRepo.displayName}！
                </p>
                <p className="text-[11px] text-muted mb-3">
                  共发现 {addSuccessRepo.skills.length} 个技能。可直接在下方列表中快速安装。
                </p>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-background p-2 space-y-1">
                  {addSuccessRepo.skills.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between text-[11px] font-mono px-2 py-1"
                    >
                      <span className="text-foreground">{s.name}</span>
                      <span className="text-muted text-[10px]">{s.subPath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false)
                  setAddSuccessRepo(null)
                  setAddError(null)
                }}
                disabled={addingRepo}
                className="rounded-lg border border-border bg-background px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface"
              >
                {addSuccessRepo ? t("Done") : t("Cancel")}
              </button>

              {!addSuccessRepo && (
                <button
                  type="button"
                  onClick={() => void handleAddSourceSubmit()}
                  disabled={addingRepo || !addUrl.trim()}
                  className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-40"
                >
                  {addingRepo ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border border-background border-t-transparent" />
                      克隆中…
                    </span>
                  ) : (
                    "克隆并跟踪"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REMOVE / UNTRACK REPO CONFIRMATION                                 */}
      {/* ========================================================================= */}
      {removeTargetRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground mb-1">
              取消跟踪: {removeTargetRepo.displayName}
            </h3>
            <p className="text-[12px] text-muted mb-4">
              此操作将从本地持久化存储 (`~/.agents/.store/repos/{removeTargetRepo.name}`) 中移除该仓库。
            </p>

            {/* Check if any skills are installed */}
            {(() => {
              const installedCount = removeTargetRepo.skills.filter(
                (s) => s.isCoreInstalled || s.installedAgents.length > 0,
              ).length

              if (installedCount > 0) {
                return (
                  <div className="mb-4 space-y-3">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-300">
                      ⚠️ 检测到该仓库中有 <strong>{installedCount} 个技能</strong> 已被安装到 Core 或工具中。
                    </div>

                    <div className="space-y-2 text-[12px] text-foreground">
                      <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border bg-background cursor-pointer hover:border-foreground/40 transition-colors">
                        <input
                          type="radio"
                          name="removeAction"
                          checked={removeAction === "unlink"}
                          onChange={() => setRemoveAction("unlink")}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="font-semibold block text-foreground">
                            连带清理（推荐）
                          </span>
                          <span className="text-[11px] text-muted">
                            自动解除并删除 Core 及各 Agent 中的关联软链接，完全移除该技能。
                          </span>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border bg-background cursor-pointer hover:border-foreground/40 transition-colors">
                        <input
                          type="radio"
                          name="removeAction"
                          checked={removeAction === "detach"}
                          onChange={() => setRemoveAction("detach")}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="font-semibold block text-foreground">
                            保留技能（转为独立静态副本）
                          </span>
                          <span className="text-[11px] text-muted">
                            将已安装技能的实体文件夹拷贝脱离至本地独立存储，保留安装，仅删除 Git 跟踪仓库。
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                )
              }

              return (
                <p className="text-[12px] text-foreground mb-4">
                  该仓库内暂无已安装的技能软链接，确认删除吗？
                </p>
              )
            })()}

            {removeError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-400">
                {removeError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRemoveTargetRepo(null)}
                disabled={removingRepo}
                className="rounded-lg border border-border bg-background px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveRepoSubmit()}
                disabled={removingRepo}
                className="rounded-lg bg-red-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {removingRepo ? "正在移除…" : "确认移除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Confirm Modal */}
      {batchConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground mb-1">
              {batchConfirmModal.action === "remove"
                ? t("Batch remove from Core")
                : t("Install selected to Core")}
            </h3>
            <p className="text-[12px] text-muted mb-4">
              <span className="font-semibold text-foreground mr-1">
                {batchConfirmModal.skillNames.length} {t("skills")}
              </span>
              <span>
                {batchConfirmModal.action === "remove"
                  ? "来自 " + batchConfirmModal.repo.displayName + "。从 Core 移除后将停止向全部 Agent 工具同步，但 Git 仓库源码仍完好保留在本地。"
                  : "即将安装并链接到 Core (~/.agents/skills) 以及已连接的全部 Agent 工具。"}
              </span>
            </p>

            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-2.5 space-y-1 mb-4">
              {batchConfirmModal.skillNames.map((name) => (
                <div key={name} className="text-[11px] font-mono text-foreground px-1 py-0.5 truncate">
                  {name}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setBatchConfirmModal(null)}
                disabled={batchRemovingCore}
                className="rounded-lg border border-border bg-background px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (batchConfirmModal.action === "remove") {
                    void handleBatchRemoveFromCore(batchConfirmModal.skillNames)
                  } else {
                    void handleBatchInstallToCore(batchConfirmModal.repo, batchConfirmModal.skillNames)
                  }
                }}
                disabled={batchRemovingCore}
                className={`rounded-lg px-4 py-2 text-[12px] font-medium text-white transition-colors disabled:opacity-40 ${
                  batchConfirmModal.action === "remove"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-primary hover:bg-primary/90"
                }`}
              >
                {batchRemovingCore
                  ? "正在处理…"
                  : batchConfirmModal.action === "remove"
                  ? `${t("Remove from Core")} (${batchConfirmModal.skillNames.length})`
                  : `${t("Install to Core")} (${batchConfirmModal.skillNames.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
