# Bloop 🌱

_Your little study pet._

## Download

**Get the app, not the source:** grab the installer for your computer from the
**[latest release](https://github.com/Bndrwe/StudyPet/releases/latest)** (Releases page → Assets).
No Node.js, no terminal, no `npm run dev`.

| Your device | Download this file |
|---|---|
| Mac with Apple Silicon (M1/M2/M3/M4) | `Bloop-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Bloop-<version>-mac-x64.dmg` |
| Windows 10/11, 64-bit (recommended) | `Bloop-Setup-<version>-win-x64.exe` (installer) |
| Windows 10/11, no install (USB stick, locked-down PC) | `Bloop-<version>-win-x64-portable.exe` |
| Linux, any x86_64 distro | `Bloop-<version>-linux-x86_64.AppImage` |
| Debian / Ubuntu | `bloop_<version>_amd64.deb` |

Which Mac do I have? Apple menu → **About This Mac**: "Chip: Apple M…" is Apple Silicon, "Processor: Intel…" is Intel. The `.zip` files in the release are the same Mac apps without the disk image. Windows on ARM PCs run the x64 build through emulation. `SHA256SUMS.txt` lists checksums for every file.

**First launch.** The builds are not code-signed yet, so your OS warns you once:

- **macOS**: open the `.dmg`, drag **Bloop** into **Applications**, then **right-click Bloop → Open → Open**. If macOS says the app "is damaged and can't be opened", run `xattr -cr /Applications/Bloop.app` in Terminal and open it again. Bloop then asks for Screen Recording (see [Permissions](#permissions-macos-only)).
- **Windows**: SmartScreen says "Windows protected your PC". Click **More info → Run anyway**.
- **Linux**: `chmod +x Bloop-*.AppImage` and run it (`sudo apt install ./bloop_*_amd64.deb` for the `.deb`). If the AppImage exits immediately on Ubuntu 24.04 or newer, start it with `--no-sandbox`. Focus tracking reads the active window with `xprop`/`xwininfo` (package `x11-utils`) and works on X11 sessions; on Wayland it can't see other apps' windows.

**Private repo note.** This repository is private, so the Releases page and downloads only work for people who have access to it on GitHub. To share Bloop publicly, make the repo public, or publish the release files from a separate public "releases" repo.

A small, cute desktop pet that lives in the top-right corner of your screen, watches whether you're focused, keeps a live **focus score**, and gently nudges you when you drift off task.

Built as the MVP for a university AI class project. Everything runs locally: your activity data never leaves your machine. The one optional exception is the AI study plan: with the Bloop model or Ollama it also stays on your computer, and with a cloud provider it sends your upcoming deadlines and focus stats to that provider, only when you click the button.

![Focus loop: focused on Code (100) → drifted to YouTube (59, pet worried) → back on track (65)](docs/screenshots/demo-flow.png)

*The core loop, captured from the running app: focus → drift → nudge → back on track.*

| | |
|:---:|:---:|
| ![Pet moods](docs/screenshots/pet-moods.png) | ![Panel](docs/screenshots/panel.png) |
| *Pet moods* | *Panel* |
| ![Settings](docs/screenshots/settings.png) | ![First-run permissions](docs/screenshots/onboarding.png) |
| *Settings* | *First-run permissions* |

![The pet cycling through every mood, on a white and a black background](docs/screenshots/pet-motion.gif)

*Every mood, animated with anime.js, on a white and a black desktop. Panel opening, score count-up and the chrome following the pointer: [panel-motion.gif](docs/screenshots/panel-motion.gif) (hero close-up: [panel-hero.png](docs/screenshots/panel-hero.png)) (WebM versions next to them in `docs/screenshots/`).*

---

## What it does

- **Pet overlay**: a frameless, transparent, always-on-top window (~180×180) in the top-right of your screen, above the taskbar on Windows. Drag it anywhere and it remembers where you left it. Hover to see your score and session timer. Click it to open a compact panel.
- **Moods**: idle (gentle bob), happy (focused), worried (drifting), sad (distracted for a while), sleeping (break or paused), celebrate (session done), wave (study reminder).
- **Focus tracking**: during a session it samples the frontmost app every 5 s. If a browser is in front (Chrome, Arc, Safari, Brave, Edge), it also works out the current site. On macOS it reads the tab URL; on Windows it infers the site from the window title. Each sample is classified as **focus**, **distract** or **neutral** using lists you can edit.
- **Nudges**: after 60 s on a distracting app or site the pet gets worried and says something encouraging. After 3 min you also get a system notification. It never nags more than once every 2 minutes, and it cheers when you come back.
- **Pomodoro sessions**: 25 min focus / 5 min break by default (configurable). The pet sleeps during breaks and wakes you up when it's time to work.
- **Study reminders**: recurring study blocks (days of the week + time). The pet waves and a notification offers to start a session.
- **History**: every session is saved with its start/end, duration, final score, top focus apps and top distractions. The panel shows today's average and a 7-day mini chart.
- **Tray icon** with Start session / Pause / Settings / Quit. On macOS it sits in the menu bar; on Windows it sits in the system tray near the clock.
- **Stretch features**: Brightspace deadlines via iCal, and an AI weekly study plan generated on-device (the Bloop model or Ollama) or by a cloud model.

## AI study plan

The panel's **AI study plan** card writes a week of study blocks from your deadlines and focus history. Pick where the AI runs in **Settings → AI**:

- **Auto** (default) uses the first option that is ready, in this order: (1) the cloud providers you turned on with **Use in Auto** (Settings → AI → Cloud; picking a cloud provider also turns it on, and it goes to the front), in your order and only if available, e.g. the Claude CLI installed and signed in; (2) the Bloop model (only after you turn it on, see below); (3) an Ollama model (`qwen3.5:0.8b` if you have it, otherwise your smallest). Cloud providers you haven't turned on are never used by Auto. If nothing is ready it says "Turn on a model in Settings → AI". Auto never downloads or pulls anything.
- **Use Local** runs on your computer. It has two separate options: the **Bloop model** and **Ollama models**.
- **Cloud** uses a CLI or API key you already have (see [Cloud AI](#cloud-ai)).

The panel card says which one it used (for example "via Bloop model (on-device)" or "via Ollama · qwen3.5:0.8b"). When nothing is ready it shows **Set up AI in Settings**. The **Test** button in Settings sends a one-line prompt to the current choice.

![Settings → AI, Use Local](docs/screenshots/settings-ai-local.png)

### Use Local: the Bloop model

The Bloop model is [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) (Apache-2.0), packaged as a Q4_K_M GGUF of **532 MB**. Bloop runs it inside the app with [node-llama-cpp](https://node-llama-cpp.withcat.ai), so the prompt and the plan never leave your computer, it works offline, and you don't need Ollama. By default it's the stock model. A fine-tuned build from the kit in `ml/` can replace it (see below).

- **Download from inside Bloop, only when you say so.** Go to **Settings → AI → Use Local → Bloop model → Download…**. Choosing it, or pressing Generate while it's selected, asks first: "Download the Bloop model (~532 MB)? It runs on this device, nothing leaves your computer." with **Download** and **Not now**. Nothing is fetched until you press Download.
  - The source is [unsloth/Qwen3.5-0.8B-GGUF](https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF) (`Qwen3.5-0.8B-Q4_K_M.gguf`), pinned to a fixed revision.
  - The file goes to `<userData>/models/`. Downloads resume after a cancel, check free disk space first, and are verified against the file's sha256. **Delete** removes it.
- **Or bundle it into the app** (off until chosen). If the app was built with a model in `resources/models/`, **Settings → AI → Use Local → Bloop model** shows "included with Bloop · off" and a **Use Bloop model** button.
  - Nothing runs, not even for Auto, until you press it. **Turn off** switches it back and returns to Auto.
  - A bundled model can't be deleted from the UI, and it wins over a downloaded one. The first time you turn it on, Bloop checks its sha256 (a few seconds, remembered after that).
- **Import .gguf…** uses a GGUF file you already have, for example a fine-tuned one, instead of downloading.
- **How it runs:** the model loads on first use with a 4096-token context, the GGUF's own chat template, thinking turned off, and the plan's JSON schema enforced as a grammar. It unloads after 5 idle minutes, and llama.cpp works on native background threads, so the UI never stalls.

![Download confirmation](docs/screenshots/settings-ai-confirm.png)
![Bloop model included, off](docs/screenshots/settings-ai-bundled-off.png)
![Bloop model on](docs/screenshots/settings-ai-bundled-on.png)

**Changing the download source.** The constants at the top of `src/main/ai/local/bloop.ts` define what **Download** fetches:

```ts
export const BLOOP_MODEL_URL = 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/<revision>/Qwen3.5-0.8B-Q4_K_M.gguf'
export const BLOOP_MODEL_SHA256 = 'bd258782…dc517' // shasum -a 256 file.gguf
export const BLOOP_MODEL_BYTES = 532_517_120       // exact size; used for "~X MB" and the disk-space check
```

To ship a fine-tuned model instead, point these at your own direct-download link. That can be a public Hugging Face repo, a GitHub Release on a public repo, or any static host. Or skip hosting and bundle it.

**Fine-tuning (optional).** The kit in `ml/` LoRA-tunes Qwen3.5-0.8B on Bloop's study-plan and nudge tasks. It runs on a free Colab T4 or an Apple Silicon Mac; see `docs/BLOOP_MODEL_PLAYBOOK.md`, which is one file with every script and the dataset embedded. To bundle the result:

```bash
npm run model:bundle -- path/to/bloop-qwen3.5-0.8b-Q4_K_M.gguf   # copies it into resources/models/ + writes bloop-model.json
npm run build                                                   # packages it; warns, but still succeeds, when no .gguf is there
```

The `.gguf` and `bloop-model.json` are gitignored, because GitHub rejects files over 100 MB. A bundled model makes the app about **500 MB larger**. The app finds it at `<repo>/resources/models` in dev and at `<process.resourcesPath>/resources/models` when packaged. It is not packed into the asar.

**Packaging note.** `node-llama-cpp` and its prebuilt binaries (`@node-llama-cpp/*`) are listed in `build.asarUnpack` so the native libraries load from `app.asar.unpacked`. A packaged app never tries to compile llama.cpp: it uses the prebuilt binary for the platform (Metal on Apple silicon, CPU or Vulkan/CUDA elsewhere).

### Use Local: Ollama models

If you already use [Ollama](https://ollama.com/download), Bloop can use its models:

1. Install Ollama and open it (it serves on `http://127.0.0.1:11434`).
2. Pull the same small model the Bloop model uses: `ollama pull qwen3.5:0.8b` (any other model you have works too).
3. In **Settings → AI → Use Local**, pick a model from the **Ollama models** list and press **Refresh** if you just pulled one.

If Ollama is running without `qwen3.5:0.8b`, Bloop offers **Pull qwen3.5:0.8b with Ollama?** and pulls it only after you confirm. If Ollama is installed but closed, Bloop says "Ollama is installed but not running: open Ollama". A different Ollama address can be set under **Advanced**. Requests use `/api/chat` with the plan's JSON schema as `format` and `think: false`, so Qwen3.5 answers directly instead of reasoning at length first. If the server rejects the field, the request is retried once without it.

### `.env` fallback

`ANTHROPIC_API_KEY` in a `.env` file still works (copy `.env.example` to `.env`). It is read only in the main process, never sent to the UI, and used by the Anthropic API option when no key has been saved in Settings.

Bloop takes only `ANTHROPIC_API_KEY` from `.env` (nothing else in the file is applied, and a key already set in the environment wins). Where it looks, first match wins:

- **Installed app:** the Bloop data folder first, then the folder that holds the app.
  - macOS: `~/Library/Application Support/bloop/.env`, then next to `Bloop.app` (for example `/Applications/.env`)
  - Windows: `%APPDATA%\bloop\.env`, then next to `Bloop.exe` (or next to the portable `.exe`)
  - Linux: `~/.config/bloop/.env`, then next to the `.AppImage` (or `/opt/Bloop/` for the `.deb`)
- **`npm run dev`:** the project folder (and the folder you ran it from), then the data folder.

The log file says which `.env` the key came from, or where it looked.

### Cloud AI

Cloud AI lets the study plan run on a model you already pay for. Open the AI settings, choose **Cloud**, and pick a row. Auto only uses a cloud provider you turned on with **Use in Auto** (picking a provider turns it on and puts it first), and then falls back to local models. Cloud providers you haven't turned on are never used automatically.

**Your own CLIs (no key needed in Bloop).** Install the tool, then run it once in Terminal and sign in. Bloop finds it even when the app was launched from the Dock (it asks your login shell for its PATH and also checks Homebrew, `~/.local/bin`, npm, bun, volta, nvm and `%APPDATA%\npm`).

| CLI | Install | Sign in | How Bloop calls it |
| --- | --- | --- | --- |
| Claude Code | [setup guide](https://docs.claude.com/en/docs/claude-code/setup) | run `claude` | `claude -p --output-format json --no-session-persistence --tools "" [--model X]` |
| OpenAI Codex | [codex cli](https://developers.openai.com/codex/cli) | run `codex login` | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral [-m X] -` |
| Gemini CLI | [gemini-cli](https://github.com/google-gemini/gemini-cli#installation) | run `gemini` | `gemini --output-format json [-m X] -p "..."` |

The prompt goes over stdin (Gemini uses an argument for short prompts), tools are switched off or read-only, and the CLI runs in a temporary folder so it never reads your projects. Each call stops after 2 minutes. If a CLI is not logged in or hits a usage limit, Bloop shows a plain message such as "Claude CLI isn't logged in: run `claude` once in Terminal".

**API keys.** Get an Anthropic key at [console.anthropic.com](https://console.anthropic.com/settings/keys) or an OpenRouter key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), paste it into the row and press **Save**. The key is encrypted with your system's secure storage (macOS Keychain, Windows DPAPI or the Linux keyring) and kept in the app's settings file. It is never shown again and never sent to the UI; the row only says "key set". If secure storage is not available Bloop refuses to save the key. `ANTHROPIC_API_KEY` in `.env` still works as a fallback when no key has been saved.

**Choosing a model.** Every row has a model menu. "CLI default" passes no model flag, so the CLI uses its own default. OpenRouter has a searchable list of its current text models (fetched from the public model list and cached for 24 hours); you can also type any `vendor/model` id. Bloop remembers the model you pick for each provider.

**Privacy.** When a cloud option is active, the plan prompt is sent to that vendor (through the CLI you signed in to, or the API). It contains your upcoming deadline titles and dates, your daily focus totals and scores for the last 7 days, and your pomodoro and break lengths. It never contains app names, site names, window titles or URLs. Nothing is sent until you click **Generate plan**.

## Optional: Brightspace deadlines

In Brightspace open **Calendar → Subscribe** and copy the iCal URL. Paste it into **Settings → Brightspace calendar**. The panel then lists your next 5 deadlines, and the pet reminds you 3 days and 1 day before each exam.

## Permissions (macOS only)

On first run on macOS, Bloop checks its permissions and shows a short guide with buttons that open the right System Settings pane. Windows doesn't need any of these.

| Permission | Why | Without it |
|---|---|---|
| **Screen Recording** (Privacy & Security → Screen Recording) | macOS hides window titles from apps that don't have it | App names still work; window titles are blank |
| **Automation** (Privacy & Security → Automation → Bloop → your browser) | Lets Bloop ask Chrome / Arc / Safari for the current tab URL via AppleScript | Browsers count as *neutral*, so YouTube and Google Docs can't be told apart |
| **Notifications** | Distraction notifications and study reminders | The pet still talks in its speech bubble |

After you grant Screen Recording, click **Restart Bloop** on the welcome screen. macOS only re-reads that permission when the app launches.

### Permission still says "not granted"?

No script can grant these permissions; macOS only lets you tick the box yourself. What you can do from the terminal is clear stale entries and get walked through the panes:

```bash
npm run perms
```

It resets Bloop's Screen Recording and Automation entries (`tccutil reset`), then opens each System Settings pane in turn. Common causes:

- **You're running `npm run dev`.** macOS gives the permission to the app that launched Bloop, so turn on **Terminal** (or iTerm / VS Code) in Screen Recording, not Bloop. Use `npm run perms -- --dev` to also reset the "Electron" entry.
- **You rebuilt the app.** Each new unsigned build counts as a different app to macOS, so old grants stop matching. Run `npm run perms`, then grant again.
- **You didn't restart.** Screen Recording only takes effect after Bloop relaunches.

## How scoring works

Each sample (every 5 s) gets a category:

1. **Browser in front with a known URL**: the domain decides. Patterns match the exact host or any subdomain, so `brightspace` matches `purdue.brightspace.com` and `youtube.com` matches `m.youtube.com`. When several patterns match, the longest one wins. A browser on an unknown site is **neutral**.
2. **Any other app**: matched against the focus and distract app lists (case-insensitive).
3. Everything else is **neutral**.

The score ignores neutral time and measures the share of the remaining time you spent focused, with recent minutes counting more:

```
weight(sample) = 0.5 ^ (age_in_seconds / 600)        # 10-minute half-life
score = 100 × Σ weight·duration(focus) / Σ weight·duration(focus + distract)
```

So a distraction 10 minutes ago counts half as much as one right now, and you can always win your score back. If you haven't spent any time on a focus or distract app yet, the score is shown as "—".

The defaults (all editable in Settings):

- **Focus apps**: VS Code, Cursor, Terminal, iTerm2, Notion, Word, Pages, Preview, RStudio, Xcode, Obsidian
- **Focus sites**: brightspace, docs.google.com, overleaf, github, chatgpt, claude.ai, canvas/instructure, khanacademy, wikipedia, stackoverflow, scholar.google.com
- **Distracting apps**: Messages, Discord, Spotify, Steam, WhatsApp, FaceTime
- **Distracting sites**: youtube, instagram, tiktok, twitter/x, reddit, netflix, twitch, facebook

## Design

Bloop is strictly black and white. The canvas is pure black (`#000`), the ink is pure white (`#fff`), and a few neutral greys handle secondary text and hairlines. There are no gradients, glows, frosted glass or textures, with two exceptions: the chrome hero and the background smoke, both described below. Cards are flat black (92% opaque at low smoke intensity down to 72% at high, so the smoke shows through more as you turn it up) with a 1px grey hairline. Primary buttons are solid white with black text; secondary buttons are black with a white hairline. The only ornament is a fine grey zigzag rule. All colours are CSS custom properties on `:root` in `src/renderer/src/styles/base.css` (`--ink`, `--paper`, `--g1` … `--g5`).

Without colour, state is shown by **fill, outline, dashes, weight and words**:

| Meaning | How it shows |
|---|---|
| Focus app / site | solid white chip, black text |
| Distracting app / site | dashed white outline chip |
| Neutral | grey text, grey outline |
| Score 70+ / 40–69 / under 40 | heavy solid arc / thin arc / thin grey arc in the panel ring, plus a tilted sticker reading *on track* (solid white) / *wobbly* (outlined) / *drifting* (dashed) |
| Score next to the pet | a black coin with a white solid dot / half dot / empty ring inside (reads on any wallpaper) |
| Last-7-days bars | solid white (70+), white outline (40–69), hatched (under 40), grey stub (no focus), with a key under the chart; today is bold and underlined |
| Session phase | solid tag (Focus, Done), outlined (Break), dashed (Paused), grey (Idle) |
| Permissions | solid badge with a check (allowed), dashed badge with an alert (needs attention) |

The pet is black-and-white line art: a white body with a crisp black ink outline, black eyes with white highlights, and hatch-mark blush. Around the drawing is a flat white "sticker cut" edge (an SVG morphology filter, not a blur). On light wallpapers you see the black line; on dark wallpapers you see the white edge. Speech bubbles are white balloons with black ink, like a comic.

- **Chrome hero**: the top of the panel is a full-bleed hero. Liquid-chrome ribbons (`ShaderMetal`, a WebGL shader in `src/renderer/src/components/ui/shader-metal.tsx`, run with `iridescence={0}` and a CSS `grayscale(1)` so it stays achromatic) flow behind a large flat black score disc. The score is a giant Instrument Serif italic numeral on that disc; the phase, time left and pomodoros sit in a black pill underneath. Everything on top of the chrome is opaque black or white, so it reads whatever the ribbons are doing. The key light follows the pointer. The shader is a lit 3D material, the one place the flat rule bends. It holds a still frame under *reduce motion* and stops drawing entirely while the panel is hidden or unfocused. It is used nowhere else (and never in the transparent pet window).
- **Background smoke**: behind the panel, settings and onboarding windows, slow grey smoke folds over the black (`ShaderSmoke`, a WebGL shader in `src/renderer/src/components/ui/shader-smoke.tsx`: domain-warped noise lit like silk). It is the second sanctioned exception to "no gradients" and is strictly achromatic. **It is adjustable in Settings → Background**: an on/off toggle, an Intensity slider (0–100, default 55), a Speed slider (0–100, default 40; 0 is a still frame) and an Interactive toggle (default on; the pointer stirs the smoke). Changes apply live in every window. Intensity maps through a power curve to the brightest crest's grey: 0 is black, 25 a faint veil (about 12%), the default 55 shows clear silk folds with highlights around 29%, and 100 is bold (60%). Card opacity follows intensity (0.60 to 0.45, with a 14px backdrop blur) and tertiary text is lifted slightly at high settings so AA contrast holds (checked in `tests/background.test.ts`). The mapping lives in `src/shared/background.ts`. It renders at half resolution and at most 30 fps, stops while a window is hidden (and in the panel, when unfocused), and holds a still frame under *reduce motion*. It never appears in the pet window, and the panel's hero is inset and solid black, so the smoke shows around it without dulling the chrome. Levels: [background-levels.png](docs/screenshots/background-levels.png); motion: [background-motion.gif](docs/screenshots/background-motion.gif).
- **Components**: Tailwind CSS v4 (utilities and theme only, no preflight) with a shadcn-style layout: `@/` points at `src/renderer/src`, `cn()` lives in `@/lib/utils`, and components live in `src/renderer/src/components/ui`. Add more with `npx shadcn add <name>`. Tailwind only scans `components/`; the views keep their hand-written, namespaced CSS.
- **Typography**: Geist, Geist Mono and Instrument Serif. The fonts are bundled locally through `@fontsource`, so the app makes no network font requests.
- **Animation**: all motion runs on [anime.js](https://animejs.com) v4: the pet's mood choreography, the speech-bubble pop-in, the score ring and stat count-ups, chart bars growing in, staggered entrances for panels and settings chips, toasts, and the loading pulse. CSS transitions are only used for hover and focus feedback. With *reduce motion* turned on, everything settles into still poses or short fades.

## Develop (for developers only)

You only need this to work on Bloop's code. To use the app, see [Download](#download).

Requirements: macOS 12+, Windows 10/11 or Linux (x86_64), Node.js 20+.

```bash
git clone https://github.com/Bndrwe/StudyPet.git
cd StudyPet
npm install
npm run dev      # launch in development mode
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests (classifier + focus score) |
| `npm run typecheck` | Strict TypeScript check for main and renderer |
| `npm run build` | Typecheck, bundle, and produce an unsigned `Bloop.app` in `dist/mac*/` (macOS) |
| `npm run build:mac` | Same, but packages a `.dmg` and `.zip` for this Mac's architecture (macOS) |
| `npm run build:win` | Build an NSIS installer and a portable `.exe` into `dist/` (Windows, x64) |
| `npm run build:linux` | Build an AppImage and a `.deb` into `dist/` (Linux, x64) |

### Building on macOS

Because the build is unsigned, macOS Gatekeeper will complain the first time. Right-click the app, choose **Open**, then confirm.

### Building on Windows

`npm run build:win` writes an NSIS installer and a portable `.exe` to `dist/`. Run it on a Windows machine (after `npm install` there), because `get-windows` downloads its Windows native binary at install time, so a cross-build from macOS or Linux would ship without it. The build is unsigned, so SmartScreen will warn you the first time. Click **More info → Run anyway**.

Windows needs no special permissions. Active window detection works out of the box.

Browser tab URLs can't be read with AppleScript on Windows, so Bloop infers the site from the browser window title instead. For example, `YouTube — Google Chrome` is treated as youtube.com. This is a little less precise than on macOS, but the same site lists apply.

On Windows the pet sits at the top-right of the work area, above the taskbar, and the tray icon appears near the clock.

### Building on Linux

`npm run build:linux` writes `Bloop-<version>-linux-x86_64.AppImage` and `bloop_<version>_amd64.deb` to `dist/`. At runtime, active-window detection on Linux shells out to `xprop` and `xwininfo` (`x11-utils`; the `.deb` depends on it) and only works on X11.

### Releases

`.github/workflows/release.yml` builds every installer on its own native runner (macOS arm64, macOS Intel, Windows x64, Linux x64), launches each built app as a smoke test, and publishes them with `SHA256SUMS.txt` as a GitHub Release. Run it from the Actions tab (**Release → Run workflow**, which releases `v<package.json version>`) or push a tag like `v1.0.1`. Bump `version` in `package.json` first.

## Project structure

```
build/          app icon and other packaging resources
docs/
  screenshots/  images used in this README
src/
  shared/       types.ts (shared contract) and ipc.ts (channel names)
  preload/      typed contextBridge API exposed as window.studyPet
  main/         Electron main process: tracking, classification, scoring,
                sessions/nudges, storage, reminders, deadlines, AI plan,
                windows and tray
  renderer/     React UI: pet overlay, panel, settings, onboarding
    src/pet/    the pet component and swappable skins
tests/          vitest unit tests for the classifier and the score
```

`contextIsolation` is on, `nodeIntegration` is off, and the renderer is sandboxed. The renderer can only talk to the main process through the typed `StudyPetApi` in `src/shared/types.ts`.

### Custom pet art

The pet is drawn by one component that takes a `mood` prop. Skins live in `src/renderer/src/pet/skins/`. To add one, write a React component with the `PetSkin` signature (SVG, CSS or images) and register it in `skins/index.ts`.

## Demo / testing tips

- **Unit tests**: `npm test` runs the unit tests for the classifier and the focus score.
- **Faster timings**: set `BLOOP_FAST=1` to shorten Pomodoro and nudge timings. This is handy for demos.
- **Logs**: the installed app writes everything it prints (the `[bloop] ...` lines, errors and crashes) to `main.log`. Open it from the tray with **Open logs folder** (or **About Bloop**, which also shows the version). It lives in `~/Library/Logs/bloop/` on macOS, `%APPDATA%\bloop\logs\` on Windows and `~/.config/bloop/logs/` on Linux, and is rotated at 2 MB. It doesn't record which apps or sites you used unless you start Bloop with `BLOOP_TRACE=1`, and **Reset all data** empties it.
- **Fake active window**: set `BLOOP_FAKE_ACTIVE=/path/to/file.json` and the tracker reads `{"app": "...", "url": "..."}` from that file instead of asking the OS. Edit the file while the app runs to simulate switching between apps and sites. This is useful for demos and automated testing.

## Roadmap

- **Customizable pets**: more skins, accessories and colours, unlocked by focus streaks
- **Onboarding quiz**: a short quiz about your courses and habits that builds a personalized routine (session lengths, reminders, focus lists)
- **Deeper Brightspace integration**: assignments, grades and course content, not just calendar events
- **Study environment setup**: one click opens your study apps and tabs, turns on macOS Focus mode, and starts a session
- Linux support, plus richer weekly insights

## Privacy

All tracking data (samples, sessions, settings) is stored as JSON in the app's user-data folder via `electron-store`. Nothing is uploaded. The AI study plan is the only feature that can send your data anywhere: with the Bloop model or Ollama it stays on your computer, and with a cloud option it goes to that provider only when you click **Generate plan**. The Bloop model download and Ollama pulls happen only after you confirm them.
