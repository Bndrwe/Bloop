# Bloop: product direction

Bloop is a focus app. Every change should make one of these three core areas better:

1. **The live focus score.** Bloop watches what's in front and keeps an honest score. It judges by what's actually on screen, not only the site: a lecture on YouTube is study, gameplay is not.
2. **Brightspace deadlines and the AI weekly study plan.** What's due next, and a realistic plan for the week built around it.
3. **Reminders when you're not focused.** The pet reacts right away, then a bubble and a notification after 1 minute and every 2 minutes after that.

Chat with Bloop is secondary. It stays available (a small button in the panel header, a link under the study plan, and the tray menu), but it must not compete with the three core areas for space or attention.

## What this means in practice

- The panel is ordered around the core areas: score and status (with the reminder state), then deadlines, then the study plan. Stats and chat come after.
- New features should answer "does this make the score fairer, the plan more useful, or the reminders better timed?" If not, they are extras.
- Pages that could be study or not (a YouTube lecture vs. gameplay) are judged by their content: local rules first, then the AI the user set up (Ollama or their cloud AI) automatically, without asking. With no AI, an unclear page counts as distracting.
- Privacy holds: activity is judged on the computer. Nothing new leaves it unless the user turns it on, and the setting says exactly what is sent.
- UI copy is short and plain. No em dashes.
