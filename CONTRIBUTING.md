# Contributing to Bloop

Thanks for helping make Bloop better. This guide covers how to set up the code, run the checks, build installers, and what we expect in a change. If you only want to use Bloop, see [docs/INSTALL.md](docs/INSTALL.md) instead.

## Setup

You need **Node.js 20** and npm.

```bash
git clone https://github.com/Bndrwe/StudyPet.git
cd StudyPet
npm ci
```

Use `npm ci` so you get the exact versions in `package-lock.json`.

To run the app with hot reload while you develop:

```bash
npm run dev
```

`npm run dev` is for development only. Installed users never need it.

## Checks

Run these before you open a pull request.

```bash
npm run typecheck   # strict TypeScript for the main process and the renderer
npm test            # unit tests (vitest): classifier, focus score, and more
```

## Project layout

```
build/          app icon and other packaging resources
docs/           install guide, release notes, and screenshots used in the README
ml/             kit for fine-tuning the optional Bloop model (Python, Colab or Apple Silicon)
resources/      files bundled with the app (for example, an optional model in resources/models/)
scripts/        helper scripts used by npm scripts (model bundling, macOS permission reset)
src/main/       Electron main process: tracking, scoring, sessions, storage, AI, windows, tray
src/preload/    typed contextBridge API that exposes window.studyPet to the renderer
src/shared/     types and IPC channel names shared by main, preload and renderer
src/renderer/   React UI: pet overlay, panel, settings, onboarding
tests/          vitest unit tests
```

The renderer runs sandboxed with `contextIsolation` on and `nodeIntegration` off. It talks to the main process only through the typed API in `src/shared/types.ts`. Keep it that way.

## Building installers locally

Build only the target you need. Each script typechecks, checks the bundled model, compiles, and then packages:

| Command | Output in `dist/` | Where to run it |
|---|---|---|
| `npm run build:mac` | `.dmg` and `.zip` for this Mac's architecture | macOS |
| `npm run build:win` | NSIS installer (`Setup`) and portable `.exe`, x64 | Windows |
| `npm run build:linux` | AppImage and `.deb`, x64 | Linux (X11 for testing focus tracking) |

Notes:

- Run `build:win` on Windows. `get-windows` downloads its Windows binary at install time, so a cross-build from macOS or Linux would ship without it.
- Builds are unsigned. Expect the Gatekeeper and SmartScreen warnings described in [docs/INSTALL.md](docs/INSTALL.md).
- `npm run build` is a macOS-only, unpacked build (`--dir`) that is handy for a quick local test.

**Releases are built by GitHub Actions**, not on your machine. `.github/workflows/release.yml` builds every installer on its own runner (macOS arm64, macOS Intel, Windows x64, Linux x64), smoke-tests each app, and publishes a GitHub Release with `SHA256SUMS.txt`. Maintainers run it from the Actions tab or push a `v*` tag. Bump `version` in `package.json` first.

## Code style

- **Strict TypeScript.** `tsconfig.node.json` and `tsconfig.web.json` both set `"strict": true`. Do not add `any` or `@ts-ignore` to get past a type error without a comment that explains why.
- **Black and white.** Bloop's design is strictly achromatic. Use the colour tokens in `src/renderer/src/styles/base.css` (`--ink`, `--paper`, `--g1` to `--g5`) rather than hard-coded colours. Show state with fill, outline, dashes, weight and words, not colour. The README's Design section has the full rules.
- **Animation** goes through anime.js. Respect *reduce motion*.
- Keep changes focused, and add or update a unit test in `tests/` when you change classification, scoring, or other logic.

## Never commit secrets

**Never commit API keys, tokens, or `.env` files.**

- `.env` is gitignored. Only `.env.example` is tracked, and it must hold placeholders only.
- Do not put a real key in source code, tests, screenshots, logs, or an issue or pull request.
- If you think a key has been committed, tell the maintainers right away (see [SECURITY.md](SECURITY.md)) and revoke or rotate the key. Removing it in a later commit is not enough, because it stays in the git history.

## Pull requests

1. Create a branch from the default branch.
2. Make your change and run the checks above.
3. Open a pull request. The template asks for a summary, how you tested it, screenshots for UI changes, and a short checklist.
