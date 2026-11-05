# Installing Bloop

Bloop is a little study pet that lives on your desktop, notices when you drift off task, and nudges you back. This guide gets you from download to your first study session.

Everything runs on your computer. Your activity data is never uploaded.

> **Heads up:** Bloop is not signed with a paid developer certificate, so macOS and Windows will show a warning the first time you open it. That is expected. Steps for getting past it are below.

---

## 1. Which file do I download?

Go to the latest release: <https://github.com/Bndrwe/StudyPet/releases/latest>

The Bloop repository is private, so you need to be signed in to a GitHub account that has been given access. If you see a "404" page, you are not signed in or you have not been added yet. Ask the Bloop team to invite you.

Open **Assets** at the bottom of the release page and pick the file for your device. Replace `<ver>` with the version number you see.

| Your device | Download this |
|---|---|
| Mac with Apple Silicon (M1, M2, M3, M4 or newer) | `Bloop-<ver>-mac-arm64.dmg` |
| Mac with an Intel chip | `Bloop-<ver>-mac-x64.dmg` |
| Windows 10 / 11, normal PC (most people) | `Bloop-Setup-<ver>-win-x64.exe` (installer) |
| Windows, no install wanted (USB stick, school PC) | `Bloop-<ver>-win-x64-portable.exe` |
| Linux, any distro | `Bloop-<ver>-linux-x86_64.AppImage` |
| Linux, Ubuntu / Debian / Mint | `bloop_<ver>_amd64.deb` |

