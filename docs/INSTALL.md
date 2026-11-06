# Installing Bloop

Bloop is a little study pet that lives on your desktop, notices when you drift off task, and nudges you back. This guide gets you from nothing to your first study session.

Everything runs on your computer. Your activity data is never uploaded.

**How installing works right now:** there are no ready-made downloads. You run one command that fetches the Bloop source code, builds the app on your computer and installs it like any other app. It takes about 3–6 minutes the first time and needs no administrator password.

---

## 1. Before you start

You need three things. The installer checks them and tells you exactly what to do if one is missing.

1. **Access to the Bloop repository on GitHub.** It's private. Ask the Bloop team to invite your GitHub account, then accept the invite (GitHub emails you). If GitHub shows "404 Not Found" for <https://github.com/Bndrwe/StudyPet>, you aren't signed in or haven't been invited yet.
2. **git and Node.js 20 or newer.** npm comes with Node.js.
3. **About 2 GB of free disk space** for the build tools and the build. Most of it is the `node_modules` folder inside the `StudyPet` folder.

Bloop runs on macOS 12 (Monterey) or newer, Windows 10/11 and 64-bit Linux. The installer builds for your computer's chip automatically (Apple Silicon or Intel on a Mac; x64 or ARM on Windows and Linux).

### Getting the tools

