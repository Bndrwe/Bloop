# Bloop (Study Pet)

Mac-first Electron + React + TypeScript desktop study companion. Bloop is the pet. Product
direction lives in `docs/PRODUCT.md` (read it before adding features; UI copy is short and plain,
no em dashes). Design is monochrome ink: tokens in `src/renderer/src/styles/base.css`, state shown
by fill vs outline vs dashes, never colour.

## Layout

- `src/main/` Electron main process. `index.ts` builds the windows and engine and registers IPC.
  Feature areas register their own IPC from a wiring module (`chatApp.ts`, `planner/app.ts`).
- `src/preload/index.ts` exposes `window.studyPet` (named functions only, args coerced).
- `src/shared/` types and IPC channel names used by both sides. No electron/node imports.
- `src/renderer/src/` React UI. Routes by hash: `#/pet`, `#/panel`, `#/settings`, ...
- `tests/` Vitest (node env). `npm test`, `npm run typecheck`, `npm run build:vite`.

## Rules that tests enforce

- Every `ipcMain.handle` lives inside a guarded wrapper that calls `guardSender` first, and only the
  files listed in `tests/security-v2-ipc.test.ts` may register handlers. A new IPC module must be
  added there along with its guard check.
- AI calls go through `src/main/ai/registry.ts` (`generateText`), which picks the user's provider
  (Claude API key, Claude/other CLI, or Ollama). Keys never reach a renderer.

## Running locally

`npm ci`, then `npm run build:vite && npx electron .` (launch from the repo root so the IPC guard
recognises the renderer path). From a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first.

## Study planner, website blocker, Google (added 2026-11)

All three are wired in `src/main/planner/app.ts` (`registerPlanner`, called from `startApp`). It
owns `userData/planner.json` (electron-store), the IPC for `planner:*`, `blocker:*` and
`google:*`, and a 15 s ticker. The contract is in `src/shared/planner.ts`.

### Planner (`src/main/planner/`)

- `classify.ts` asks the AI to label each item `project` (3-8 concrete steps), `task` (1-2 blocks)
  or `skip` (lectures, office hours), in batches with a JSON schema. If no AI is ready or the
  answer is unusable, `ruleClassify` (keyword rules) decides, so the planner always works. The
  panel shows a note when the rules were used.
- `schedule.ts` is pure. It places blocks inside the daily study window (default 16:00-22:00,
  windows past midnight supported) on a 15-minute grid, earliest-due task first, a project's steps
  in order, preferring one step per task per day. Blocks never overlap and always end by the due
  date; a step that can't fit gets `block: null` and the UI says so. Done blocks and the block
  running now stay put; missed and future ones are re-placed on every change, and the ticker
  re-plans as soon as a block ends without being checked off. Blocks are placed at most 60 days
  ahead (`HORIZON_DAYS`) and due dates over two years out are refused, so the work stays bounded.
- `service.ts` (`PlannerService`) holds tasks, the window and `dismissed` deadline uids. Async
  work (add, sync) is serialized through a promise queue. Every change runs the scheduler, saves
  and pushes `planner:push`.
- Sources: manual entry (panel "Add") and the existing deadlines cache (`getDeadlines()`, which
  merges Brightspace and the iCal feed). The ticker re-syncs whenever the cache's `fetchedAt`
  changes; items already imported, removed by the user, or classified `skip` are not re-asked.
- When a block starts, the ticker sends a system notification.

### Website blocker (`src/main/blocker/`)

- Approach: `/etc/hosts`. Bloop's own marked section points each site (plus `www.` and `m.`) to
  `0.0.0.0` / `::`, then flushes the DNS cache. It works across Safari, Chrome, Arc, Edge and
  Firefox (unless Firefox's DNS over HTTPS is on).
- Root access: on first use, `siteBlocker.ts` runs `osascript ... with administrator privileges`
  (the one macOS password prompt) to install a root-owned helper at
  `/Library/PrivilegedHelperTools/io.github.bndrwe.bloop.siteblocker` and a sudoers rule
  (`/etc/sudoers.d/bloop-site-blocker`, checked with `visudo`) that lets this user run only that
  helper without a password. After that, Bloop calls `sudo -n <helper> block|unblock`. The helper
  (`HELPER_SCRIPT` in `hosts.ts`) only rewrites Bloop's section, rejects anything that isn't a
  plain lowercase hostname, refuses `PROTECTED_DOMAINS` (Apple, iCloud, certificate hosts), writes
  a temp file next to `/etc/hosts` and moves it over atomically, and has no environment overrides
  (it runs as root; tests rewrite its `HOSTS=` line). The install stages files only in root-owned
  folders and checks the sudoers rule with `visudo`. Change the script → bump `HELPER_VERSION`
  (it reinstalls once). Keep `renderHosts` (TS) and the script's awk in step: a test compares them.
- `controller.ts` (`BlockerController`) decides: blocked while the manual switch is on, or while a
  scheduled, not-done study block runs. It reconciles one change at a time. If the admin prompt is
  turned down, scheduled blocks don't prompt again until the user flips the switch. Quit and Reset
  lift the block synchronously and `dispose()` the old instances so in-flight work can't re-block
  or write data back; launch clears any stale block (no prompt). A failed change isn't retried
  every tick.
- The site list is seeded once from Settings → Distracting sites, then edited in Settings →
  Website blocker. Windows/Linux: `supported: false`, and the UI hides the card.
- To uninstall the helper: `sudo rm /Library/PrivilegedHelperTools/io.github.bndrwe.bloop.siteblocker /etc/sudoers.d/bloop-site-blocker`.

### Google (`src/main/google/integration.ts`)

Mock only. `GoogleIntegration` is the interface; `MockGoogleIntegration` stores a connected flag
per service (Gmail, Calendar). There is no OAuth and no API call. To make it real, implement the
same interface (OAuth with a loopback redirect, tokens via `safeStorage` like
`src/main/ai/cloud/secrets.ts`) and swap it in at `makeGoogle()` in `planner/app.ts`. IPC, preload
and UI only see `GoogleStatus`, so nothing else changes.

### UI

- Panel (`views/planner/`): `PlannerCard` lists projects (click for `ProjectDetail`: steps with
  blocks and done checkboxes) and small tasks (blocks with checkboxes inline), plus an Add form.
  `BlockerCard` shows whether blocking is on, why, and the manual switch.
- Settings: `PlannerSettings` adds Study planner (window), Website blocker (site list) and Google.
- Live data comes from `hooks/usePlanner.ts` (`usePlanner`, `useBlocker`).

### Tests

`tests/planner-schedule|planner-classify|planner-service.test.ts`, `tests/blocker.test.ts` (it runs
the real helper script with `sh` against a temp hosts file), `tests/google-mock.test.ts`.
