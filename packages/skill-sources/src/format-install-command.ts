/** Quote an argument only when it needs it (skill names may contain spaces). */
export function quoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Build the canonical, copyable install command for a skill. Shares its shape
 * with the parser, so the string we display always round-trips back
 * through `parseInstallCommand()`.
 */
export function formatInstallCommand(ownerRepo: string, skillName?: string): string {
  const base = `npx skills add ${ownerRepo}`;
  if (!skillName || skillName === "*") return base;
  return `${base} --skill ${quoteIfNeeded(skillName)}`;
}
