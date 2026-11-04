// IPC channel names. Invoke channels use ipcRenderer.invoke / ipcMain.handle.
export const IPC = {
  getStatus: 'status:get',
  statusPush: 'status:push',
  navigate: 'ui:navigate',

  startSession: 'session:start',
  pauseSession: 'session:pause',
  resumeSession: 'session:resume',
  stopSession: 'session:stop',
  skipBreak: 'session:skip-break',

  getStats: 'stats:get',
  getSessions: 'stats:sessions',

  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  resetData: 'data:reset',

  openSettings: 'win:open-settings',
  togglePanel: 'win:toggle-panel',
  closePanel: 'win:close-panel',
  closeWindow: 'win:close',
  dragStart: 'win:drag-start',
  dragEnd: 'win:drag-end',
  setIgnoreMouse: 'win:ignore-mouse',

  getPermissions: 'perm:get',
  openPermissionSettings: 'perm:open',
  requestAutomation: 'perm:request-automation',
  dismissOnboarding: 'perm:dismiss',
  relaunchApp: 'app:relaunch',

  getDeadlines: 'deadlines:get',
  refreshDeadlines: 'deadlines:refresh',
  getPlan: 'plan:get',
  generatePlan: 'plan:generate',
  addPlanReminders: 'plan:add-reminders',
  hasApiKey: 'plan:has-key'
} as const