`SHA256SUMS.txt` is only for checking your download (see [section 5](#5-verify-your-download-optional)). You do not need it to install.

### Apple Silicon or Intel?

1. Click the Apple menu () in the top-left corner of your screen.
2. Choose **About This Mac**.
3. Look at **Chip** or **Processor**:
   - **Chip: Apple M1** (or M2, M3, M4...) means **Apple Silicon**, so get `mac-arm64`.
   - **Processor: Intel Core...** means **Intel**, so get `mac-x64`.

Bloop needs macOS 12 (Monterey) or newer.

### x64 or ARM Windows?

1. Press **Windows key + I** to open Settings, then go to **System → About**.
2. Look at **System type**.
   - **64-bit operating system, x64-based processor** means you want the `win-x64` files. This is almost everyone.
   - **64-bit operating system, ARM-based processor** means you have an ARM PC (for example a Surface Pro X or a Snapdragon laptop). There is no separate ARM build. The x64 files may still run through Windows' built-in emulation, but this is untested, so treat it as a best effort.

---

## 2. macOS

### Install

1. Double-click the `.dmg` file you downloaded.
2. In the window that opens, drag **Bloop** onto the **Applications** folder.
3. Eject the disk image (right-click it in Finder's sidebar, then **Eject**) and delete the `.dmg` if you like.

### The first launch (unsigned app)

Because Bloop is unsigned, macOS will block a normal double-click the first time. Pick **one** of these:

**Option A: right-click Open (easiest)**
1. Open **Applications** in Finder.
2. **Right-click** (or Control-click) **Bloop** and choose **Open**.
3. Click **Open** in the warning box.

**Option B: Open Anyway**
1. Double-click Bloop once. macOS says it cannot open it. Click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security** and scroll down.
3. Next to the message about Bloop, click **Open Anyway**, then confirm and enter your password.

**Option C: Terminal (if the others do not work)**
```bash
xattr -cr /Applications/Bloop.app
```
Then open Bloop normally. This only removes the "downloaded from the internet" flag from Bloop.

You only need to do this once per install.

### Where is Bloop?

Bloop has **no Dock icon and no regular window**. Look for:

- the little Bloop **icon in the menu bar** at the top of your screen (it shows a countdown during a session), and
- the **pet** in the top-right corner of your screen.

Click the menu bar icon for Start session, Pause, Show panel, Settings and Quit.

### Permissions walkthrough

The first time Bloop opens on a Mac, a welcome screen walks you through two permissions. Both are optional, but Bloop is much more useful with them.

| Permission | Why Bloop asks | If you skip it |
|---|---|---|
| **Screen Recording** | macOS hides window titles (like the name of the document you are in) from apps without this. Bloop does **not** record or save your screen. | App names still work, but window titles are blank. |
| **Automation** (your browser) | Lets Bloop ask Chrome, Arc, Brave, Edge or Safari for the address of your current tab, so it can tell Google Docs from YouTube. | Browsers count as "neutral", so study sites and distractions look the same. |

**Screen Recording**
1. On the welcome screen, click **Open Screen Recording settings**.
2. Turn the switch **on** next to **Bloop**. If macOS asks for your password, enter it.
3. Come back to Bloop and click **Restart Bloop**. macOS only applies Screen Recording after the app restarts, so this step matters.

**Automation**
1. Open one of the supported browsers (Chrome, Arc, Brave, Edge or Safari).
2. In Bloop's welcome screen, click **Ask for browser access**.
3. macOS asks whether Bloop may control your browser. Click **OK**.
4. If you missed the prompt, click **Open Automation settings** and turn on your browser under **Bloop**.

The badges on the welcome screen change from a dashed "needs attention" badge to a solid checkmark when a permission is working. Click **Continue** when you are done. You can skip the permissions and carry on; Bloop will still work with what it has.

**Developers only:** if you run Bloop from source with `npm run dev`, permissions attach to your terminal app instead of Bloop. `npm run perms` (and `npm run perms -- --dev`) resets stale entries and walks you through the panes. Regular users do not need it.

### Notifications

Bloop sends a system notification when you have been distracted for a few minutes, and for study reminders. The first time, macOS may ask to allow notifications; click **Allow**. If you missed it, open **System Settings → Notifications → Bloop** and turn them on. Without notifications the pet still talks in its speech bubble.

### Launch at login

Open Bloop's **Settings** (menu bar icon → **Settings…**) and turn on **Open Bloop when you log in**. It is off by default.

---

## 3. Windows

### Installer or portable?

- **Installer** (`Bloop-Setup-<ver>-win-x64.exe`): installs Bloop for your user account, adds a Start menu entry and an uninstaller. You can choose the install folder. Best for your own computer.
- **Portable** (`Bloop-<ver>-win-x64-portable.exe`): nothing to install. Double-click and it runs. Good for a USB stick or a computer where you cannot install software. It starts a little slower, and it does not give you a Start menu entry or an uninstaller.

### The SmartScreen warning

Windows may show a blue **"Windows protected your PC"** box because Bloop is unsigned.

1. Click **More info**.
2. Click **Run anyway**.

Your browser may also say the download is "not commonly downloaded". Choose **Keep** to save it.

### Installing

Run the installer, click through the steps, and choose a folder if you want (the default is fine). The installer is per-user, so it does not ask for administrator rights. By default Bloop goes into `%LOCALAPPDATA%\Programs\Bloop` (that is `C:\Users\<you>\AppData\Local\Programs\Bloop`). Bloop starts when you finish.

### Finding Bloop: the tray icon

The pet appears in the top-right of your screen, just above the taskbar. Bloop also has an icon in the **system tray** near the clock. Windows often hides new tray icons under the **^** arrow:

1. Click the **^** (Show hidden icons) arrow at the right of the taskbar.
2. You will see the Bloop icon. **Drag it onto the taskbar** next to the clock to keep it visible.

Or go to **Settings → Personalization → Taskbar → Other system tray icons** and switch **Bloop** on.

Click the tray icon to show or hide the panel. Right-click it for Start session, Pause, Settings and Quit.

### Notifications and Focus Assist

Windows needs no special permissions for Bloop. Notifications appear in the bottom-right corner. If you never see them:

- Turn off **Do not disturb / Focus assist** (Windows 11: **Settings → System → Notifications → Do not disturb**; Windows 10: **Settings → System → Focus assist → Off**), or allow Bloop as a priority app.
- Check **Settings → System → Notifications** and make sure Bloop is on in the app list.

### Launch at login

Open Bloop's **Settings** (right-click the tray icon → **Settings…**) and turn on **Open Bloop when you log in**. It is off by default. Use the installed version for this; the portable version may not start reliably at login.

Windows has no special permissions to grant. Bloop reads the active app, and works out the website from the browser window title (for example "YouTube - Google Chrome" counts as youtube.com). That is a little less precise than on a Mac.

---

## 4. Linux

Linux support is new and the least tested of the three. Both packages are for 64-bit Intel/AMD machines (x86_64 / amd64).

### AppImage (works on most distros)

```bash
chmod +x Bloop-<ver>-linux-x86_64.AppImage
./Bloop-<ver>-linux-x86_64.AppImage
```

(Or right-click the file → **Properties → Permissions → Allow executing file as program**, then double-click.)

- **"FUSE" or "libfuse.so.2" error?** AppImages need FUSE 2. On Ubuntu/Debian: `sudo apt install libfuse2` (on Ubuntu 24.04 the package is `libfuse2t64`).
- **Do not want to install FUSE?** Run it without:
  ```bash
  ./Bloop-<ver>-linux-x86_64.AppImage --appimage-extract-and-run
  ```
- A "sandbox" error on some systems (often Ubuntu 23.10+) can be fixed by adding `--no-sandbox` at the end of the command. This is a limitation of the system's security settings, not something you did wrong.

### .deb (Ubuntu, Debian, Mint)

```bash
sudo apt install ./bloop_<ver>_amd64.deb
```

Use the path to wherever you saved the file (the `./` matters). apt will pull in the libraries Bloop needs. Afterwards, find **Bloop** in your app menu, or run `bloop` in a terminal.

### Active-window detection on Linux

Bloop finds out which app you are using with the `xprop` tool, so it works on **X11** sessions. The `.deb` installs `xprop` for you (it is part of `x11-utils`). With the AppImage, install it yourself if it is missing: `sudo apt install x11-utils`.

On **Wayland** sessions, apps are not allowed to see which window is in front, so detection is **limited** and Bloop may not be able to tell what you are doing. If you can, choose **"Ubuntu on Xorg"** (or similar) on the login screen. Wayland apps running through XWayland may still be detected.

On Linux, Bloop's tray icon depends on your desktop environment; some (like stock GNOME) need an extension to show tray icons. Launch-at-login is not supported on Linux; add Bloop to your desktop's startup applications if you want it.

---

## 5. Verify your download (optional)

Each release includes `SHA256SUMS.txt`, a list of the correct fingerprint for every file. Checking it proves your download is complete and not corrupted. Download `SHA256SUMS.txt` into the same folder as your installer.

**macOS / Linux**
```bash
cd ~/Downloads
shasum -a 256 Bloop-<ver>-mac-arm64.dmg      # on Linux you can also use: sha256sum <file>
grep mac-arm64 SHA256SUMS.txt
```

**Windows (PowerShell)**
```powershell
cd $HOME\Downloads
Get-FileHash .\Bloop-Setup-<ver>-win-x64.exe -Algorithm SHA256
Select-String "win-x64" .\SHA256SUMS.txt
```

The long string of letters and numbers from the first command must match the one for the same file name in `SHA256SUMS.txt` (ignore upper/lower case). If it does not match, download the file again.

---

## 6. First run

1. **Find the pet.** It appears in the **top-right corner** of your screen (above the taskbar on Windows). Drag it anywhere; Bloop remembers where you left it. Hover over it to see your score and timer, and click it to open the panel.
2. **Start a session.** Click the pet to open the panel and start a session, or use the tray / menu bar icon → **Start session**. The default is 25 minutes of focus and 5 minutes of break, and you can change this in **Settings**. While a session runs, Bloop checks the front app about every 5 seconds, keeps a live focus score, and gets worried (then sends a notification) if you stay on a distracting app or site.
3. **Make it yours.** In **Settings** you can edit the lists of focus and distracting apps and websites, nudge timing, study reminders, and a Brightspace calendar link for deadlines.

### Settings → AI (optional)

The panel has an **AI study plan** card that writes a week of study blocks from your deadlines and focus history. It only works once you pick where the AI runs, under **Settings → AI**:

- **Use Local → Bloop model.** A small AI model that runs entirely on your computer and works offline. It is **not** downloaded automatically. When you choose it (or press Generate with it selected), Bloop asks "Download the Bloop model?" (it says the model is 532 MB) with **Download** and **Not now**. Nothing is fetched until you press **Download**. You need about 532 MB of free disk space, and the download can resume if you cancel. If you already have a `.gguf` file, you can use **Import .gguf…** instead. Some builds ship the model inside the app; there it is off until you pick **Use Bloop model**.
- **Use Local → Ollama models.** If you already use [Ollama](https://ollama.com/download), open it and pick one of its models from the list (press **Refresh** after pulling one). If Ollama is running but missing the small recommended model, Bloop offers to pull it and only does so after you confirm.
- **Cloud.** Uses a tool or key you already have: the Claude, Codex or Gemini command-line tools, or an Anthropic or OpenRouter API key. With a cloud option, your upcoming deadline titles and focus totals are sent to that provider, and only when you click **Generate plan**.
- **Auto** (default) uses the first option that is ready: Bloop model (only if you turned it on), then Ollama, then cloud. It never downloads anything on its own.

The **Test** button in Settings sends a one-line prompt to check your choice works.

---

## 7. Updating and uninstalling

There is no automatic updater. To update, download the newest release and install it over the old one. Your history and settings are kept.

### Where your data lives

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/Bloop` |
| Windows | `%APPDATA%\Bloop` (that is `C:\Users\<you>\AppData\Roaming\Bloop`) |
| Linux | `~/.config/Bloop` |

Your sessions and settings are in `bloop.json` there, and a downloaded AI model is in the `models` subfolder. This is the same for the installer and portable versions.

**To wipe everything:** quit Bloop, then delete that folder. If you only want to clear your session history and reset settings, use **Settings → Reset data → Reset everything…** inside Bloop instead. To remove just the AI model, use **Delete** next to the Bloop model in **Settings → AI**.

### macOS

- **Update:** quit Bloop (menu bar icon → **Quit Bloop**), then drag the new Bloop onto **Applications** and choose **Replace**. You may need to repeat the first-launch steps from section 2, and macOS may ask for Screen Recording and Automation again, because each unsigned build looks like a different app to macOS.
- **Uninstall:** quit Bloop, drag **Bloop** from Applications to the Trash, then delete the data folder above if you want it gone.

### Windows

- **Update:** quit Bloop (tray icon → **Quit Bloop**), then run the new installer. It replaces the old version. For the portable version, just replace the old `.exe` with the new one.
- **Uninstall:** **Settings → Apps → Installed apps**, find **Bloop**, then **Uninstall**. For the portable version, delete the `.exe`. Delete `%APPDATA%\Bloop` afterwards to remove your data (the uninstaller may leave it).

### Linux

- **Update:** for the AppImage, download the new file and delete the old one. For the .deb, run `sudo apt install ./bloop_<new-ver>_amd64.deb` again.
- **Uninstall:** delete the AppImage file, or for the .deb run `sudo apt remove bloop`. Delete `~/.config/Bloop` to remove your data.

---

## 8. Troubleshooting

**I can't see the pet.**
- Check that Bloop is running: look for the menu bar icon (Mac) or tray icon (Windows; check under the **^** arrow).
- Click that icon → **Show panel**. If the icon is there but the pet is not, quit Bloop and open it again.
- The pet sits in the top-right of your **main** display. If you disconnected a monitor, restart Bloop.
- Bloop only runs one copy at a time. If you opened it twice and nothing happened, it is probably already running.

**macOS says Bloop is "damaged and can't be opened."**
This is macOS reacting to an unsigned download, not a broken file. Run this in Terminal, then open Bloop again:
```bash
xattr -cr /Applications/Bloop.app
```
If it still fails, download the file again and compare it with `SHA256SUMS.txt` (section 5).

**Permissions still say "not granted" on macOS.**
- Did you click **Restart Bloop** after turning on Screen Recording? macOS only reads that permission when the app starts.
- Make sure the switch is on next to **Bloop** (not an old or duplicate entry) in **Privacy & Security → Screen Recording** and **Automation**.
- Each new unsigned build counts as a different app to macOS, so an old grant can stop working after an update. Remove the Bloop entry with the **−** button, quit Bloop, open it again and grant the permission again.
- If you run Bloop from source with `npm run dev`, the permission belongs to your terminal app (Terminal, iTerm or VS Code), not Bloop. Turn that one on. Developers can run `npm run perms -- --dev`.
- Automation only says "granted" once a supported browser is open when you click **Ask for browser access**.

**I'm not getting notifications.**
- macOS: **System Settings → Notifications → Bloop**, turn on **Allow notifications**, and check Focus / Do Not Disturb isn't on.
- Windows: turn off Focus Assist / Do not disturb and check **Settings → System → Notifications**.
- Linux: a notification daemon must be running (most desktops have one).
- Bloop only notifies after about 3 minutes on a distracting app or site, and at most once every 2 minutes. The pet's speech bubble appears first, after about a minute.

**The Bloop model download fails.**
- Check your internet connection and that you have about 532 MB of free disk space; Bloop checks for space first.
- Press **Download…** again. Downloads resume where they stopped.
- Some school and work networks block the download site (huggingface.co). Try a different network, or download the `.gguf` file elsewhere and use **Import .gguf…**.
- If the button instead reads "Download · Not published yet", that build has no download link. Use **Import .gguf…**, Ollama, or Cloud instead. (Normally the button reads **Download…**; the link points at the stock Qwen3.5 0.8B model, 532 MB.)
- You can also skip the model and use Ollama or Cloud.

**Where are the logs?**
Bloop does not write a log file yet, and the tray menu has no "Open logs folder" item. It prints diagnostic messages beginning with `[bloop]` to the console. To see them, start Bloop from a terminal:
- macOS: `/Applications/Bloop.app/Contents/MacOS/Bloop`
- Windows (PowerShell): `& "$env:LOCALAPPDATA\Programs\Bloop\Bloop.exe"`
- Linux: run the AppImage or `bloop` from a terminal.

Add `BLOOP_TRACE=1` before the command for extra detail about permissions and the active window. When asking for help, include that output and your OS version.
