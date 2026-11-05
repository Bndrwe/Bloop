// Stand-in for 'electron' / 'electron-store' when the model check runs in plain Node. The check never
// stores keys or opens windows; anything that reaches these throws or reads as empty.
export const app = { getPath: () => process.cwd(), isPackaged: false, getAppPath: () => process.cwd() }
export const safeStorage = { isEncryptionAvailable: () => false }
export default class Store {
  get() {
    return undefined
  }
  set() {}
}
