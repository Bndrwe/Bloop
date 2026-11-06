# Security Policy

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem.**

Report it privately in one of these ways:

1. **GitHub private reporting (preferred).** Go to the repository's **Security** tab and choose **Report a vulnerability**. This sends a private advisory only to the maintainers.
2. **Contact the maintainers directly.** If you cannot use GitHub's form, contact the Bloop team through the repository owner, `Bndrwe`, on GitHub, and say only that you have a security report. Share the details through a private channel.

Please include:

- the Bloop version and the file you installed (for example, `mac-arm64.dmg` or `AppImage`), and your OS
- the steps to reproduce, or a proof of concept
- what an attacker could do and what data is affected

Please give us a reasonable amount of time to fix the problem before you disclose it publicly. We will reply as soon as we can and keep you updated on the fix.

## Supported versions

Security fixes go into the latest code on the main branch. Please update first (re-run the install command from the `StudyPet` folder, which pulls and rebuilds) before you report an issue.

## Scope

**In scope** (the Bloop app and this repository):

- the Electron app code in `src/` (main process, preload bridge, renderer) and the build and release configuration
- the typed IPC between the renderer and the main process, including any way for the renderer to reach things it should not
- how Bloop stores and uses API keys, and any way they could leak to the UI, logs, or files
- how Bloop runs the Claude, Codex and Gemini command-line tools (argument handling, the temporary working folder)
- the GitHub Actions release workflow, if a change could let an attacker publish a tampered installer

**Out of scope:**

- vulnerabilities in third-party services (Anthropic, OpenRouter, Ollama, or the Claude, Codex and Gemini CLIs). Report those to the vendor.
- problems in your operating system or in other apps, unless Bloop's own behaviour makes them worse
- the "unknown developer" and SmartScreen warnings on the unsigned builds. These are known and documented in [docs/INSTALL.md](docs/INSTALL.md).
- issues that need someone who already has administrator rights on your machine or who can already read your files
- social engineering, spam, and denial of service by flooding the app with data

## Your API keys

Bloop never sends your AI API keys back to the app's screen. The settings only show "key set".

- **Storage.** Keys you save in **Settings → AI** are encrypted with Electron's `safeStorage`, which uses your system's secure storage: the macOS Keychain, Windows DPAPI, or the Linux keyring (libsecret). The encrypted value is kept in the app's settings file.
- **Refusal when unavailable.** If secure storage is not available, Bloop refuses to save the key, so it is never stored in plain text.
- **`.env` fallback.** `ANTHROPIC_API_KEY` in a `.env` file is read only by the main process. It is used only when no key is saved in Settings.

If you think a key has leaked, revoke or rotate it with the provider right away. Bloop cannot revoke keys for you.
