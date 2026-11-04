import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppStatus, StudyPetApi } from '../shared/types'

const inv = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

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
  resetData: () => inv(IPC.resetData),

  openSettings: () => inv(IPC.openSettings),
  togglePanel: () => inv(IPC.togglePanel),
  closePanel: () => inv(IPC.closePanel),
  closeWindow: () => inv(IPC.closeWindow),
  dragStart: () => inv(IPC.dragStart),
  dragEnd: () => inv(IPC.dragEnd),
  setIgnoreMouse: (ignore) => inv(IPC.setIgnoreMouse, ignore),

  getPermissions: () => inv(IPC.getPermissions),
  openPermissionSettings: (kind) => inv(IPC.openPermissionSettings, kind),
  requestAutomation: () => inv(IPC.requestAutomation),
  dismissOnboarding: () => inv(IPC.dismissOnboarding),

  getDeadlines: () => inv(IPC.getDeadlines),
  refreshDeadlines: () => inv(IPC.refreshDeadlines),
  getPlan: () => inv(IPC.getPlan),
  generatePlan: () => inv(IPC.generatePlan),
  addPlanReminders: () => inv(IPC.addPlanReminders),
  hasApiKey: () => inv(IPC.hasApiKey)
}

contextBridge.exposeInMainWorld('studyPet', api)
