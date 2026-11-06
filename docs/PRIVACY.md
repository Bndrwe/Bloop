# Bloop privacy

Bloop is a desktop app. It has no account, no server, no analytics, no crash reporting, no auto-updater and no telemetry. This page lists everything it stores, every case where it uses the network, and how to delete it all.

## What stays on your computer

Everything Bloop records stays in its data folder:

| Platform | Data folder (`userData`) | Log folder |
|---|---|---|
| macOS | `~/Library/Application Support/bloop/` | `~/Library/Logs/bloop/` |
| Windows | `%APPDATA%\bloop\` | `%APPDATA%\bloop\logs\` |
| Linux | `~/.config/bloop/` | `~/.config/bloop/logs/` |

The tray's **Open logs folder** item and the **About** dialog show the exact paths on your machine.

| What | Where | Contents |
|---|---|---|
| Settings, session history, study plan, reminders, pet position | `userData/bloop.json` | Your focus/distract lists, up to 1,000 past sessions (start/end, score, top focus apps and top distractions), the last AI plan, the cached next 10 deadlines (title, course code and date, from your calendar link and/or Brightspace), the calendar URL you entered, your Brightspace address and, while logged in, your Brightspace display name, course count, course codes and names, and last sync time |
| API keys (Anthropic, OpenRouter) | `userData/bloop.json`, key `aiKeys` | Encrypted with the OS secure store (macOS Keychain, Windows DPAPI, Linux Secret Service). Bloop won't save a key when encryption is unavailable. Keys are never sent to the app's windows, never logged and are removed from error messages |
| Brightspace login cookies | `userData/Partitions/brightspace/` | A separate browser profile used only by the **Log in to Brightspace** window. It holds the cookies your school's Brightspace (and its sign-in provider) set, like any browser would. Bloop never sees or stores your password. **Log out** deletes this profile's cookies, storage and cache |
| Chats with Bloop | `userData/chats/` | One JSON file per conversation (title, times, your messages and Bloop's replies, and which AI wrote each reply) plus `index.json`, the list. At most 200 conversations, 500 messages each, 8 KB per message. Message text is never written to the log |
| Remembered pages | `userData/bloop.json`, key `contentOverrides` | Only the pages you mark with **This is study** / **Not study** in the panel: the page title (or site and path), a short form of its link (for YouTube the video id) and your choice, at most 300. Forget them in **Settings → Websites → Remembered pages** |
| AI answers for unclear pages | `userData/content-judge.json` | Only when an AI judges pages (see "Judging what's on the page" below): a hashed key of the site and title, the yes/no answer and its short reason, at most 500, each dropped after 30 days |
| Log | `logs/main.log` (+ `main.old.log`, up to 2 MB each) | App events, errors and notification titles. Activity samples (app name and website domain) are written only when Bloop is started with `BLOOP_TRACE=1`. Notification text is not logged |

Activity tracking (front app, browser tab URL on macOS, window title on Windows) is read from the OS every 2 seconds, classified on the spot, and kept only as the per-session summary above. Full URLs and window titles are not stored in `bloop.json`, except for pages you mark yourself (Remembered pages). The log records content verdicts and their reasons ("study, matches CHEM 201"), never the page title or URL.

## Judging what's on the page

Some sites depend on what's open: a lecture on YouTube is study, gameplay is not. For the sites on **Settings → Websites → Depends on what's open** (by default youtube.com, reddit.com, medium.com, quora.com, vimeo.com), Bloop judges the page itself:

- **On your computer, always**: the page title and link are checked against your course codes and names, your upcoming deadline titles, your focus list and a built-in list of study and entertainment words. Nothing is sent anywhere. The course names come from your Brightspace sync and are kept in `bloop.json` while you're logged in.
- **Read page text for better judging** (macOS, off by default): Bloop also reads the page's description and headings from Chrome-family browsers or Safari, using "Allow JavaScript from Apple Events", which you turn on in the browser. This text is only used on your computer and is never sent to any AI. If the browser setting is off, Bloop quietly uses the title and link.
- **Your Ollama model** (only if you picked one in Settings → AI): pages the rules can't decide are asked to it. With the default address this stays on your computer.
- **Let my cloud AI judge unclear pages** (off by default): only when you turn this on, pages the rules can't decide are asked to the cloud provider Auto (or your cloud pick) uses. **Sent: the page title, the site name (like youtube.com) and your course codes and names. Never the link, the page text, other apps or sites, or anything else.** At most one request every 10 seconds, and each page is asked once (answers are cached for 30 days).

## When Bloop uses the network

Bloop only connects to the network in the cases below. In each case you either started it or turned the feature on.

| Trigger | Destination | What is sent |
|---|---|---|
| You enter a Brightspace/iCal URL in Settings | That URL (at launch and when you press refresh) | A plain GET. The URL usually contains a private token, so treat it like a password |
| You press **Log in to Brightspace** | Your school's Brightspace address (https only), plus whatever sign-in pages your school sends you to (Microsoft, Okta, Duo, Shibboleth…) | You sign in on your school's own pages in a separate window. Bloop doesn't read what you type there |
| You are logged in to Brightspace: shortly after launch, every 2 hours, and when you press **Refresh** | Your school's Brightspace address only | Read-only API requests with your Brightspace session cookie: who you are, your active courses, and each course's assignments, quizzes and calendar events for the next 30 days. See "Brightspace login" below |
| Settings → AI is open, or the AI status refreshes | Your Ollama address (default `http://127.0.0.1:11434`, which stays on your machine) | Requests for the version and model list |
| You confirm **Pull … with Ollama?** | Your Ollama address, which then downloads from `ollama.com` | The model name |
| You press **Generate plan** or **Test** | The AI that is selected (see below) | The plan prompt with Bloop's instructions (system prompt); **Test** sends only a one-line test prompt |
| You send a message in **Chat with Bloop** | The AI that is selected (see below) | Bloop's instructions, the recent turns of that conversation (about the last 6,000 characters) and your new message. With **Share my study stats with Bloop** on, also today's date, the session state and score, today's focus minutes and the titles and dates of your next 3 deadlines |
| You picked an Ollama model and a "depends on what's open" page is unclear | Your Ollama address | The page title, the site name and your course codes and names. At most one request every 10 s |
| You turned on **Let my cloud AI judge unclear pages** and a cloud provider is in use | That provider (see below) | For a page on a "depends on what's open" site that the local rules can't decide: its title, the site name and your course codes and names. At most one request every 10 s |
| You have saved an OpenRouter key | `openrouter.ai/api/v1/models` (public list, cached for 24 h) | Nothing personal. Without a key, Bloop never contacts OpenRouter |
| You click a help link | Your web browser opens it. Only `https://` links are allowed | — |

