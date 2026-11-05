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
  settingsChanged: 'settings:changed',
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

  // AI (window.studyPet.ai) — handlers live in src/main/ai/ipc.ts
  aiGetStatus: 'ai:get-status',
  aiStatusPush: 'ai:status',
  aiGetSettings: 'ai:get-settings',
  aiSetChoice: 'ai:set-choice',
  aiSetCloudModel: 'ai:set-cloud-model',
  aiSetOllamaUrl: 'ai:set-ollama-url',
  aiDownloadBloop: 'ai:bloop-download',
  aiCancelBloop: 'ai:bloop-cancel',
  aiDeleteBloop: 'ai:bloop-delete',
  aiSetBloopEnabled: 'ai:bloop-enabled',
  aiImportBloop: 'ai:bloop-import',
  aiDismissBloopOffer: 'ai:bloop-dismiss-offer',
  aiPullOllama: 'ai:ollama-pull',
  aiSetApiKey: 'ai:set-api-key',
  aiTest: 'ai:test',
  openExternal: 'app:open-external'
} as const
