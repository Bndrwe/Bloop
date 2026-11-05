# Changelog

All notable changes to Bloop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - *Use Local*: the Bloop model (Qwen3.5-0.8B, downloaded only when you confirm) or Ollama models.
  - *Cloud*: Claude CLI, Codex CLI, Gemini CLI, Anthropic API or OpenRouter. Cloud is used only when you click **Generate plan**.
- **Brightspace deadlines**: paste your Brightspace iCal URL to see upcoming deadlines and get reminders before exams.
- **Windows support**: NSIS installer and portable build, with window-title based site detection in browsers.
- **Model fine-tuning kit (optional)**: training scripts, dataset, evaluation and a weight-space programming harness in `ml/`. Not needed to use Bloop.
- **Installers**:
  - macOS, Apple Silicon and Intel (DMG and ZIP)
  - Windows (installer and portable `.exe`)
  - Linux (AppImage and `.deb`)

[1.0.0]: https://github.com/Bndrwe/StudyPet/releases/tag/v1.0.0