**The plan prompt** contains your next deadline titles and dates, your daily focus minutes, session counts and average scores for the last 7 days, and your pomodoro and break lengths. It never contains app names, site names, window titles or URLs. Where it goes:

- **Ollama**: to your Ollama address. With the default it stays on your machine. A non-local address sends it over your network, unencrypted if you use `http://`.
- **Claude / Codex / Gemini CLI**: to that vendor, through the CLI you signed in to. Bloop sends the prompt on stdin (never on the command line; the Claude CLI reads the instructions from a file in the temporary folder) and runs the CLI in an empty, private, temporary folder that is deleted afterwards. The Claude CLI runs with all tools off and Codex with a read-only sandbox.
- **Anthropic API / OpenRouter**: to `api.anthropic.com` or `openrouter.ai` with your key. The Anthropic API address is fixed in code, so environment variables can't send your key somewhere else.

**Auto** never sends data to a cloud service unless you turned that service on. Cloud providers are opt-in: Auto only uses a CLI or API key if you switched on **Use in Auto** for it in Settings → AI → Cloud (or picked it there). Turned-on providers that are installed or have a key are used in your order. Auto never uses Ollama; Ollama runs only when you pick it in **Use Local**. Installing or being signed in to a CLI, or saving a key, does not by itself opt it in. The panel shows which AI it will use ("via …") before you press Generate. Switch the service off, or pick **Use Local**, to keep the prompt on your computer.

The app's windows can't make network requests themselves. Their Content-Security-Policy allows `connect-src 'self'` only, and every request above is made by the main process.

## Chat with Bloop

Chats are stored only on this computer, under `userData/chats/` (see the table above). Nothing is synced or uploaded by Bloop itself.

