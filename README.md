# Bloop 🌱

_Your little study pet._

![Bloop in 10 seconds: focus, drift, nudge, back on track](docs/demo/bloop-ad.gif)

**Watch the ad:** [16:9](docs/demo/bloop-ad.mp4) · [vertical 9:16](docs/demo/bloop-ad-vertical.mp4) (42 s, real Bloop UI with simulated activity). More stills in [`docs/demo/`](docs/demo/).

A small, cute desktop pet that lives in the top-right corner of your screen, watches whether you're focused, keeps a live **focus score**, and gently nudges you when you drift off task.

Built as the MVP for a university AI class project. Everything runs locally: your activity data never leaves your machine. The one optional exception is the AI study plan: with the Bloop model or Ollama it also stays on your computer, and with a cloud provider it sends your upcoming deadlines and focus stats to that provider, only when you click the button.

## Install

Bloop installs with one command that builds the app on your own computer from this repo and then installs it like a normal app (in Applications, the Start menu or your app menu). There are no downloadable installers at the moment, so this is the way to get it.

**Before you start**

- **Access to this repo.** It's private: your GitHub account needs to be invited (ask the Bloop team), and you sign in once on your computer (the GitHub CLI or Git asks you to).
- **git and Node.js 20 or newer** (npm comes with Node). The installer checks for both and tells you how to get whatever is missing. On a Mac it offers `brew install node@20`; on Windows it offers `winget install`. It always asks first.
- **About 2 GB of free disk space** while it builds. The first install takes about 3–6 minutes; later updates are quicker.

### macOS: Terminal

Open **Terminal** (⌘ Space, type "Terminal"). One-time setup, if you don't have them yet ([Homebrew](https://brew.sh) first):

```bash
brew install gh node@20
```

```bash
gh auth login
```

(choose GitHub.com → HTTPS → Login with a web browser). Then install Bloop:

```bash
gh repo clone Bndrwe/StudyPet -- -b claude/practical-davinci-ckp3nc && cd StudyPet && ./scripts/install.sh
```

### Windows: PowerShell

One-time setup, if you don't have them yet (then close and reopen PowerShell):

```powershell
winget install Git.Git OpenJS.NodeJS.LTS
```

Then install Bloop (Git opens a browser window to sign in to GitHub the first time):

