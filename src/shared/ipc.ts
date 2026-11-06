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
  togglePet: 'pet:toggle',
  petContextMenu: 'pet:context-menu',

  getPermissions: 'perm:get',
  openPermissionSettings: 'perm:open',
  requestAutomation: 'perm:request-automation',
  dismissOnboarding: 'perm:dismiss',
  relaunchApp: 'app:relaunch',
  resetPermissions: 'perm:reset',
  openPermissionsSetup: 'perm:open-setup',
  isPanelOpen: 'win:panel-open',
  panelOpenPush: 'win:panel-open-push',

  contentMark: 'content:mark',
  contentList: 'content:list',
  contentForget: 'content:forget',

  getDeadlines: 'deadlines:get',
  refreshDeadlines: 'deadlines:refresh',
  getPlan: 'plan:get',
  generatePlan: 'plan:generate',
  addPlanReminders: 'plan:add-reminders',

  brightspaceStatus: 'brightspace:status',
  brightspaceStatusPush: 'brightspace:status-push',
  brightspaceLogin: 'brightspace:login',
  brightspaceLogout: 'brightspace:logout',
  brightspaceRefresh: 'brightspace:refresh',

  // AI (window.studyPet.ai) — handlers live in src/main/ai/ipc.ts
  aiGetStatus: 'ai:get-status',
  aiStatusPush: 'ai:status',
  aiGetSettings: 'ai:get-settings',
  aiSetChoice: 'ai:set-choice',
  aiSetCloudModel: 'ai:set-cloud-model',
  aiSetAutoCloud: 'ai:set-auto-cloud',
  aiSetOllamaUrl: 'ai:set-ollama-url',
  aiPullOllama: 'ai:ollama-pull',
  aiSetApiKey: 'ai:set-api-key',
  aiTest: 'ai:test',
  openExternal: 'app:open-external',

  // Chat with Bloop (window.studyPet.chat) — handlers live in src/main/chat.ts
  chatList: 'chat:list',
  chatGet: 'chat:get',
  chatCreate: 'chat:create',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatRename: 'chat:rename',
  chatDelete: 'chat:delete',
  chatClear: 'chat:clear',
  chatOpen: 'chat:open',
  chatThinking: 'chat:thinking'
} as const