Each message is sent only to the AI in use, the same one the panel shows as "via …" (your pick in Settings → AI, or what Auto picks). With Ollama it goes to your Ollama address (on your computer with the default address). **With a cloud provider (a CLI or an API key) every message you send, with the recent turns of that conversation, goes to that vendor**, and the chat window says so under the composer. Chat never downloads a model or pulls one with Ollama.

**Share my study stats with Bloop** adds a short summary to each message: today's date, the current session state and score, today's focus minutes and your next 3 deadlines (titles cut to one line of 120 characters). It is on by default when the AI runs on this computer and off by default for cloud providers; switch it off any time. It never includes app names, sites, window titles or URLs.

Delete one chat with its trash button, all of them with **Delete all chats**, or everything with **Settings → Reset data → Reset everything…**.

## Brightspace login

**Settings → Deadlines → Log in to Brightspace** opens your school's own sign-in page in a separate window. When Brightspace shows its home page, the window closes and Bloop reads your upcoming work through Brightspace's API, as you.

- **What is read**: your name (to show "Connected as …"), the names and codes of your active courses, and the titles and due dates of your assignments, quizzes and calendar events. Not grades, submissions, files, messages or classmates. Requests are read-only (`GET`), at most 4 at a time, for at most 40 courses, with a 15 s timeout and a 5 MB limit per response.
- **What is kept**: the next 10 upcoming items (title with course code, date) in `bloop.json`, the same cache the calendar link uses, so the panel, exam reminders and the study plan work offline. Your school's address, your display name, course count and last sync time are kept so Settings can show "Connected as …". Your course codes and names are kept to recognise study pages (see "Judging what's on the page").
- **Your password**: never seen or stored by Bloop. You type it into your school's page; Bloop only keeps the session cookies that page sets, in a separate browser profile (`userData/Partitions/brightspace/`) that Bloop's own windows never use. The cookies are encrypted at rest where Electron supports it (macOS Keychain, Windows DPAPI, Linux keyring).
- **Where it goes**: only to your school's Brightspace address. Nothing is sent to Bloop's developers or anyone else.
- **The study plan and chat**: deadline titles (with the course code, e.g. "CHEM 201: Midterm 2") and dates go into the plan prompt only when you press **Generate plan**, and only to the AI you chose (see above). Chat with stats sharing on includes your next 3.
- **Login window lockdown**: it runs sandboxed with no access to Bloop's internals (no preload, no Node, no `<webview>`), may open only `https://` pages (single sign-on needs other sites), opens sign-in popups in the same separate profile, can't download files, and is denied camera, microphone, location, notifications and USB/HID devices. It closes by itself after 10 minutes if sign-in isn't finished. Passkeys and security keys may not work in this window; choose another sign-in method (app push, code), or use the calendar link.
- **Log out** (Settings → Deadlines) deletes the profile's cookies, storage and cache, the cached Brightspace items and the "Connected as" details. **Settings → Reset data → Reset everything…** logs out too.
- If your school limits API access for students, the sync fails with a message saying so; the calendar link still works.

## How to delete your data

- **Settings → Reset data → Reset everything…** deletes everything in `bloop.json`: settings, history, plan, deadline cache, calendar URL, remembered pages and the saved API keys. It also deletes the AI page answers, all chats and the log files, and logs you out of Brightspace.
- **Remembered pages**: **Forget all** (or the × next to one) in Settings → Websites.
- **Brightspace**: **Log out** in Settings → Deadlines deletes the login profile's cookies and the cached Brightspace items.
- **Chats**: **Delete all chats** in the chat window's list (after a confirmation) deletes the `userData/chats/` folder; the trash button removes one conversation. **Settings → Reset data → Reset everything…** deletes all chats too.
- **API key**: clear the field in Settings → AI → Cloud and press Save.
- **Logs**: delete the log folder above (tray → **Open logs folder**).
- **Everything**: quit Bloop, then delete the data folder and the log folder. On Linux, also delete `~/.config/autostart/bloop.desktop` if you turned on launch at login.
- A `.env` file you created yourself (holding `ANTHROPIC_API_KEY`) is not touched by Bloop. Delete it yourself.

## Notes

- A calendar link must use `https://`. A plain `http://` link is accepted only for `localhost` or `127.0.0.1`, which is for testing. Use the `https://` link that Brightspace gives you.