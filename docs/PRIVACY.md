# Bloop privacy

Bloop is a desktop app. It has no account, no server, no analytics, no crash reporting, no auto-updater and no telemetry. This page lists everything it stores, every case where it uses the network, and how to delete it all.

## What stays on your computer

Everything Bloop records stays in its data folder:

| Platform | Data folder (`userData`) | Log folder |
|---|---|---|
| macOS | `~/Library/Application Support/Bloop/` | `~/Library/Logs/Bloop/` |
| Windows | `%APPDATA%\Bloop\` | `%APPDATA%\Bloop\logs\` |
| Linux | `~/.config/Bloop/` | `~/.config/Bloop/logs/` |

The tray's **Open logs folder** item and the **About** dialog show the exact paths on your machine.

| What | Where | Contents |
|---|---|---|
| Settings, session history, study plan, reminders, pet position | `userData/bloop.json` | Your focus/distract lists, up to 1,000 past sessions (start/end, score, top focus apps and top distractions), the last AI plan, the cached next 5 calendar deadlines and the calendar URL you entered |
| API keys (Anthropic, OpenRouter) | `userData/bloop.json`, key `aiKeys` | Encrypted with the OS secure store (macOS Keychain, Windows DPAPI, Linux Secret Service). Bloop won't save a key when encryption is unavailable. Keys are never sent to the app's windows, never logged and are removed from error messages |
| Bloop model | `userData/models/` | The downloaded or imported `.gguf` (about 530 MB) |
| Bundled-model check cache | `userData/bloop-bundled-verified.json` | File size, timestamp and checksum, nothing personal |
| Log | `logs/main.log` (+ `main.old.log`, up to 2 MB each) | App events and errors. **Today it also records each activity sample (app name and website domain) while a session runs, plus notification text**; see "Known gaps" |

Activity tracking (front app, browser tab URL on macOS, window title on Windows) is read from the OS every 5 seconds during a session, classified on the spot, and kept only as the per-session summary above. Full URLs and window titles are not stored in `bloop.json`.

## When Bloop uses the network

Bloop only connects to the network in the cases below. In each case you either started it or turned the feature on.

| Trigger | Destination | What is sent |
|---|---|---|
| You enter a Brightspace/iCal URL in Settings | That URL (at launch and when you press refresh) | A plain GET. The URL usually contains a private token, so treat it like a password |
| You press **Download** for the Bloop model (after the confirmation) | `huggingface.co` (redirects to its CDN) | A GET for one pinned file. The file is checked against a fixed size and sha256 before use |
| Settings → AI is open, or the AI status refreshes | Your Ollama address (default `http://127.0.0.1:11434`, which stays on your machine) | Requests for the version and model list |
| You confirm **Pull … with Ollama?** | Your Ollama address, which then downloads from `ollama.com` | The model name |
| You press **Generate plan** or **Test** | The AI that is selected (see below) | The plan prompt |
| You have saved an OpenRouter key | `openrouter.ai/api/v1/models` (public list, cached for 24 h) | Nothing personal. Without a key, Bloop never contacts OpenRouter |
| You click a help link | Your web browser opens it. Only `https://` links are allowed | — |

**The plan prompt** contains your next deadline titles and dates, your daily focus minutes, session counts and average scores for the last 7 days, and your pomodoro and break lengths. It never contains app names, site names, window titles or URLs. Where it goes:

- **Bloop model**: nowhere. It runs inside the app.
- **Ollama**: to your Ollama address. With the default it stays on your machine. A non-local address sends it over your network, unencrypted if you use `http://`.
- **Claude / Codex / Gemini CLI**: to that vendor, through the CLI you signed in to. Bloop sends the prompt on stdin (never on the command line) and runs the CLI in an empty, private, temporary folder that is deleted afterwards. The Claude CLI runs with all tools off and Codex with a read-only sandbox.
- **Anthropic API / OpenRouter**: to `api.anthropic.com` or `openrouter.ai` with your key. The Anthropic API address is fixed in code, so environment variables can't send your key somewhere else.

**Auto** never sends data to a cloud service unless you turned that service on. Cloud providers are opt-in: Auto only uses a CLI or API key if you switched on **Use in Auto** for it in Settings → AI → Cloud (or picked it there). Turned-on providers that are installed or have a key come first, in your order, then the Bloop model (if you turned it on), then Ollama. Installing or being signed in to a CLI, or saving a key, does not by itself opt it in. The panel shows which AI it will use ("via …") before you press Generate. Switch the service off, or pick **Use Local**, to keep the prompt on your computer.

The app's windows can't make network requests themselves. Their Content-Security-Policy allows `connect-src 'self'` only, and every request above is made by the main process.

## How to delete your data

- **Settings → Reset all data** deletes everything in `bloop.json`: settings, history, plan, deadline cache, calendar URL and the saved API keys.
- **Settings → AI → Bloop model → Delete** removes the downloaded or imported model.
- **API key**: clear the field in Settings → AI → Cloud and press Save.
- **Logs**: delete the log folder above (tray → **Open logs folder**).
- **Everything**: quit Bloop, then delete the data folder and the log folder. On Linux, also delete `~/.config/autostart/bloop.desktop` if you turned on launch at login.
- A `.env` file you created yourself (holding `ANTHROPIC_API_KEY`) is not touched by Bloop. Delete it yourself.

## Known gaps (tracked for the next release)

- `main.log` records activity samples (app name and domain) and notification text, and **Reset all data** doesn't clear the logs or the downloaded model. A fix is planned: sample logging only with `BLOOP_TRACE=1`, and Reset clearing logs too. Until then, delete the log folder by hand.
- A plain `http://` calendar URL is accepted. Use the `https://` URL that Brightspace gives you.
