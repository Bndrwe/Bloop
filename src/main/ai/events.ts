// Tiny change bus: local/cloud code calls aiChanged() when status may differ; the registry
// listens and pushes a fresh (throttled) AiStatus to every window.
type Listener = () => void
const listeners = new Set<Listener>()

export function aiChanged(): void {
  for (const l of listeners) {
    try {
      l()
    } catch (e) {
      console.log(`[bloop] ai listener failed: ${(e as Error).message}`)
    }
  }
}

export function onAiChanged(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
