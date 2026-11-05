// vite-node config for `npm run model:check` (scripts/model-check/run.ts): the same '@shared' alias
// as the app, and stubs for the Electron-only modules some AI files import (never called here).
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const stub = resolve(here, 'electron-stub.mjs')

export default {
  resolve: {
    alias: {
      '@shared': resolve(here, '../../src/shared'),
      electron: stub,
      'electron-store': stub
    }
  },
  logLevel: 'error'
}