```powershell
git clone -b claude/practical-davinci-ckp3nc https://github.com/Bndrwe/StudyPet.git; cd StudyPet; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

### Linux: terminal

One-time setup: install the [GitHub CLI](https://cli.github.com), git and Node.js 20+ from your distro or [nvm](https://github.com/nvm-sh/nvm), plus `x11-utils` for focus tracking, then run `gh auth login`. Then:

```bash
gh repo clone Bndrwe/StudyPet -- -b claude/practical-davinci-ckp3nc && cd StudyPet && ./scripts/install.sh
```

**Other ways to get the code.** Plain git works on every system if you are signed in to GitHub (Git Credential Manager, a personal access token as the password, or SSH with `git@github.com:Bndrwe/StudyPet.git`):

```bash
git clone -b claude/practical-davinci-ckp3nc https://github.com/Bndrwe/StudyPet.git && cd StudyPet && ./scripts/install.sh
```

### After installing

- **Mac:** Bloop has no Dock icon. Look for it in the **menu bar** (top right); the pet sits in the top-right corner of your screen. The first launch walks you through **Screen Recording** and **Automation**; after allowing Screen Recording, click **Restart Bloop**.
- **Windows:** Bloop is in the Start menu and in the system tray by the clock (it may be under the **^** overflow; drag it out to pin it).
- **Linux:** open Bloop from your app menu or run `bloop`.
- Click the pet to open the panel and press **Start**. For AI study plans, open **Settings → AI** and choose **Use Bloop model**. The installer already downloaded and verified the on-device Bloop model (532 MB), but it stays off until you choose that. If you installed with `--no-model` or the download failed, Settings → AI offers it (it asks first).

Already have the repo? From its folder, run `npm run install-app` (macOS/Linux) or `npm run install-app:win` (Windows).

**What the installer does.** It checks git and Node, pulls the latest code, runs `npm ci`, type-checks, bundles the app and packages it with electron-builder for your CPU (Apple Silicon or Intel, x64 or arm64). While it builds, it also downloads the on-device Bloop model (532 MB, checked against its sha256) into your data folder, so there's no wait later. The model is off until you choose **Use Bloop model** in Settings → AI. If you're offline or the download fails, the install still finishes and the app offers the download later; re-running the installer resumes it, and skips it if the verified file is already there. Then it installs the app, quitting a running Bloop first, and starts it:

| | App | Your data | Logs |
|---|---|---|---|
| macOS | `/Applications/Bloop.app` (or `~/Applications` if `/Applications` isn't writable) | `~/Library/Application Support/bloop` | `~/Library/Logs/bloop/main.log` |
| Windows | `%LOCALAPPDATA%\Programs\Bloop`, plus Start menu and Desktop shortcuts, listed in Settings → Apps | `%APPDATA%\bloop` | `%APPDATA%\bloop\logs\main.log` |
| Linux | `~/.local/opt/bloop/Bloop.AppImage`, the `bloop` command in `~/.local/bin` and an app-menu entry | `~/.config/bloop` | `~/.config/bloop/logs/main.log` |

The tray / menu bar icon has **Open logs folder**. Because you built the app yourself, macOS Gatekeeper and Windows SmartScreen don't block it (Windows Defender may scan it on first start). On Linux, focus tracking needs `xprop` (`sudo apt install x11-utils`) and an X11 session; the installer tells you if anything is missing.

Options: `--no-launch`, `--fast` (skip the type check), `--clean` (delete `node_modules`, `out` and `dist` first; fixes most odd build errors), `--no-pull`, `--keep-build`, `--no-model` (skip the Bloop model download), `--model-only` (only download and verify the Bloop model, then stop). On Windows: `-NoLaunch`, `-Fast`, `-Clean`, `-NoPull`, `-KeepBuild`, `-NoDesktopShortcut`, `-NoModel`, `-ModelOnly`. With npm, pass them after `--`, e.g. `npm run install-app -- --fast`.

**Update.** Run the same install command again from the `StudyPet` folder (`./scripts/install.sh`, or `scripts\install.ps1` on Windows). It pulls the latest code, rebuilds, and replaces the app. Your settings and history are kept. On macOS each rebuild is a new unsigned app as far as macOS is concerned, so it may ask for Screen Recording and Automation again; if a permission says "not granted" after an update, run `npm run perms`.

**Uninstall.** `./scripts/uninstall.sh` (or `npm run uninstall-app`) on macOS and Linux; on Windows, Settings → Apps → Installed apps → Bloop → Uninstall, or `powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1`. It removes the app and its shortcuts, then asks before deleting your data, which includes the downloaded Bloop model (532 MB); `--keep-data` (`-KeepData` on Windows) keeps it.

Step-by-step help, permissions and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

There are no prebuilt installers (`.dmg`, `.exe`, AppImage) yet. You can build them yourself with `npm run build:mac` / `build:win` / `build:linux` (see [Releases](#releases)).

---

## What it does

- **Pet overlay**: a frameless, transparent, always-on-top window (~180×180) in the top-right of your screen, above the taskbar on Windows. Drag it anywhere and it remembers where you left it. Hover to see your score and session timer. Click it to open a compact panel; right-click it for **Hide pet / Open panel / Settings… / Quit Bloop**.
- **Hide the pet**: press **Ctrl+Shift+B** (**⌘⇧B** on a Mac) anywhere, use the eye button in the panel header, the tray's **Hide pet**, the pet's right-click menu, or **Settings → Show the pet on screen**. The same shortcut, or the tray's **Show pet**, brings it back. While it's hidden Bloop keeps tracking, running sessions and sending notifications, and a nudge pops the pet up for about 8 seconds (turn off **Pop up for nudges while hidden** for notifications only). The panel still opens from the tray, next to the tray icon or in the top-right corner. Opening Bloop again (from the app menu, Start menu or `bloop`) always brings the pet back.
- **Moods**: idle (gentle bob), happy (focused), worried (drifting), sad (distracted for a while), sleeping (break or paused), celebrate (session done), wave (study reminder).
- **Focus tracking**: during a session it samples the frontmost app every 5 s. If a browser is in front (Chrome, Arc, Safari, Brave, Edge), it also works out the current site. On macOS it reads the tab URL; on Windows it infers the site from the window title. Each sample is classified as **focus**, **distract** or **neutral** using lists you can edit.
- **Nudges**: after 60 s on a distracting app or site the pet gets worried and says something encouraging. After 3 min you also get a system notification. It never nags more than once every 2 minutes, and it cheers when you come back.
- **Pomodoro sessions**: 25 min focus / 5 min break by default (configurable). The pet sleeps during breaks and wakes you up when it's time to work.
- **Study reminders**: recurring study blocks (days of the week + time). The pet waves and a notification offers to start a session.
- **History**: every session is saved with its start/end, duration, final score, top focus apps and top distractions. The panel shows today's average and a 7-day mini chart.
- **Tray icon**, in this order: a status line (Focus score, or just "Bloop"), **Start session** (or **Pause** / **Resume** and **Stop session** while one runs), **Show panel**, **Hide pet** / **Show pet** (with the shortcut in brackets), **Settings…**, **Chat with Bloop**, **About Bloop** (with the version), **Open logs folder** and **Quit Bloop**. On macOS it sits in the menu bar; on Windows it sits in the system tray near the clock.
- **Chat with Bloop**: a chat window for study questions, saved on this computer. See [Chat with Bloop](#chat-with-bloop).
- **Stretch features**: Brightspace deadlines (log in to Brightspace, or paste the iCal link), and an AI weekly study plan generated on-device (the Bloop model or Ollama) or by a cloud model.

## Screenshots

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

**A day with Bloop** (stills from the ad: real Bloop UI on a simulated desktop)

| | |
|:---:|:---:|
| ![Study reminder: the pet waves, "Time to study!"](docs/demo/still-01.png) | ![Writing an essay: the pet is happy](docs/demo/still-02.png) |
| *Study reminder: Bloop waves and offers to start a session* | *Writing an essay: focused, the pet is happy* |
| ![Coding with the hover badge at 100](docs/demo/still-03.png) | ![Research on Khan Academy, Calculator counts as neutral](docs/demo/still-04.png) |
| *Coding: hover the pet to see the score and timer* | *Research and neutral apps don't move the score* |
| ![YouTube: the pet is sad and a notification says Bloop misses you](docs/demo/still-05.png) | ![Break: the pet sleeps, no nudges](docs/demo/still-06.png) |
| *Drifting off: a nudge, then a notification* | *Breaks are guilt-free: the pet naps* |
| ![The AI study plan in the panel](docs/demo/still-07.png) | ![Panel close-up with the score ring and 7-day chart](docs/demo/still-08.png) |
| *A study plan for the week, written on-device* | *Today's score, focus time and the last 7 days* |

![Every pet mood](docs/demo/still-10.png)

**The installed app, step by step** (packaged Linux build, first run)

| | | |
|:---:|:---:|:---:|
| ![First launch](docs/screenshots/journey/01-first-launch.png) | ![Focused on code](docs/screenshots/journey/04-focus-code.png) | ![Worried on YouTube](docs/screenshots/journey/06-worried-bubble.png) |
| *First launch* | *Focused* | *Drifted to YouTube* |
| ![Panel while distracted](docs/screenshots/journey/07-panel-distracted.png) | ![Back on track](docs/screenshots/journey/08-back-happy.png) | ![Stats after stopping](docs/screenshots/journey/10-stopped-stats.png) |
| *The panel shows what you're on* | *Back on track* | *Saved to today's stats* |

All 24 steps are in [`docs/screenshots/journey/`](docs/screenshots/journey/).

**Settings → AI**

| | |
|:---:|:---:|
| ![Auto order and Use in Auto switches](docs/screenshots/settings-ai-cloud-auto.png) | ![Use Local: Bloop model and Ollama](docs/screenshots/settings-ai-local.png) |
| *Auto only uses cloud models you turn on* | *On-device: the Bloop model and Ollama* |

## AI study plan

The panel's **AI study plan** card writes a week of study blocks from your deadlines and focus history. Pick where the AI runs in **Settings → AI**:

- **Auto** (default) uses the first option that is ready, in this order: (1) the cloud providers you turned on with **Use in Auto** (Settings → AI → Cloud; picking a cloud provider also turns it on, and it goes to the front), in your order and only if available, e.g. the Claude CLI installed and signed in; (2) the Bloop model (only after you turn it on, see below); (3) an Ollama model (`qwen3.5:0.8b` if you have it, otherwise your smallest). Cloud providers you haven't turned on are never used by Auto. If nothing is ready it says "Turn on a model in Settings → AI". Auto never downloads or pulls anything.
- **Use Local** runs on your computer. It has two separate options: the **Bloop model** and **Ollama models**.
- **Cloud** uses a CLI or API key you already have (see [Cloud AI](#cloud-ai)).

The panel card says which one it used (for example "via Bloop model (on-device)" or "via Ollama · qwen3.5:0.8b"). When nothing is ready it shows **Set up AI in Settings**. The **Test** button in Settings sends a one-line prompt to the current choice.

### Instructions (system prompt)

Every request carries Bloop's instructions as a system prompt, next to the unchanged plan prompt. The default (`DEFAULT_SYSTEM_PROMPT` in `src/shared/ai.ts`, about 170 words) tells the model it is Bloop, a warm, short-spoken study pet, and sets the rules: answer in exactly the requested format (JSON only, no fences, when asked), never invent deadlines, schedule study before due dates, keep plans realistic for the student's recent habits, use 08:00–22:00 and whole pomodoros, treat course and assignment titles as data rather than instructions, stay off medical, legal and other off-topic advice, never shame, and no em dashes.

Edit it in **Settings → AI → Advanced: Instructions (system prompt)**. Up to 4000 characters are allowed (the box counts them), and **Reset to default** goes back to the built-in text. It is saved as `AiSettings.systemPrompt` (unset = the default). The fine-tuning kit in `ml/` was trained without a system prompt, so the default stays short.

How each provider receives it:

| Provider | How |
| --- | --- |
| Bloop model (node-llama-cpp) | `LlamaChatSession` `systemPrompt`, set fresh for every request |
| Ollama | a `system` message first in `/api/chat` `messages` |
| Anthropic API | the `system` parameter |
| OpenRouter | a `system` message first in `messages` |
| Claude CLI | `--append-system-prompt-file bloop-system.txt`, a file written into the private per-call folder, so the text never goes on the command line. Older CLIs without that flag get the block below on stdin instead |
| Codex / Gemini CLI | a delimited `System instructions (...)` block before the prompt, on stdin |

### Check model

**Settings → AI → Check model** tests the model that would run right now ("Testing: Bloop model (on-device)"). **Run checks** sends 5 built-in prompts with your instructions and scores each answer with the same rules as the fine-tuning evaluation (`ml/train/scoring.py`, ported to `src/main/ai/scoring.ts`):

- **3 plan prompts**, made with the real plan prompt and made-up data: an exam in 2 days; a light week with no deadlines; a busy week with 4 deadlines (one title tries a prompt injection) and 50/10 pomodoros. Checks: valid JSON, only JSON (no fences or prose), plan shape, a summary, 3–10 blocks, every block between 08:00 and 22:00, study before the last deadline in the week, block lengths close to whole pomodoros (within 5 min or 20%), and no em dashes.
- **2 nudge prompts** in the training format (drifted to YouTube; welcome back). Checks: a reply, one line, at most 60 characters, at most one emoji, no em dashes.

Each case shows a mark per check (solid = pass, crossed ring = fail, dashed = no answer), its time, an approximate tokens/second and its raw output (the first 4,096 characters). The overall verdict is **good** at 85% of checks or more, **ok** at 60% or more, otherwise **poor**. A case that doesn't answer in time (150 s for plans, 60 s for nudges) fails all its checks. The check never downloads or pulls a model; if the selected one isn't ready it says why. With a cloud provider, the test prompts go to that vendor, so the card says so ("This sends 5 short test prompts to Claude CLI") and nothing runs until you click.

**Try a prompt**, under the check, sends your own text (up to 2000 characters) to the same model, with or without the instructions, and shows the reply and how long it took. With a cloud provider it sends only when you press **Send**.

Developers can run the same check without the app: `npm run model:check -- --provider ollama --model qwen3.5:0.8b`, `npm run model:check -- --gguf path/to/model.gguf`, `--provider anthropic` (uses `ANTHROPIC_API_KEY`), `--provider openrouter` (`OPENROUTER_API_KEY`) or `--provider claude-cli|codex-cli|gemini-cli`. Add `--system-file <path>` or `--no-system` to compare instructions, and `--json` for the full report. It exits 1 on a poor verdict.

![Check model results](docs/screenshots/settings-ai-check.png)
![Instructions (system prompt)](docs/screenshots/settings-ai-system-prompt.png)

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
export const BLOOP_MODEL_URL = 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf'
export const BLOOP_MODEL_SHA256 = 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517' // shasum -a 256 file.gguf
export const BLOOP_MODEL_BYTES = 532_517_120       // exact size; used for "~X MB" and the disk-space check
```

