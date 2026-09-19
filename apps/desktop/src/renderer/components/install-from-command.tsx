import { useEffect, useState } from "react"
import { t } from "../lib/i18n"
import { electronAPI } from "../lib/electron-api"

/**
 * Preview + install panel for a pasted `npx skills add …` command.
 *
 * The pasted string is never executed. It is parsed in the main process
 * (`skills:resolve-source`) into a source + skill filter, resolved by cloning
 * and discovering `SKILL.md` files, and returned here as plain data. Parsing
 * lives in main rather than here because the shared parser reaches for
 * `node:path`/`node:os` when it meets a local source, and the renderer's
 * browser bundle has neither.
 *
 * Nothing is written to disk until the user picks skills and confirms.
 */

type Phase = "resolving" | "ready" | "installing" | "done"

interface InstallFromCommandProps {
  /** The raw pasted text, straight from the search box. */
  input: string
  /** Called after a successful install so the parent can refresh its lists. */
  onInstalled: () => Promise<void> | void
  /** Clears the search box and dismisses the panel. */
  onDismiss: () => void
}

export function InstallFromCommand({
  input,
  onInstalled,
  onDismiss,
}: InstallFromCommandProps) {
  const [phase, setPhase] = useState<Phase>("resolving")
  const [preview, setPreview] = useState<ResolvedSourcePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Reset on every resolve; seeded from the skills the command named, if any.
  // See the resolve effect below for the seeding rule.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [agents, setAgents] = useState<DetectedAgent[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [useCore, setUseCore] = useState(false)
  const [installedCount, setInstalledCount] = useState(0)

  // Resolve whenever the pasted text changes. The `stale` flag drops a slow
  // clone's result if the user edited the input and kicked off a newer one.
  useEffect(() => {
    let stale = false
    setPhase("resolving")
    setError(null)
    setPreview(null)
    setSelected(new Set())
    setInstalledCount(0)

    electronAPI
      .resolveSource(input)
      .then((next) => {
        if (stale) return
        setPreview(next)
        if (!next.ok) setError(next.error ?? "Could not resolve that source.")
        // Pre-select exactly the skills the command named (`--skill x`), since
        // that intent is unambiguous. When it named none, start empty so the user
        // picks from the whole repo rather than inheriting a default they never
        // asked for.
        const named = new Set(
          next.requestedSkills
            .filter((name) => name !== "*")
            .map((name) => name.toLowerCase()),
        )
        setSelected(
          new Set(
            next.skills
              .filter((skill) => named.has(skill.name.toLowerCase()))
              .map((skill) => skill.name),
          ),
        )
        setPhase("ready")
      })
      .catch((err: unknown) => {
        if (stale) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase("ready")
      })

    return () => {
      stale = true
    }
  }, [input])

  useEffect(() => {
    electronAPI
      .detectAgents()
      .then((detected) => {
        setAgents(detected)
        setSelectedAgents(detected.map((agent) => agent.name))
      })
      .catch(() => setAgents([]))
  }, [])

  const skills = preview?.skills ?? []
  const allSelected = skills.length > 0 && selected.size === skills.length
  const canInstall =
    phase === "ready" &&
    selected.size > 0 &&
    Boolean(preview?.label) &&
    (useCore || selectedAgents.length > 0)

  function toggleSkill(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function handleInstall() {
    if (!preview?.label || selected.size === 0) return
    setPhase("installing")
    setError(null)
    const names = [...selected]

    try {
      if (useCore) {
        const out = await electronAPI.coreInstall(preview.label, names)
        const failed = out.filter((r) => r.error)
        if (failed.length > 0) {
          throw new Error(failed.map((r) => `${r.name}: ${r.error}`).join(", "))
        }
      } else {
        const out = await electronAPI.installSkill(
          preview.label,
          selectedAgents,
          "global",
          names,
        )
        const failed = out.filter((r: { success: boolean }) => !r.success)
        if (failed.length > 0) {
          throw new Error(
            failed.map((r: { error?: string }) => r.error).join(", "),
          )
        }
      }
      await onInstalled()
      setInstalledCount(names.length)
      setPhase("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("ready")
    }
  }

  const warnings: string[] = []
  if (preview?.extraSources.length) {
    warnings.push(
      `Ignoring extra source(s): ${preview.extraSources.join(", ")} — SkillsGate installs one source at a time.`,
    )
  }
  if (preview?.extraLines.length) {
    warnings.push(
      `Ignoring ${preview.extraLines.length} extra line(s) pasted below the command.`,
    )
  }
  if (preview?.ignoredFlags.length) {
    warnings.push(`Ignoring unsupported flag(s): ${preview.ignoredFlags.join(", ")}.`)
  }

  return (
    <div className="max-w-xl rounded-xl border border-border bg-surface/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-medium text-accent mb-1">
            {t("Install from command")}
          </div>
          <div className="text-[12px] font-mono text-muted break-all">{input}</div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          aria-label={t("Dismiss")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {phase === "resolving" && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            {t("Resolving source...")}
          </div>
        )}

        {phase !== "resolving" && error && (
          <p className="text-[12px] text-red-400 mb-2">{error}</p>
        )}

        {phase !== "resolving" && preview?.ok && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted">
                <span className="font-mono text-foreground">{preview.label}</span>
                {" · "}
                {skills.length} {skills.length === 1 ? "skill" : "skills"}
              </span>
              <button
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(skills.map((s) => s.name)))
                }
                className="text-[11px] text-muted hover:text-foreground transition-colors"
              >
                {allSelected ? t("Clear all") : t("Select all")}
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {skills.map((skill) => (
                <label
                  key={skill.name}
                  className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(skill.name)}
                    onChange={() => toggleSkill(skill.name)}
                    className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-foreground truncate">
                      {skill.name}
                    </span>
                    {skill.description && (
                      <span className="block text-[11px] text-muted line-clamp-2">
                        {skill.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {/* Target */}
            <div className="mt-3">
              <label className="flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground transition-colors cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useCore}
                  onChange={(e) => setUseCore(e.target.checked)}
                  className="h-3 w-3 accent-blue-500"
                />
                {t("Install into Core")}
                <span className="text-muted/70">
                  — {t("fans out to every detected tool")}
                </span>
              </label>

              {!useCore && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {agents.length === 0 && (
                    <span className="text-[11px] text-muted">
                      {t("No agents detected")}
                    </span>
                  )}
                  {agents.map((agent) => {
                    const on = selectedAgents.includes(agent.name)
                    return (
                      <button
                        key={agent.name}
                        onClick={() =>
                          setSelectedAgents((prev) =>
                            on
                              ? prev.filter((n) => n !== agent.name)
                              : [...prev, agent.name],
                          )
                        }
                        className={
                          "px-2 py-1 rounded-md text-[11px] border transition-colors " +
                          (on
                            ? "bg-foreground text-background border-transparent"
                            : "bg-surface text-muted border-border hover:text-foreground")
                        }
                      >
                        {agent.displayName}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {warnings.length > 0 && (
              <ul className="mt-3 space-y-1">
                {warnings.map((warning) => (
                  <li key={warning} className="text-[11px] text-amber-500">
                    {warning}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border">
        <span className="text-[11px] text-muted">
          {phase === "done"
            ? `${t("Installed")} ${installedCount}`
            : selected.size > 0
              ? `${selected.size} ${t("selected")}`
              : t("Select at least one skill")}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg text-[12px] text-muted hover:text-foreground transition-colors"
          >
            {phase === "done" ? t("Done") : t("Cancel")}
          </button>
          {phase !== "done" && (
            <button
              onClick={handleInstall}
              disabled={!canInstall}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {phase === "installing" && (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background" />
              )}
              {phase === "installing" ? t("Installing...") : t("Install")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CopyGlyph() {
  return (
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
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * The copyable equivalent of a skill's install command — the other half of the
 * paste flow above. Users copy the command from here, then paste it into the
 * Discover search box to install. Lives in this module so both halves of the
 * feature stay together.
 */
export function CommandChip({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)
  const command = `npx skills add ${source}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied; the text stays selectable either way.
    }
  }

  return (
    <button
      onClick={copy}
      title={t("Copy — then paste it into the search box to install")}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted bg-surface hover:text-foreground px-2.5 py-1.5 rounded border border-border transition-colors"
    >
      $ {command}
      {copied ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  )
}
