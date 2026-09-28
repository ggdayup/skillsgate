export {}

declare global {
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

  interface CoreListResult {
    coreDir: string
    storeDir: string
    count: number
    skills: string[]
    exclusions: Record<string, string[]>
    /** Core entries that are symlinks whose target no longer exists. */
    danglingEntries: { name: string; pointsTo: string }[]
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
    skills: GitRepoSkillSummary[]
  }

  interface GitRepoSyncResult {
    status: "updated" | "up-to-date" | "dirty" | "error"
    commit?: string
    error?: string
  }

  interface ElectronAPI {
    // Git Sources
    gitSourcesList: () => Promise<GitRepoSummary[]>
    gitSourcesAdd: (url: string) => Promise<{ ok: boolean; repo?: GitRepoSummary; error?: string }>
    gitSourcesPull: (repoName: string) => Promise<GitRepoSyncResult>
    gitSourcesPullAll: () => Promise<Record<string, GitRepoSyncResult>>
    gitSourcesRemove: (
      repoName: string,
      action: "unlink" | "detach" | "keep-links",
    ) => Promise<{ ok: boolean; error?: string }>

    detectAgents: () => Promise<DetectedAgent[]>
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
        status: "updated" | "up-to-date" | "dirty" | "error"
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
    corePromote: (skillName: string, agentName: string) => Promise<{ ok: boolean; path: string }>
    coreRemove: (skillName: string) => Promise<{
      ok: boolean
      unlinked: number
      residualCopies: string[]
      coreEntryMissing: boolean
    }>
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
