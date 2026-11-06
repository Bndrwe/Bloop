# Changelog

All notable changes to Bloop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Hide the pet**: press Ctrl+Shift+B (⌘⇧B on a Mac), or use the eye button in the panel header, **Hide pet** in the tray or menu bar menu, the pet's right-click menu, or **Settings → Show the pet on screen**. Tracking and notifications keep running while it's hidden. **Pop up for nudges while hidden** (on by default) shows the pet for about 8 seconds when Bloop has a nudge.
- **Chat with Bloop**: a chat window for study questions, from the tray or the panel. Chats are saved only on this computer (in the `chats` folder of Bloop's data folder). Rename or delete chats, or use **Delete all chats**. **Share my study stats** adds your session, focus minutes and next deadlines to each message. A note shows when a cloud provider receives your messages.
- **Instructions (system prompt)**: Bloop's built-in instructions go to every provider as a system message where it has one, and as a delimited block where it doesn't.
- **Brightspace login**: **Settings → Deadlines → Log in to Brightspace** signs in on your school's own page, then reads your assignments, quizzes and calendar events for the next 30 days. Bloop syncs shortly after launch and every 2 hours, and **Log out** removes the login and the items. When the login expires, Settings and the panel say **Log in again**. The calendar link still works as a fallback.

## [1.0.0] - 2026-11-05

First public release.

### Added

- **Pet overlay**: a small, always-on-top, frameless pet window in the corner of your screen. Drag it anywhere, and it remembers where you left it. Hover for your score and session timer, click for a compact panel.
- **Moods**: idle, happy (focused), worried (drifting), sad (distracted for a while), sleeping (break or paused), celebrate (session done) and wave (study reminder).
- **Focus tracking and score**: samples the frontmost app every 5 seconds and, in browsers, the current site. Each sample is classified as focus, distract or neutral using editable lists. A live focus score and per-session history, with a 7-day chart.
- **Nudges, Pomodoro and reminders**: encouraging nudges when you drift, 25/5 Pomodoro sessions (configurable), recurring study reminders and a tray icon with quick controls.
- **Settings and onboarding**: a settings window and a first-run permissions check for macOS.
- **Design**: a black-and-white interface with background smoke, a chrome hero in the panel, and anime.js motion throughout. Respects reduce motion.
- **AI study plan**:
  - *Use Local*: Ollama models.
  - *Cloud*: Claude CLI, Codex CLI, Gemini CLI, Anthropic API or OpenRouter. Cloud is used only when you click **Generate plan**.
- **Brightspace deadlines**: paste your Brightspace iCal URL to see upcoming deadlines and get reminders before exams.
- **Windows support**: NSIS installer and portable build, with window-title based site detection in browsers.
- **Install**: one command (`scripts/install.sh` on macOS and Linux, `scripts/install.ps1` on Windows) builds Bloop on your computer and installs it. Installer files (DMG, EXE, AppImage, `.deb`) can be built with `npm run build:*`; none are published yet.