The installer reads the same three values (through `scripts/model-info.mjs`), so changing them changes both.

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
| Claude Code | [setup guide](https://docs.claude.com/en/docs/claude-code/setup) | run `claude` | `claude -p --output-format json --no-session-persistence --tools "" [--model X] --append-system-prompt-file bloop-system.txt` |
| OpenAI Codex | [codex cli](https://developers.openai.com/codex/cli) | run `codex login` | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral [-m X] -` |
| Gemini CLI | [gemini-cli](https://github.com/google-gemini/gemini-cli#installation) | run `gemini` | `gemini --output-format json [-m X] -p "..."` |

The prompt goes over stdin (Gemini uses an argument for short prompts), tools are switched off or read-only, and the CLI runs in a temporary folder so it never reads your projects. Each call stops after 2 minutes. If a CLI is not logged in or hits a usage limit, Bloop shows a plain message such as "Claude CLI isn't logged in: run `claude` once in Terminal".

**API keys.** Get an Anthropic key at [console.anthropic.com](https://console.anthropic.com/settings/keys) or an OpenRouter key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), paste it into the row and press **Save**. The key is encrypted with your system's secure storage (macOS Keychain, Windows DPAPI or the Linux keyring) and kept in the app's settings file. It is never shown again and never sent to the UI; the row only says "key set". If secure storage is not available Bloop refuses to save the key. `ANTHROPIC_API_KEY` in `.env` still works as a fallback when no key has been saved.

**Choosing a model.** Every row has a model menu. "CLI default" passes no model flag, so the CLI uses its own default. OpenRouter has a searchable list of its current text models (fetched from the public model list and cached for 24 hours); you can also type any `vendor/model` id. Bloop remembers the model you pick for each provider.

**Privacy.** When a cloud option is active, the plan prompt is sent to that vendor (through the CLI you signed in to, or the API). It contains your upcoming deadline titles and dates, your daily focus totals and scores for the last 7 days, and your pomodoro and break lengths. It never contains app names, site names, window titles or URLs. Bloop's instructions (system prompt) go with it. Nothing is sent until you click **Generate plan**. **Check model** and **Try a prompt** send their test prompts (made-up data, or the text you typed) to the selected provider only when you click **Run checks** or **Send**.

## Chat with Bloop

Talk to Bloop about your studies: "Plan my evening", "I can't focus, help", "Quiz me on CHEM 201". Open it from the tray (**Chat with Bloop**) or the **Chat with Bloop** button in the panel.

- Bloop answers with whichever AI is set up in Settings → AI (the Bloop model, an Ollama model, or a cloud provider you turned on). The header shows which one ("via …"). If nothing is ready, the chat offers **Set up AI in Settings → AI**. Chat never downloads or pulls a model.
- **Share my study stats with Bloop** (on by default for on-device models, off for cloud providers) adds today's date, your session and score, today's focus minutes and your next 3 deadlines to each message, so Bloop's advice fits your day. Turn it on or off with the switch under the message box.
- Enter sends, Shift+Enter adds a line, **Stop** cancels a reply (replies time out after 2 minutes). Failed replies show **Retry**.
- Conversations are saved on this computer only, in `userData/chats/` (one file per chat, at most 200 chats). Rename or delete them in the list (the trash button deletes one chat), or use **Delete all chats** (after a confirmation). **Settings → Reset data → Reset everything…** removes them too.
- With a cloud provider, each message (and the recent conversation) is sent to that vendor, and the chat window says so under the message box. See [docs/PRIVACY.md](docs/PRIVACY.md#chat-with-bloop).

![Chat with Bloop](docs/screenshots/chat.png)

## Optional: Brightspace deadlines

The panel lists your next 5 deadlines, and the pet reminds you 3 days and 1 day before each exam. Bloop can get them two ways, and you can use both at once (duplicates are merged):

**Log in to Brightspace** (assignments, quizzes and calendar events from all your courses)

1. Open **Settings → Deadlines**.
2. Type your school's Brightspace address, e.g. `purdue.brightspace.com` (a full link like `https://purdue.brightspace.com/d2l/home` works too).
3. Press **Log in to Brightspace**. Your school's own sign-in page opens in a separate window; sign in as usual, including any Microsoft, Okta or Duo step. If you don't finish within 10 minutes, the window closes and you can try again.
4. When Brightspace shows its home page, the window closes and Settings says **Connected as *your name* (*n* courses)**.

Bloop then reads your assignments (due dates), quizzes (due or end dates) and calendar events for the next 30 days, as "CHEM 201: Midterm 2". It syncs shortly after launch, every 2 hours, and when you press **Refresh**. Brightspace sessions expire. After a restart, Bloop may find that Brightspace no longer accepts the saved login. When that happens, Settings shows **login expired** and a **Log in again** button, and the panel says **Log in again in Settings**. **Log out** deletes the login cookies and the Brightspace items.

Bloop never sees your password: you type it into your school's page, and Bloop keeps only the cookies that page sets, in a separate browser profile inside Bloop's data folder. Requests go only to your school's Brightspace. Details: [docs/PRIVACY.md](docs/PRIVACY.md#brightspace-login).

Some schools turn off API access for students. If the sync says Brightspace didn't let Bloop read your courses, use the calendar link instead. Passkeys and security keys may not work in the login window; pick another sign-in method there.

**Or paste a calendar link** (works at every school)

1. In Brightspace open **Calendar → Subscribe** and copy the iCal link.
2. Paste it under **Settings → Deadlines → or paste a calendar link** and press **Refresh calendar**.

The link contains a private token, so treat it like a password.

| Connected | Not connected yet |
|---|---|
| ![Settings, Deadlines card, connected to Brightspace](docs/screenshots/settings-brightspace.png) | ![Settings, Deadlines card with the Log in to Brightspace button](docs/screenshots/settings-brightspace-login.png) |

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

You only need this to work on Bloop's code. To use the app, see [Install](#install).

Requirements: macOS 12+, Windows 10/11 or Linux (x86_64 or arm64; focus tracking needs X11 and `x11-utils`), git and Node.js 20+. `npm run dev` is for working on the code; to use Bloop day to day, install it with `npm run install-app` (see [Install](#install)).

```bash
git clone -b claude/practical-davinci-ckp3nc https://github.com/Bndrwe/StudyPet.git
cd StudyPet
npm install
npm run dev      # launch in development mode
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests (vitest): classifier, focus score, sessions, reminders, deadlines, AI providers, privacy/security guards and the Linux/Windows helpers |
| `npm run typecheck` | Strict TypeScript check for main and renderer |
| `npm run build` | Typecheck, bundle, and produce an unsigned `Bloop.app` in `dist/mac*/` (macOS) |
| `npm run build:mac` | Same, but packages a `.dmg` and `.zip` for this Mac's architecture (macOS) |
| `npm run build:win` | Build an NSIS installer and a portable `.exe` into `dist/` (Windows, x64) |
| `npm run build:linux` | Build an AppImage and a `.deb` into `dist/` (Linux, x64) |
| `npm run model:check -- --provider ollama --model qwen3.5:0.8b` | Run the [Check model](#check-model) cases from the command line (other providers and flags: see that section) |
| `npm run model:bundle` | Copy a `.gguf` into `resources/models/` so the app ships it (see [Fine-tuning](#use-local-the-bloop-model)) |

### Building on macOS

The build is ad-hoc signed, not notarized. A `Bloop.app` built on your own Mac opens normally (`npm run install-app` copies it to Applications for you). A copy that was downloaded or AirDropped is quarantined, so macOS blocks it the first time: right-click it, choose **Open**, then confirm, or run `xattr -cr /path/to/Bloop.app`.

### Building on Windows

`npm run build:win` writes an NSIS installer and a portable `.exe` to `dist/`. Run it on a Windows machine (after `npm install` there), because `get-windows` downloads its Windows native binary at install time, so a cross-build from macOS or Linux would ship without it. The build is unsigned, so SmartScreen will warn you the first time. Click **More info → Run anyway**.

Windows needs no special permissions. Active window detection works out of the box.

Browser tab URLs can't be read with AppleScript on Windows, so Bloop infers the site from the browser window title instead. For example, `YouTube — Google Chrome` is treated as youtube.com. This is a little less precise than on macOS, but the same site lists apply.

On Windows the pet sits at the top-right of the work area, above the taskbar, and the tray icon appears near the clock.

### Building on Linux

`npm run build:linux` writes `Bloop-<version>-linux-x86_64.AppImage` and `bloop_<version>_amd64.deb` to `dist/`. At runtime, active-window detection on Linux shells out to `xprop` and `xwininfo` (`x11-utils`; the `.deb` depends on it) and only works on X11.

### Releases

There are no published downloads yet. The repo is private, so people install with the [install scripts](#install).

`.github/workflows/release.yml` can build installers for every platform (macOS arm64, macOS Intel, Windows x64, Linux x64) on its own native runner, launch each built app as a smoke test, and publish them with `SHA256SUMS.txt` as a GitHub Release. Run it from the Actions tab (**Release → Run workflow**, which releases `v<package.json version>`) or push a tag like `v1.0.1`. Bump `version` in `package.json` first. It needs GitHub Actions minutes, which a private repo gets only in a limited amount.

To make an installer on your own machine, run `npm run build:mac` / `build:win` / `build:linux`. Those files are unsigned, so the first launch shows a warning (see [Building on macOS](#building-on-macos) and [Building on Windows](#building-on-windows)).

## Project structure

```
build/          app icon and other packaging resources
docs/
  screenshots/  images used in this README
src/
  shared/       types.ts (shared contract) and ipc.ts (channel names)
  preload/      typed contextBridge API exposed as window.studyPet
  main/         Electron main process: tracking, classification, scoring,
                sessions/nudges, storage, reminders, deadlines (iCal and
                Brightspace login: brightspace.ts, brightspaceApp.ts), AI plan,
                windows and tray
  renderer/     React UI: pet overlay, panel, settings, onboarding
    src/pet/    the pet component and swappable skins
scripts/        install/uninstall scripts, model bundling, macOS permissions helper
tests/          vitest unit tests (scoring, sessions, AI, security, platform helpers)
```

`contextIsolation` is on, `nodeIntegration` is off, and the renderer is sandboxed. The renderer can only talk to the main process through the typed `StudyPetApi` in `src/shared/types.ts`.

### Custom pet art

The pet is drawn by one component that takes a `mood` prop. Skins live in `src/renderer/src/pet/skins/`. To add one, write a React component with the `PetSkin` signature (SVG, CSS or images) and register it in `skins/index.ts`.

## Demo / testing tips

- **Unit tests**: `npm test` runs the whole vitest suite in `tests/`: classifier, focus score, sessions, reminders, deadlines, AI providers, privacy/security guards and the Linux/Windows helpers.
- **Faster timings**: set `BLOOP_FAST=1` to shorten Pomodoro and nudge timings. This is handy for demos.
- **Logs**: the installed app writes everything it prints (the `[bloop] ...` lines, errors and crashes) to `main.log`. Open it from the tray with **Open logs folder** (or **About Bloop**, which also shows the version). It lives in `~/Library/Logs/bloop/` on macOS, `%APPDATA%\bloop\logs\` on Windows and `~/.config/bloop/logs/` on Linux, and is rotated at 2 MB. It doesn't record which apps or sites you used unless you start Bloop with `BLOOP_TRACE=1`, and **Settings → Reset data → Reset everything…** empties it.
- **Fake active window**: set `BLOOP_FAKE_ACTIVE=/path/to/file.json` and the tracker reads `{"app": "...", "url": "..."}` from that file instead of asking the OS. Edit the file while the app runs to simulate switching between apps and sites. This is useful for demos and automated testing.

## Roadmap

- **Customizable pets**: more skins, accessories and colours, unlocked by focus streaks
- **Onboarding quiz**: a short quiz about your courses and habits that builds a personalized routine (session lengths, reminders, focus lists)
- **Deeper Brightspace integration**: grades and course content (assignments, quizzes and calendar events already sync when you log in)
- **Study environment setup**: one click opens your study apps and tabs, turns on macOS Focus mode, and starts a session
- **Linux on Wayland**: focus tracking works on X11 today; Wayland hides other apps' windows
- Richer weekly insights

## Privacy

All tracking data (samples, sessions, settings) is stored as JSON in the app's user-data folder via `electron-store`. Nothing is uploaded. If you log in to Brightspace, Bloop talks only to your school's Brightspace, keeps the login cookies in a separate browser profile in the same folder (never your password), and **Log out** deletes them. The AI study plan and Chat with Bloop are the only features that can send your data anywhere: with the Bloop model or Ollama it stays on your computer, and with a cloud option it goes to that provider only when you click **Generate plan** or send a chat message. Chats are stored only on this computer in `userData/chats/`. The installer downloads the Bloop model during install (unless you pass `--no-model`); the in-app download and Ollama pulls happen only after you confirm them.
