import { useState, useEffect, useRef } from "react"
import { useKeyboard } from "@opentui/react"
import { colors } from "../utils/colors.js"
import {
  useSkillActions,
  validateLocalSkillPath,
  type PathValidationResult,
} from "../data/use-skill-actions.js"

interface AddLocalSkillOverlayProps {
  initialPath?: string
  agents: Array<{ name: string; displayName: string }>
  defaultTargets?: string[]
  onClose: () => void
  onInstalled?: (skillNames: string[]) => void
}

export function AddLocalSkillOverlay({
  initialPath = "",
  agents,
  defaultTargets = [],
  onClose,
  onInstalled,
}: AddLocalSkillOverlayProps) {
  const { installFromLocalPath } = useSkillActions()
  const [pathInput, setPathInput] = useState(initialPath)
  const [targetType, setTargetType] = useState<"core" | "agents">("core")
  const [mode, setMode] = useState<"symlink" | "copy">("symlink")
  const [targets, setTargets] = useState<string[]>(
    defaultTargets.length > 0 ? defaultTargets : agents.map((a) => a.name),
  )
  const [focusedField, setFocusedField] = useState<0 | 1 | 2>(0)
  const [validation, setValidation] = useState<PathValidationResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [installing, setInstalling] = useState(false)
  const activeInputRef = useRef(pathInput)
  activeInputRef.current = pathInput

  useEffect(() => {
    let cancelled = false
    const trimmed = pathInput.trim()
    if (!trimmed) {
      setValidation(null)
      return
    }

    setValidating(true)
    validateLocalSkillPath(trimmed)
      .then((res) => {
        if (!cancelled) {
          setValidation(res)
          setValidating(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setValidating(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pathInput])

  async function handleInstall() {
    if (installing) return
    const trimmed = activeInputRef.current.trim()
    if (!trimmed) return

    setInstalling(true)
    const result = await installFromLocalPath(trimmed, {
      targetType,
      mode,
      selectedAgents: targetType === "agents" ? targets : undefined,
    })
    setInstalling(false)

    if (result.success) {
      onInstalled?.(result.skillNames ?? [])
      onClose()
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape" && !installing) {
      onClose()
      return
    }

    if (key.name === "tab" && !installing) {
      setFocusedField((prev) => (prev === 0 ? 1 : prev === 1 ? 2 : 0))
      return
    }

    if (key.name === "t" && !installing) {
      setTargetType((prev) => (prev === "core" ? "agents" : "core"))
      return
    }

    if (key.name === "m" && !installing) {
      setMode((prev) => (prev === "symlink" ? "copy" : "symlink"))
      return
    }

    if (targetType === "agents" && /^[1-9]$/.test(key.raw ?? "") && !installing) {
      const idx = Number(key.raw) - 1
      const agent = agents[idx]
      if (agent) {
        setTargets((prev) =>
          prev.includes(agent.name)
            ? prev.filter((name) => name !== agent.name)
            : [...prev, agent.name],
        )
      }
      return
    }

    if (key.name === "s" && key.ctrl && !installing) {
      handleInstall()
      return
    }
  })

  return (
    <box
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: colors.bg,
      }}
    >
      <box
        style={{
          width: 76,
          border: true,
          borderColor: colors.primary,
          backgroundColor: "#1a1a2e",
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
        }}
        title="Add Skill from Local Path"
      >
        <text fg={colors.text}>Local Directory Path</text>
        <box
          style={{
            height: 3,
            width: "100%",
            border: true,
            borderColor: focusedField === 0 ? colors.primary : colors.border,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <input
            placeholder="~/path/to/skill or /absolute/path"
            value={pathInput}
            focused={focusedField === 0 && !installing}
            onInput={(val: string) => setPathInput(val)}
            onSubmit={() => {
              if (validation?.valid && validation.skills.length > 0) {
                handleInstall()
              } else {
                setFocusedField(1)
              }
            }}
          />
        </box>

        {/* Validation feedback */}
        <box style={{ height: 1, width: "100%" }}>
          {validating ? (
            <text fg={colors.textDim}>Checking path and SKILL.md...</text>
          ) : !pathInput.trim() ? (
            <text fg={colors.textDim}>Enter directory containing SKILL.md</text>
          ) : validation?.valid && validation.skills.length > 0 ? (
            <text fg={colors.success}>
              ✓ Found {validation.skills.length} skill(s):{" "}
              {validation.skills.map((s) => s.name).join(", ")}
            </text>
          ) : (
            <text fg={colors.error}>
              ✗ {validation?.error ?? "No valid SKILL.md found"}
            </text>
          )}
        </box>

        <text>{" "}</text>

        {/* Target destination */}
        <text fg={colors.text}>Target Destination (Press 't' to toggle)</text>
        <box style={{ flexDirection: "row", width: "100%" }}>
          <text
            fg={targetType === "core" ? colors.primary : colors.textDim}
            style={{ marginRight: 2 }}
          >
            {targetType === "core" ? "[•]" : "[ ]"} Core (~/.agents/skills)
          </text>
          <text fg={targetType === "agents" ? colors.primary : colors.textDim}>
            {targetType === "agents" ? "[•]" : "[ ]"} Specific Agents
          </text>
        </box>

        {targetType === "agents" ? (
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            {agents.map((agent, index) => (
              <text
                key={agent.name}
                fg={
                  targets.includes(agent.name)
                    ? colors.primary
                    : colors.textDim
                }
              >
                {index + 1}. {targets.includes(agent.name) ? "[x]" : "[ ]"}{" "}
                {agent.displayName}
              </text>
            ))}
          </box>
        ) : null}

        <text>{" "}</text>

        {/* Install Mode */}
        <text fg={colors.text}>Install Mode (Press 'm' to toggle)</text>
        <box style={{ flexDirection: "row", width: "100%" }}>
          <text
            fg={mode === "symlink" ? colors.primary : colors.textDim}
            style={{ marginRight: 2 }}
          >
            {mode === "symlink" ? "[•]" : "[ ]"} Symlink (live updates)
          </text>
          <text fg={mode === "copy" ? colors.primary : colors.textDim}>
            {mode === "copy" ? "[•]" : "[ ]"} Copy
          </text>
        </box>

        <text>{" "}</text>

        {/* Bottom hints */}
        <text fg={colors.textDim}>
          Enter/Ctrl+S=install  t=toggle target  m=mode  Tab=switch focus  Esc=cancel
        </text>
      </box>
    </box>
  )
}
