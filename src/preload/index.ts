import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppStatus, Settings, StudyPetApi } from '../shared/types'
import type { AiApi, AiStatus } from '../shared/ai'

// The renderer only gets these named functions, never ipcRenderer itself or a generic invoke.
// Arguments are coerced to their declared types here as a first filter; main still validates every
// argument and checks the sender.
const inv = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args)
const str = (v: unknown, max = 4096): string => (typeof v === 'string' ? v.slice(0, max) : '')

const ai: AiApi = {
  getStatus: (refresh) => inv(IPC.aiGetStatus, refresh === true),
  onStatus: (cb) => {
    const l = (_e: IpcRendererEvent, s: AiStatus): void => cb(s)
    ipcRenderer.on(IPC.aiStatusPush, l)
    return () => ipcRenderer.removeListener(IPC.aiStatusPush, l)
  },
  getSettings: () => inv(IPC.aiGetSettings),
  setChoice: (choice) => inv(IPC.aiSetChoice, choice),
  setCloudModel: (provider, model) => inv(IPC.aiSetCloudModel, str(provider, 40), str(model, 200)),
  setOllamaUrl: (url) => inv(IPC.aiSetOllamaUrl, str(url, 500)),
  downloadBloopModel: (confirmed) => inv(IPC.aiDownloadBloop, confirmed === true),
  cancelBloopDownload: () => inv(IPC.aiCancelBloop),
  deleteBloopModel: () => inv(IPC.aiDeleteBloop),
  setBloopEnabled: (enabled) => inv(IPC.aiSetBloopEnabled, enabled === true),
  importBloopModelFile: () => inv(IPC.aiImportBloop),
  dismissBloopOffer: () => inv(IPC.aiDismissBloopOffer),
  pullOllamaModel: (model, confirmed) => inv(IPC.aiPullOllama, str(model, 200), confirmed === true),
  setApiKey: (provider, key) => inv(IPC.aiSetApiKey, str(provider, 40), typeof key === 'string' ? key : null),
  test: (choice) => inv(IPC.aiTest, choice)
}

const api: StudyPetApi = {
  getStatus: () => inv(IPC.getStatus),
  onStatus: (cb) => {
    const l = (_e: IpcRendererEvent, s: AppStatus): void => cb(s)
    ipcRenderer.on(IPC.statusPush, l)
    return () => ipcRenderer.removeListener(IPC.statusPush, l)
  },
  onNavigate: (cb) => {
    const l = (_e: IpcRendererEvent, route: string): void => cb(route)
    ipcRenderer.on(IPC.navigate, l)
    return () => ipcRenderer.removeListener(IPC.navigate, l)
  },

  startSession: () => inv(IPC.startSession),
  pauseSession: () => inv(IPC.pauseSession),
  resumeSession: () => inv(IPC.resumeSession),
  stopSession: () => inv(IPC.stopSession),
  skipBreak: () => inv(IPC.skipBreak),

  getStats: () => inv(IPC.getStats),
  getSessions: () => inv(IPC.getSessions),

  getSettings: () => inv(IPC.getSettings),
  saveSettings: (patch) => inv(IPC.saveSettings, patch),
  onSettingsChanged: (cb) => {
    const l = (_e: IpcRendererEvent, s: Settings): void => cb(s)
    ipcRenderer.on(IPC.settingsChanged, l)
    return () => ipcRenderer.removeListener(IPC.settingsChanged, l)
  },
  resetData: () => inv(IPC.resetData),

  openSettings: () => inv(IPC.openSettings),
  togglePanel: () => inv(IPC.togglePanel),
  closePanel: () => inv(IPC.closePanel),
  closeWindow: () => inv(IPC.closeWindow),
  dragStart: () => inv(IPC.dragStart),
  dragEnd: () => inv(IPC.dragEnd),
  setIgnoreMouse: (ignore) => inv(IPC.setIgnoreMouse, ignore === true),

  getPermissions: () => inv(IPC.getPermissions),
  openPermissionSettings: (kind) => inv(IPC.openPermissionSettings, kind === 'automation' ? 'automation' : 'screenRecording'),
  requestAutomation: () => inv(IPC.requestAutomation),
  dismissOnboarding: () => inv(IPC.dismissOnboarding),
  relaunchApp: () => inv(IPC.relaunchApp),

  getDeadlines: () => inv(IPC.getDeadlines),
  refreshDeadlines: () => inv(IPC.refreshDeadlines),
  getPlan: () => inv(IPC.getPlan),
  generatePlan: () => inv(IPC.generatePlan),
  addPlanReminders: () => inv(IPC.addPlanReminders),

  openExternal: (url) => inv(IPC.openExternal, str(url, 2048)),
  ai
}

contextBridge.exposeInMainWorld('studyPet', api)
