/** "#/settings/permissions" -> "permissions" (a section to scroll to), else null. */
export function parseSection(raw: string): string | null {
  const sec = raw.replace(/^#?\/?/, '').split(/[/?]/)[1]
  return sec && /^[a-z-]{1,40}$/.test(sec) ? sec : null
}
