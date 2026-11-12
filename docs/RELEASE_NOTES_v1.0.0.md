# Bloop 1.0.0 release notes

Bloop is a small, cute desktop pet that keeps an eye on your focus and gently nudges you back on track.
Everything runs on your computer, and your activity data never leaves it.

## What's new

- **A pet that shows how you're doing.** Bloop changes mood as you focus, drift, take breaks and finish sessions.
- **A live focus score.** See how you're doing in a compact panel, with a 7-day chart of your history.
- **Hide the pet when you need the screen.** Press Ctrl+Shift+B (⌘⇧B on a Mac), or use the tray, the panel or the pet's right-click menu. Bloop keeps tracking, and a nudge can pop the pet up for a few seconds.
- **Study sessions and reminders.** Pomodoro sessions (25 minutes focus, 5 minutes break) and recurring study reminders.
- **Brightspace deadlines.** Log in to Brightspace, or paste your calendar link, and see your next deadlines. Bloop reminds you before exams.
- **Chat with Bloop.** Ask about your studies. Chats are saved on your computer only.
- **An optional AI study plan.** Make a weekly plan on your own computer, or use a cloud AI you already have.
- **Available for macOS, Windows and Linux.** A black-and-white look with smooth animation.

## How to install

There are no downloadable installers yet, because the repo is private. Instead, one command fetches Bloop's source code, builds the app on your computer and installs it like any other app (in Applications on a Mac, the Start menu on Windows, or your app menu on Linux). It takes about 3 to 6 minutes the first time and needs no administrator password.

**Before you start:** your GitHub account needs access to the repo (ask the Bloop team to invite you), and you need git and Node.js 20 or newer. The installer checks for both and tells you how to get anything missing. Keep about 2 GB of free disk space.

**macOS and Linux** (in Terminal):

```bash
git clone https://github.com/Bndrwe/Bloop.git && cd Bloop && ./scripts/install.sh
```

**Windows** (in PowerShell):

```powershell
git clone https://github.com/Bndrwe/Bloop.git; cd Bloop; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

No GitHub CLI? Plain `git clone` works too. See [INSTALL.md](INSTALL.md) for the full steps, the permissions Bloop asks for on a Mac, and troubleshooting.

To update, run the same install command again from the `Bloop` folder (`StudyPet` if you cloned it before the rename). Your settings and history are kept.

Because you build Bloop on your own computer, macOS and Windows don't show their "unidentified developer" warnings for it.

## About the AI model

The AI study plan is optional. You can use Ollama or a cloud option instead, or no AI at all.