**macOS**
- git: run `xcode-select --install` in Terminal (or it comes with Homebrew).
- Node.js: `brew install node@20` with [Homebrew](https://brew.sh), or the LTS installer from <https://nodejs.org>. If you have Homebrew, the Bloop installer offers to run `brew install node@20` for you.
- GitHub CLI (recommended for signing in): `brew install gh`, then `gh auth login` and follow the prompts (choose GitHub.com, HTTPS, and "Login with a web browser").

**Windows**
- git: `winget install Git.Git`, or the installer from <https://git-scm.com/download/win>. It includes Git Credential Manager, which signs you in to GitHub through your browser the first time you clone.
- Node.js: `winget install OpenJS.NodeJS.LTS`, or the LTS installer from <https://nodejs.org>. The Bloop installer offers to run these `winget` commands for you.
- Close and reopen PowerShell after installing either one, so it can find them.

**Linux**
- git: `sudo apt install git` (Fedora: `sudo dnf install git`).
- Node.js 20+: the easiest way without sudo is [nvm](https://github.com/nvm-sh/nvm): install it, open a new terminal, then `nvm install 20`. Distro packages work too if they are version 20 or newer (`node -v` to check).
- GitHub CLI (recommended): see <https://github.com/cli/cli#linux--bsd>, then `gh auth login`.

---

## 2. Install

Open a terminal (macOS: **Terminal**; Windows: **PowerShell**; Linux: your terminal app), go to the folder where you want the source code to live (your home folder is fine), and paste the line for your system.

**macOS** (GitHub CLI)
```bash
gh repo clone Bndrwe/StudyPet -- -b claude/practical-davinci-ckp3nc && cd StudyPet && ./scripts/install.sh
```

**Windows** (PowerShell, Git for Windows)
```powershell
git clone -b claude/practical-davinci-ckp3nc https://github.com/Bndrwe/StudyPet.git; cd StudyPet; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

**Linux** (GitHub CLI)
```bash
gh repo clone Bndrwe/StudyPet -- -b claude/practical-davinci-ckp3nc && cd StudyPet && ./scripts/install.sh
```

**No GitHub CLI?** Plain git works on macOS and Linux too, as long as git can sign in to GitHub (Git Credential Manager, a [personal access token](https://github.com/settings/tokens) pasted as the password, or an SSH key with `git@github.com:Bndrwe/StudyPet.git`):
```bash
git clone -b claude/practical-davinci-ckp3nc https://github.com/Bndrwe/StudyPet.git && cd StudyPet && ./scripts/install.sh
```

**Already cloned the repo?** From the `StudyPet` folder run `npm run install-app` (macOS/Linux) or `npm run install-app:win` (Windows).

### What happens

The installer prints numbered steps as it goes:

1. Checks git, Node.js and npm (and offers to install Node.js if it's missing).
2. Pulls the latest code, if your copy has no local changes.
3. Installs the build tools (`npm ci`). This is the slow part the first time; it is skipped on later runs if nothing changed.
4. Type-checks and bundles the app.
5. Packages it with electron-builder for your system.
6. Installs it, replacing an older copy (it quits a running Bloop first), and deletes the build output to free space.
7. Starts Bloop.

| | Bloop is installed to | Shortcuts |
|---|---|---|
| macOS | `/Applications/Bloop.app` (or `~/Applications/Bloop.app` if your account can't write to `/Applications`) | Launchpad / Spotlight |
| Windows | `%LOCALAPPDATA%\Programs\Bloop` (`C:\Users\<you>\AppData\Local\Programs\Bloop`) | Start menu and Desktop; listed in **Settings → Apps → Installed apps** |
| Linux | `~/.local/opt/bloop/Bloop.AppImage` | the `bloop` command (`~/.local/bin/bloop`) and **Bloop** in your app menu |

Because you built Bloop on your own computer, the "unidentified developer" warnings that downloaded apps get don't apply: macOS Gatekeeper opens it normally and Windows SmartScreen doesn't step in. Windows Defender may scan it the first time it starts, which can take a few seconds.

### Installer options

| macOS / Linux | Windows | What it does |
|---|---|---|
| `--no-launch` | `-NoLaunch` | Install, but don't start Bloop |
| `--fast` | `-Fast` | Skip the type check |
| `--clean` | `-Clean` | Delete `node_modules`, `out` and `dist` first. Try this if a build fails strangely |
| `--no-pull` | `-NoPull` | Don't fetch the latest code; build what you have |
| `--keep-build` | `-KeepBuild` | Keep the build output in `dist/` |
| | `-NoDesktopShortcut` | Don't create a Desktop shortcut |

Example: `./scripts/install.sh --fast`, or on Windows `powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Fast`. With npm, put them after `--`: `npm run install-app -- --fast`.

---

## 3. macOS

### Where is Bloop?

Bloop has **no Dock icon and no regular window**. Look for:

- the little Bloop **icon in the menu bar** at the top of your screen (it shows a countdown during a session), and
- the **pet** in the top-right corner of your screen.

Click the menu bar icon to open the menu. From top to bottom it has the Focus score, **Start session** (or **Pause** / **Resume** and **Stop session** during a session), **Show panel**, **Hide pet** / **Show pet**, **Settings…**, **Chat with Bloop**, **About Bloop**, **Open logs folder** and **Quit Bloop**.

### Permissions walkthrough

The first time Bloop opens on a Mac, a welcome screen walks you through two permissions. Both are optional, but Bloop is much more useful with them.

| Permission | Why Bloop asks | If you skip it |
|---|---|---|
| **Screen Recording** | macOS hides window titles (like the name of the document you are in) from apps without this. Bloop does **not** record or save your screen. | App names still work, but window titles are blank. |
| **Automation** (your browser) | Lets Bloop ask Chrome, Arc, Brave, Edge or Safari for the address of your current tab, so it can tell Google Docs from YouTube. | Browsers count as "neutral", so study sites and distractions look the same. |

**Screen Recording**
1. On the welcome screen, click **Open Screen Recording settings**.
2. Turn the switch **on** next to **Bloop**. If macOS asks for your password, enter it.
3. Come back to Bloop and click **Relaunch Bloop**. macOS only applies Screen Recording after the app restarts, so this step matters.

**Automation**
1. Open one of the supported browsers (Chrome, Arc, Brave, Edge or Safari).
2. In Bloop's welcome screen, click **Ask for browser access**.
3. macOS asks whether Bloop may control your browser. Click **OK**.
4. If you missed the prompt, click **Open Automation settings** and turn on your browser under **Bloop**.

The badges on the welcome screen change from a dashed "needs attention" badge to a solid checkmark when a permission is working. Click **Continue** when you are done. You can skip the permissions and carry on; Bloop still works with what it has.

Later, everything is in **Settings → Permissions** (the menu bar menu shows **Permissions…** while one is missing): the live status, the same buttons, **Check again**, **Reset permissions…**, **Relaunch Bloop** and **Run setup again** to see the welcome screen again.

**After an update** macOS may ask for these permissions again, or show them as "not granted" even though the switch is on. Each build of an unsigned app looks like a new app to macOS. (The update that moved Bloop's app ID to `io.github.bndrwe.bloop` always needs this once.) To fix it:
1. Open **Settings → Permissions** and click **Reset permissions…**, then confirm. Bloop clears its old entries and opens the Screen Recording pane.
2. Turn on **Bloop** there.
3. Click **Relaunch Bloop**. Then, with your browser open, click **Ask for browser access**.

Terminal alternative: run `npm run perms` in the `StudyPet` folder. It clears the same entries and opens each settings pane in turn.

### Notifications

Bloop sends a system notification when you have been distracted for a few minutes, and for study reminders. The first time, macOS may ask to allow notifications; click **Allow**. If you missed it, open **System Settings → Notifications → Bloop** and turn them on. Without notifications the pet still talks in its speech bubble.

### Launch at login

Open Bloop's **Settings** (menu bar icon → **Settings…**) and turn on **Open Bloop when you log in**. It is off by default.

---

## 4. Windows

### Finding Bloop: the tray icon

The pet appears in the top-right of your screen, just above the taskbar. Bloop also has an icon in the **system tray** near the clock. Windows often hides new tray icons under the **^** arrow:

1. Click the **^** (Show hidden icons) arrow at the right of the taskbar.
2. You will see the Bloop icon. **Drag it onto the taskbar** next to the clock to keep it visible.

Or go to **Settings → Personalization → Taskbar → Other system tray icons** and switch **Bloop** on.

Click the tray icon to show or hide the panel. Right-click it for the same menu as on a Mac: Start session (or Pause, Resume and Stop session), Show panel, Hide pet / Show pet, Settings…, Chat with Bloop, About Bloop, Open logs folder and Quit Bloop.

### Notifications and Focus Assist

Windows needs no special permissions for Bloop. Notifications appear in the bottom-right corner. The installer gives the Start menu shortcut Bloop's notification ID (`io.github.bndrwe.bloop`), which Windows needs to show them. If you never see them:

- Turn off **Do not disturb / Focus assist** (Windows 11: **Settings → System → Notifications → Do not disturb**; Windows 10: **Settings → System → Focus assist → Off**), or allow Bloop as a priority app.
- Check **Settings → System → Notifications** and make sure Bloop is on in the app list.
- Make sure the **Bloop** shortcut is in the Start menu. Re-running the installer recreates it.

### Launch at login

Open Bloop's **Settings** (right-click the tray icon → **Settings…**) and turn on **Open Bloop when you log in**. It is off by default.

Bloop reads the active app, and works out the website from the browser window title (for example "YouTube - Google Chrome" counts as youtube.com). That is a little less precise than on a Mac.

### Windows on ARM

With the ARM version of Node.js, the installer builds a native ARM Bloop. Some of Bloop's native parts may not have ARM versions ready-made; if the build or the app fails, install the x64 Node.js instead and run the installer again. You then get the x64 app, which Windows runs through its built-in emulation.

---

## 5. Linux

The installer builds an AppImage and sets it up for your user only: `~/.local/opt/bloop/Bloop.AppImage`, a `bloop` command in `~/.local/bin`, an app-menu entry and icons. If `~/.local/bin` isn't on your PATH, it tells you the line to add to `~/.bashrc`.

It also adapts to your system:

- **No FUSE 2?** AppImages normally mount themselves with FUSE 2. Without it, Bloop is set up to unpack itself to a temporary folder at each start instead (a little slower). To use FUSE: `sudo apt install libfuse2` (Ubuntu 24.04 and newer: `libfuse2t64`; Fedora: `sudo dnf install fuse-libs`), then re-run the installer.
- **Ubuntu 23.10 and newer** restrict the kind of sandbox Electron apps use, which would make Bloop quit right away. The installer detects this and starts Bloop with `--no-sandbox`.

### Active-window detection

Bloop finds out which app you are using with the `xprop` and `xwininfo` tools, so it works on **X11** sessions. Install them if the installer says they are missing: `sudo apt install x11-utils` (Fedora: `sudo dnf install xprop xwininfo`).

On **Wayland** sessions, apps are not allowed to see which window is in front, so detection is **limited** and Bloop may not be able to tell what you are doing. If you can, choose **"Ubuntu on Xorg"** (or similar) on the login screen. Wayland apps running through XWayland may still be detected.

Bloop's tray icon depends on your desktop environment; some (like stock GNOME) need the AppIndicator extension to show tray icons. **Open Bloop when you log in** (Settings) writes `~/.config/autostart/bloop.desktop`.

---

## 6. First run

1. **Find the pet.** It appears in the **top-right corner** of your screen (above the taskbar on Windows). Drag it anywhere; Bloop remembers where you left it. Hover over it to see your score and timer, and click it to open the panel.
2. **Start a session.** Click the pet to open the panel and start a session, or use the tray / menu bar icon → **Start session**. The default is 25 minutes of focus and 5 minutes of break, and you can change this in **Settings**. While a session runs, Bloop checks the front app about every 5 seconds, keeps a live focus score, and gets worried (then sends a notification) if you stay on a distracting app or site.
3. **Make it yours.** In **Settings** you can edit the lists of focus and distracting apps and websites, nudge timing and study reminders.
4. **Optional: your deadlines.** In **Settings → Deadlines**, type your school's Brightspace address (e.g. `purdue.brightspace.com`) and press **Log in to Brightspace**. Sign in on your school's page in the window that opens; it closes by itself when you're in, and the panel starts listing what's due. The window gives up after 10 minutes. Bloop never sees your password. If your school blocks this, paste your Brightspace calendar (iCal) link in the same card instead. If Brightspace later stops accepting the saved login (this can happen after a restart), Settings shows **login expired** and a **Log in again** button.
5. **Optional: chat.** Choose **Chat with Bloop** from the tray or menu bar menu, or the button in the panel, to ask questions about your studies. Chats are saved on this computer only, in the `chats` folder inside your data folder (see [section 7](#where-your-data-lives)). Delete them with **Delete all chats** in the chat window.

**Hiding the pet.** Press **Ctrl+Shift+B** on Windows and Linux, or **⌘⇧B** on a Mac, to hide or show the pet. You can also use the eye button in the panel header, **Hide pet** in the tray or menu bar menu, or the pet's right-click menu. **Settings → Show the pet on screen** does the same. Bloop keeps tracking and sending notifications while the pet is hidden. With **Pop up for nudges while hidden** on (the default), a nudge shows the pet for about 8 seconds. Opening Bloop again always brings the pet back.

### Settings → AI (optional)

The panel has an **AI study plan** card that writes a week of study blocks from your deadlines and focus history. It only works once you pick where the AI runs, under **Settings → AI**:

- **Use Local (Ollama).** Install [Ollama](https://ollama.com/download) and open it, then run `ollama pull qwen3.5:0.8b` in a terminal (about 1 GB; any other model works too). In **Settings → AI → Use Local**, pick the model from the **Ollama models** list (press **Refresh** after pulling one). Everything stays on your computer. If Ollama is running but missing `qwen3.5:0.8b`, Bloop offers to pull it and only does so after you confirm.
- **Cloud.** Uses a tool or key you already have: the Claude, Codex or Gemini command-line tools, or an Anthropic or OpenRouter API key. With a cloud option, your upcoming deadline titles and focus totals are sent to that provider, and only when you click **Generate plan**.
- **Auto** (default) uses the first option that is ready. It never downloads or pulls anything on its own. See the README's [AI study plan](../README.md#ai-study-plan) section for the exact order.

The **Test** button in Settings sends a one-line prompt to check your choice works.

---

## 7. Updating and uninstalling

### Update

There is no automatic updater. To update, open a terminal in the `StudyPet` folder and run the installer again:

- macOS / Linux: `./scripts/install.sh`
- Windows: `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`

It pulls the latest code, rebuilds, quits the running Bloop and replaces it. Your history and settings are kept. If you changed files in the folder yourself, it skips the pull and tells you; `git stash` or `git checkout .` first if you want the latest code. On macOS, see "After an update" in [section 3](#3-macos) if a permission stops working.

### Where your data lives

| System | Data folder | Log file |
|---|---|---|
| macOS | `~/Library/Application Support/bloop` | `~/Library/Logs/bloop/main.log` |
| Windows | `%APPDATA%\bloop` (`C:\Users\<you>\AppData\Roaming\bloop`) | `%APPDATA%\bloop\logs\main.log` |
| Linux | `~/.config/bloop` | `~/.config/bloop/logs/main.log` |

Your sessions and settings are in `bloop.json` in the data folder. The tray / menu bar icon has **Open logs folder**, and **About Bloop** shows both paths.

To clear your history and reset settings without uninstalling, use **Settings → Reset data → Reset everything…** inside Bloop.

### Uninstall

- **macOS / Linux:** in the `StudyPet` folder, run `./scripts/uninstall.sh` (or `npm run uninstall-app`). On Linux the uninstaller is also copied to `~/.local/opt/bloop/uninstall.sh`, so it works even if you deleted the source folder. On macOS without the source folder: quit Bloop and drag it from Applications to the Trash.
- **Windows:** **Settings → Apps → Installed apps → Bloop → Uninstall**, or `powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1` in the `StudyPet` folder.

The uninstaller removes the app, its shortcuts and menu entries, and launch-at-login, then **asks** before deleting your data folder Add `--keep-data` / `-KeepData` to keep it without asking, or `--purge` / `-Purge` to delete it without asking. Finally, delete the `StudyPet` source folder to free the disk space the build tools used.

---

## 8. Troubleshooting

**The install command fails before building.**
- "Repository not found" / "404" / a password prompt that rejects your password: you aren't signed in to GitHub with an account that has access. Run `gh auth login` (or, with plain git, use a personal access token as the password), and check you accepted the repo invite.
- "Node.js 20 or newer" / "too old": install the current LTS Node.js (section 1), open a **new** terminal, and run the command again.
- Windows: "running scripts is disabled on this system": use the full `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` command, which allows the installer for that one run only.

**The build fails partway.**
- Run the installer again with `--clean` (Windows: `-Clean`). That deletes the build tools and downloads them fresh, which fixes most problems.
- Check you have about 2 GB free.
- Behind a school or work network, `npm ci` and electron-builder need to download from npmjs.org and github.com. Try another network.
- Still stuck? Copy the last 30 lines the installer printed and send them to the Bloop team.

**I can't see the pet.**
- You may have hidden it: press **Ctrl+Shift+B** (Mac: **⌘⇧B**) or see the next question.
- Check that Bloop is running: look for the menu bar icon (Mac) or tray icon (Windows; check under the **^** arrow).
- Click that icon → **Show panel**. If the icon is there but the pet is not, quit Bloop and open it again.
- The pet sits in the top-right of your **main** display. If you disconnected a monitor, restart Bloop.
- Bloop only runs one copy at a time. If you opened it twice and nothing happened, it is probably already running.
- Linux: if Bloop quits as soon as it starts, the installer printed its last lines (also in `~/.local/opt/bloop/launch.log`). Try `bloop --no-sandbox` from a terminal.

**I hid the pet. How do I get it back?**
- Press **Ctrl+Shift+B** (Mac: **⌘⇧B**). The same shortcut hides it again.
- Or click the tray / menu bar icon → **Show pet**, or open the panel and click the eye button, or turn on **Settings → Show the pet on screen**.
- Or just open Bloop again (app menu, Start menu, Spotlight, or run `bloop` on Linux): a second launch always brings the pet and the panel back.
- Linux GNOME with no tray icon: the shortcut and opening Bloop again are the ways back. Bloop shows a notification saying so the first time you hide the pet. If another app already uses Ctrl+Shift+B, Bloop skips the shortcut and writes a line about it to `main.log`; then open Bloop again to get the pet back.
- Bloop remembers a hidden pet across restarts. While it's hidden, sessions, tracking and notifications keep working, and nudges pop the pet up for a few seconds unless you turned that off in Settings.

**macOS says Bloop "is damaged and can't be opened" or "can't be checked for malicious software".**
This doesn't happen with a copy the installer built, because macOS only checks apps that were downloaded. If you copied Bloop from someone else or from a downloaded release, run this in Terminal, then open Bloop again:
```bash
xattr -cr /Applications/Bloop.app
```
Or just run the installer on this Mac.

**Permissions still say "not granted" on macOS.**
- Did you click **Relaunch Bloop** after turning on Screen Recording? macOS only reads that permission when the app starts.
- Make sure the switch is on next to **Bloop** (not an old or duplicate entry) in **Privacy & Security → Screen Recording** and **Automation**.
- After an update, the old grant can stop matching. In Bloop, open **Settings → Permissions → Reset permissions…**, turn Bloop on again in Screen Recording and click **Relaunch Bloop**. Or run `npm run perms` in the `StudyPet` folder, or remove the Bloop entry with the **−** button, quit Bloop, open it again and grant the permission again.
- If you run Bloop from source with `npm run dev`, the permission belongs to your terminal app (Terminal, iTerm or VS Code), not Bloop. Turn that one on. Developers can run `npm run perms -- --dev`.
- Automation only says "granted" once a supported browser is open when you click **Ask for browser access**.

**I'm not getting notifications.**
- macOS: **System Settings → Notifications → Bloop**, turn on **Allow notifications**, and check Focus / Do Not Disturb isn't on.
- Windows: turn off Focus Assist / Do not disturb, check **Settings → System → Notifications**, and make sure the Bloop Start menu shortcut exists (re-run the installer to recreate it).
- Linux: a notification daemon must be running (most desktops have one).
- Bloop notifies after about 2 minutes on a distracting app or site, and at most once every 2 minutes. The pet looks worried and speaks up right away (Settings → Nudges).

**Ollama isn't found, or Use Local shows no models.**
- Install [Ollama](https://ollama.com/download) and open it; Bloop says "Ollama is installed but not running" if it's closed. Then press **Refresh** in **Settings → AI → Use Local**.
- Run `ollama pull qwen3.5:0.8b` (or any model) in a terminal, then **Refresh**.
- If Ollama runs on another address, set it under **Advanced** in the same place.
- You can also use **Cloud** instead.

**Where are the logs?**
Use the tray / menu bar icon → **Open logs folder**. Bloop writes everything it prints (lines starting with `[bloop]`, errors and crashes) to `main.log` there; the paths are in [section 7](#where-your-data-lives). The log doesn't record which apps or sites you used unless you start Bloop with `BLOOP_TRACE=1`. To watch it live, start Bloop from a terminal:
- macOS: `/Applications/Bloop.app/Contents/MacOS/Bloop`
- Windows (PowerShell): `& "$env:LOCALAPPDATA\Programs\Bloop\Bloop.exe"`
- Linux: `bloop`

Add `BLOOP_TRACE=1` before the command (PowerShell: `$env:BLOOP_TRACE=1` first) for extra detail about permissions and the active window. When asking for help, include `main.log` and your OS version.

---

## 9. Ready-made installers (not published yet)

There are no downloadable installers (`.dmg`, `.exe`, AppImage or `.deb`) yet, because the repo is private. Use the install command in [section 2](#2-install) instead.

`.github/workflows/release.yml` can build them and publish them as a GitHub Release when GitHub Actions minutes are available. Developers can also build them on their own machine with `npm run build:mac` / `build:win` / `build:linux`. Files built elsewhere are unsigned, so the first launch shows a warning once:

- **macOS:** open the `.dmg`, drag **Bloop** into **Applications**, then **right-click Bloop → Open → Open** (or run `xattr -cr /Applications/Bloop.app`).
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info → Run anyway**.
- **Linux:** `chmod +x Bloop-*.AppImage` and run it (add `--no-sandbox` if it quits at once on Ubuntu 23.10+), or `sudo apt install ./bloop_*_amd64.deb`.

A published release would include `SHA256SUMS.txt`; compare it with `shasum -a 256 <file>` (macOS/Linux) or `Get-FileHash <file>` (Windows).
