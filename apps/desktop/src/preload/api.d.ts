export {}

declare global {
  /**
   * A registry agent plus whether this machine looks like it has that tool.
   * `detected` is directory existence only — it says nothing about whether the
   * user actually installs skills there, which is what `active` tracks.
   */
  interface AgentInfo {
    name: string
    displayName: string
    shortCode: string
    detected: boolean
  }

  interface AgentListResult {
    registry: AgentInfo[]
    /** Registry keys the user has chosen to see, in registry order. */
    active: string[]
  }

  /** Shape returned by the `agents:detect` IPC (main's DetectedAgentInfo). */
  interface DetectedAgent {
    name: string
    displayName: string
    shortCode: string
  }

  interface InstalledSkill {
    name: string
    description: string
    path: string
    canonicalPath: string
    agents: string[]
    agentShortCodes: string[]
    scope: "global" | "project" | "custom"
    projectName: string | null
    hasSupportingFiles: boolean
    supportingFiles: Array<{
      relativePath: string
      size: number
    }>
    source?: string
    sourceType?: string
    installedAt?: string
    updatedAt?: string
  }

  interface InstallResult {
    skillName: string
    agent: string
    success: boolean
    path: string
    error?: string
  }

  // Remote server types
  interface RemoteServer {
    id: string
    label: string
    host: string
    port: number
    username: string
    skillsBasePath: string
    sshKeyPath: string | null
    lastSyncAt: string | null
    lastSyncError: string | null
    createdAt: string
    skillCount?: number
  }

  interface RemoteSkill {
    id: string
    serverId: string
    name: string
    description: string | null
    remotePath: string
    content: string | null
    contentHash: string | null
    syncedAt: string
  }

  interface SyncResult {
    added: number
    updated: number
    removed: number
    unchanged: number
    error?: string
  }

  interface PushPlanEntry {
    folderName: string
    name: string
    localPath: string
    remotePath: string
    remoteDir: string
    reason: "added" | "updated" | "deleted" | "unchanged"
    localHash?: string
    remoteHash?: string
  }

  interface UpdateState {
    status:
      | "idle"
      | "checking"
      | "available"
      | "downloading"
      | "downloaded"
      | "not-available"
      | "error"
    version: string
    availableVersion?: string
    downloadedVersion?: string
    progressPercent?: number
    message?: string
  }

  // ---- Core skill set (~/.agents/skills) ----

  interface CoreSummary {
    coreCount: number
    agents: number
    inSync: number
    needsWork: number
    conflicts: number
  }

  interface CoreSkillSource {
    type: "git" | "store" | "local-path" | "core-native"
    repoName?: string
    repoDisplayName?: string
    subGroup?: string
    originUrl?: string
    sourcePath?: string
    label: string
  }

  interface CoreBatchRemoveResult {
    ok: boolean
    removed: string[]
    failed: { name: string; error: string }[]
    unlinked: number
  }

  interface CoreListResult {
    coreDir: string
    storeDir: string
    count: number
    skills: string[]
    exclusions: Record<string, string[]>
    /** Core entries that are symlinks whose target no longer exists. */
    danglingEntries: { name: string; pointsTo: string }[]
    sources?: Record<string, CoreSkillSource>
  }

  interface CoreInstallOptions {
    /** "link" keeps the core entry pointed at the local source dir; "copy" materialises it. */
    mode?: "copy" | "link"
    /** Back up a same-name core entry to .backup/ instead of refusing it. */
    replace?: boolean
  }

  interface CoreInstallEntry {
    name: string
    path: string
    error?: string
    /** Same-name refusal — the UI offers a replace-and-retry. */
    conflict?: boolean
    /** No-op: the entry already linked to this exact source. */
    already?: boolean
  }

  interface CoreSyncItem {
    skill: string
    agent: string
    displayName: string
    action: "link" | "unlink" | "skip-conflict" | "skip-excluded" | "skip-present"
    path: string
    reason?: string
  }

  interface CoreSyncPlan {
    items: CoreSyncItem[]
    agents: string[]
    coreCount: number
  }

  interface CoreSyncResult {
    linked: number
    unlinked: number
    skippedConflicts: number
    skippedExcluded: number
    alreadyPresent: number
    failed: { skill: string; agent: string; error: string }[]
  }

  type CorePruneAction = "unlink" | "backup-and-remove" | "keep-protected"

  interface CorePruneItem {
    skill: string
    agent: string
    displayName: string
    kind: "symlink" | "directory"
    path: string
    action: CorePruneAction
    backupPath?: string
    reason?: string
  }

  interface CorePrunePlan {
    items: CorePruneItem[]
    agents: string[]
    coreCount: number
    totalSymlinks: number
    totalDirectories: number
  }

  interface CorePruneResult {
    unlinked: number
    backedUp: number
    protected: number
    failed: { skill: string; agent: string; error: string }[]
    backupDir?: string
  }

  interface CoreConfig {
    version: number
    exclusions: Record<string, string[]>
    storeDir: string
  }

  interface CoreStatusEntry {
    agent: string
    displayName: string
    linked: number
    missing: string[]
    conflicts: string[]
    excluded: string[]
    dangling: string[]
  }

  /**
   * Result of resolving a source *without* installing it — lets the paste flow
   * show what a command would install before anything touches disk.
   *
   * Parsing happens in the main process: the shared parser reaches for
   * `node:path`/`node:os` for local sources, so it cannot be bundled into the
   * renderer. The renderer only ever sees this plain-data summary.
   */
  interface ResolvedSourcePreview {
    ok: boolean
    error?: string
    /** True when the input was recognized as a `skills add` invocation. */
    wasCommand: boolean
    /** Set on successful resolves; "local" enables the symlink install mode. */
    sourceType?: "github" | "local"
    /** `owner/repo` for GitHub sources, or the absolute path for local ones. */
    label: string
    /** Precise source specifier used for installation (includes subpath/ref for scoped GitHub repos). */
    installSource?: string
    skills: { name: string; description: string }[]
    /** Skill names the command asked for. Empty means "everything found". */
    requestedSkills: string[]
    /** Agent slugs the command asked for, already mapped to SkillsGate names. */
    requestedAgents: string[]
    /** Flags we recognized but deliberately do not act on. */
    ignoredFlags: string[]
    /** Extra sources in the same command; SkillsGate installs one at a time. */
    extraSources: string[]
    /** Additional pasted lines beyond the first. Surfaced, never parsed. */
    extraLines: string[]
  }

  // ---- Git sources (~/.agents/.store/repos) ----

  interface GitRepoSkillSummary {
    name: string
    description?: string
    subPath: string
    isCoreInstalled: boolean
    installedAgents: string[]
  }

  interface GitRepoSummary {
    name: string
    displayName: string
    path: string
    originUrl: string
    branch: string
    commit: string
    commitMessage: string
    commitDate: string
    isDirty: boolean
    hasConflict?: boolean
    conflictedFiles?: string[]
    skills: GitRepoSkillSummary[]
  }

  type GitSyncStrategy = "ff-only" | "stash-merge" | "discard-reset"

  interface GitRepoSyncResult {
    status: "updated" | "up-to-date" | "dirty" | "conflict" | "error"
    commit?: string
    error?: string
    mergedLocalChanges?: boolean
    conflictedFiles?: string[]
    backupPath?: string
    prePullCommit?: string
  }

  /**
   * Outcome of the read-only remote check for one tracked repo. `unknown`
   * means the check itself failed (offline, no permission) — it is never
   * reported as up-to-date on failure.
   */
  interface GitUpdateCheck {
    status: "up-to-date" | "update-available" | "unknown"
    /** Full local HEAD SHA, when it could be read. */
    local?: string
    /** Full remote HEAD SHA, when it could be read. */
    remote?: string
    error?: string
  }

  interface GitUpdateCheckResult {
    checks: Record<string, GitUpdateCheck>
    checkedAt: number
  }

  /**
   * Pushed from main when the 24h background check finds outdated sources.
   * Carries the full checks so the renderer never needs a second round trip.
   */
  interface GitUpdatesAvailable {
    count: number
    checkedAt: number
    checks: Record<string, GitUpdateCheck>
  }

  /**
   * One frame of `git-sources:refresh` progress, pushed from main while the
   * refresh runs. `startedAt` is a Date.now() stamp so the renderer can show a
   * live elapsed timer without having to guess when the refresh began.
   */
  interface GitRefreshProgress {
    phase: "starting" | "pulling" | "scanning" | "done" | "error"
    /** Repo currently being pulled; absent during the initial and scanning phases. */
    repoName?: string
    /** 1-based position of repoName within the repos being pulled. */
    index?: number
    /** How many repos the pulling phase will visit. */
    total?: number
    startedAt: number
    message?: string
  }

  interface ElectronAPI {
    // Git Sources
    gitSourcesList: () => Promise<GitRepoSummary[]>
    gitSourcesAdd: (url: string) => Promise<{ ok: boolean; repo?: GitRepoSummary; error?: string }>
    gitSourcesPull: (repoName: string, strategy?: GitSyncStrategy) => Promise<GitRepoSyncResult>
    gitSourcesAbortConflict: (repoName: string, prePullCommit?: string) => Promise<{ ok: boolean; error?: string }>
    gitSourcesResolveConflicts: (repoName: string) => Promise<{ ok: boolean; remainingConflicts?: string[]; error?: string }>
    gitSourcesOpenFile: (repoName: string, relativePath?: string) => Promise<{ ok: boolean; error?: string }>
    /**
     * Pulls every tracked repo, then re-reads them. Returns the fresh list plus
     * the per-repo sync outcome, so the renderer never needs a second round trip
     * to know what changed. Progress arrives via `onGitSourcesProgress`.
     */
    gitSourcesRefresh: () => Promise<{
      repos: GitRepoSummary[]
      sync: Record<string, GitRepoSyncResult>
    }>
    onGitSourcesProgress: (callback: (progress: GitRefreshProgress) => void) => () => void
    /**
     * Read-only remote check over every tracked repo (no pull, no writes).
     * The Sources page calls this on open; main also runs it on a 24h
     * quiet-hours schedule and pushes `onGitSourcesUpdatesAvailable`.
     */
    gitSourcesCheckUpdates: () => Promise<GitUpdateCheckResult>
    onGitSourcesUpdatesAvailable: (
      callback: (payload: GitUpdatesAvailable) => void,
    ) => () => void
    gitSourcesRemove: (
      repoName: string,
      action: "unlink" | "detach" | "keep-links",
    ) => Promise<{ ok: boolean; error?: string }>

    detectAgents: () => Promise<DetectedAgent[]>
    agentsList: () => Promise<AgentListResult>
    agentsSetActive: (names: string[]) => Promise<string[]>
    agentsResetActive: () => Promise<string[]>
    listInstalled: () => Promise<InstalledSkill[]>
    rescanSkills: () => Promise<InstalledSkill[]>
    installSkill: (
      source: string,
      agents: string[],
      scope: string,
      skillFilter?: string[],
    ) => Promise<InstallResult[]>
    resolveSource: (
      source: string,
      skillFilter?: string[],
    ) => Promise<ResolvedSourcePreview>
    searchCatalog: (
      query: string,
      limit?: number,
      offset?: number,
    ) => Promise<{ skills: { id: string; skillId: string; name: string; installs: number; source: string }[]; count: number }>
    fetchTrending: () => Promise<
      {
        id: string
        skillId: string
        name: string
        installs: number
        source: string
        isOfficial?: boolean
      }[]
    >
    fetchSkillContent: (
      source: string,
      skillId: string,
    ) => Promise<string | null>
    createSkill: (data: {
      name: string
      description?: string
      content?: string
      agentNames?: string[]
    }) => Promise<{ name: string; path: string; targets: string[] }>
    removeSkill: (name: string) => Promise<void>
    updateSkill: (
      name: string,
    ) => Promise<{ ok: boolean; commit?: string; alreadyUpToDate?: boolean; message?: string }>
    updateAllGitSkills: () => Promise<
      Array<{
        repo: string
        name: string
        status: "updated" | "up-to-date" | "dirty" | "conflict" | "error"
        commit?: string
        error?: string
      }>
    >
    readSkillContent: (path: string) => Promise<string>
    listSupportingFiles: (
      path: string,
    ) => Promise<Array<{ relativePath: string; size: number }>>
    readSupportingFile: (path: string, relativePath: string) => Promise<string>
    writeSkillContent: (filePath: string, content: string) => Promise<void>
    openInFinder: (filePath: string) => Promise<void>
    removeFromAgent: (skillName: string, agentName: string) => Promise<void>
    addToAgent: (
      skillName: string,
      canonicalPath: string,
      agentName: string,
    ) => Promise<void>

    // Core skill set (~/.agents/skills, fanned out to every detected tool)
    coreInstall: (
      source: string,
      skillFilter?: string[],
      opts?: CoreInstallOptions,
    ) => Promise<CoreInstallEntry[]>
    coreSummary: () => Promise<CoreSummary>
    coreList: () => Promise<CoreListResult>
    coreStatus: () => Promise<CoreStatusEntry[]>
    corePlan: () => Promise<CoreSyncPlan>
    coreSync: () => Promise<{ plan: CoreSyncPlan; result: CoreSyncResult }>
    corePrunePlan: () => Promise<CorePrunePlan>
    corePruneApply: () => Promise<{
      prunePlan: CorePrunePlan
      pruneResult: CorePruneResult
      syncResult: CoreSyncResult
    }>
    corePromote: (skillName: string, agentName: string) => Promise<{ ok: boolean; path: string }>
    coreBatchAdd: (
      skills: Array<{ name: string; canonicalPath: string }>,
    ) => Promise<{
      added: number
      already: number
      failed: Array<{ name: string; error: string }>
    }>
    coreRemove: (
      skillName: string,
      mode?: "detach" | "purge",
    ) => Promise<{
      ok: boolean
      unlinked: number
      residualCopies: string[]
      coreEntryMissing: boolean
    }>
    coreBatchRemove: (
      skillNames: string[],
      mode?: "detach" | "purge",
    ) => Promise<CoreBatchRemoveResult>
    coreSetExclusion: (
      agentName: string,
      skillName: string,
      excluded: boolean,
    ) => Promise<CoreConfig>
    coreReplaceConflict: (
      skillName: string,
      agentName: string,
    ) => Promise<{ ok: boolean; backupPath?: string }>

    // Remote servers
    serversList: () => Promise<RemoteServer[]>
    serversCreate: (data: {
      label: string
      host: string
      port?: number
      username: string
      skillsBasePath?: string
      sshKeyPath?: string | null
    }) => Promise<RemoteServer>
    serversUpdate: (
      id: string,
      fields: {
        label?: string
        host?: string
        port?: number
        username?: string
        skillsBasePath?: string
        sshKeyPath?: string | null
      },
    ) => Promise<RemoteServer | null>
    serversDelete: (id: string) => Promise<void>
    serversTest: (id: string) => Promise<{ ok: boolean; error?: string }>
    serversSync: (id: string) => Promise<SyncResult>
    serversSkills: (serverId: string) => Promise<RemoteSkill[]>
    serversReadSkill: (serverId: string, remotePath: string) => Promise<string>
    serversWriteSkill: (
      serverId: string,
      remotePath: string,
      content: string,
    ) => Promise<{ ok: boolean }>
    serversCount: () => Promise<number>
    serversPushPreview: (serverId: string, mirror: boolean) => Promise<{
      toAdd: PushPlanEntry[]
      toUpdate: PushPlanEntry[]
      toDelete: PushPlanEntry[]
      unchanged: PushPlanEntry[]
      mirror: boolean
    }>
    serversPushApply: (
      serverId: string,
      preview: unknown,
    ) => Promise<{
      added: number
      updated: number
      deleted: number
      unchanged: number
      errors: { folderName: string; message: string }[]
    }>

    // Settings
    settingsGet: <T>(key: string, defaultValue: T) => Promise<T>
    settingsSet: (key: string, value: unknown) => Promise<void>
    settingsAll: () => Promise<Record<string, unknown>>

    // Favorites
    favoritesList: () => Promise<string[]>
    favoritesToggle: (name: string) => Promise<boolean>

    updatesGetState: () => Promise<UpdateState>
    updatesCheck: () => Promise<UpdateState>
    updatesInstall: () => Promise<void>
    appGetVersion: () => Promise<string>

    onSkillsUpdated: (
      callback: (skills: InstalledSkill[]) => void,
    ) => () => void
    onUpdateState: (callback: (state: UpdateState) => void) => () => void
  }

  interface Window {
    electronAPI: ElectronAPI
  }
}
