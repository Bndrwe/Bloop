/** The global shortcut that shows / hides the pet: Cmd+Shift+B on macOS, Ctrl+Shift+B elsewhere. */
export function petShortcut(platform: string): { accelerator: string; label: string } {
  return platform === 'darwin'
    ? { accelerator: 'Command+Shift+B', label: '⌘⇧B' }
    : { accelerator: 'Control+Shift+B', label: 'Ctrl+Shift+B' }
}
