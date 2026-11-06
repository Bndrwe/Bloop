// The text of every system notification Bloop sends, 150 in all, grouped by event. Each event
// draws from its own "shuffle bag", so a message doesn't repeat until all of that event's
// messages have been used. Placeholders in {braces} are filled in when the notification is sent.
// Style: short, kind, never shaming, at most one emoji, no em dashes, and never the name of the
// app or site the student drifted to (notifications can show on a locked screen).

export type NotifyKind = 'drift' | 'breakStart' | 'focusStart' | 'studyReminder' | 'deadline'

export interface NotifyTemplate {
  title: string
  body: string
}

/** {dur}: how long they've been off task, e.g. "3 min". */
const DRIFT: NotifyTemplate[] = [
  { title: 'Bloop misses you 🐾', body: "You've been off task for {dur}. Let's get back to it together!" },
  { title: 'Psst, over here', body: "It's been {dur} away from your work. Ready to jump back in?" },
  { title: 'Little detour?', body: "{dur} off task. No stress, just come back when you're ready." },
  { title: 'Hey, study buddy', body: 'Your work is waiting for you. {dur} away so far.' },
  { title: 'Bloop is waiting 👀', body: "{dur} off task. One small step back and you're rolling again." },
  { title: 'Quick check-in', body: 'Is this part of the plan? {dur} off task.' },
  { title: 'Back to it?', body: "You've drifted for {dur}. Future you will be glad you came back." },
  { title: 'We were on a roll!', body: '{dur} away. Let’s pick it up where we left off.' },
  { title: 'Focus is calling', body: "It's been {dur}. Five more focused minutes, then see how you feel." },
  { title: 'Bloop got lonely', body: '{dur} without you. Come say hi to your work?' },
  { title: 'Gentle nudge', body: "{dur} off task. You've got this." },
  { title: 'Where did you go?', body: 'Bloop noticed {dur} away from your study apps.' },
  { title: 'Tiny reset', body: 'Deep breath. {dur} off task, and the next minute is a fresh start.' },
  { title: 'Just a reminder', body: "You set out to study. It's been {dur} off track." },
  { title: 'Hello again 🌱', body: '{dur} away. Small steps still count. Back to it?' },
  { title: 'Still with me?', body: "{dur} off task. Let's finish what you started." },
  { title: 'One more push', body: "You're closer than you think. {dur} away so far." },
  { title: 'Bloop believes in you', body: '{dur} off task. Come back and show that work who’s boss.' },
  { title: 'Off on an adventure?', body: "{dur} away. The adventure of finishing your work awaits." },
  { title: 'The clock is still ticking', body: "{dur} spent elsewhere. Let's make the rest count." },
  { title: 'Hey, it happens', body: "Everyone drifts. {dur} off task. Let's steer back." },
  { title: 'Bloop is cheering for you 📣', body: 'Come back to your work. {dur} away.' },
  { title: 'Come back soon', body: "{dur} off task. Bloop saved your spot." },
  { title: 'Quick question', body: 'Is this helping your studying? {dur} off task.' },
  { title: 'Let’s refocus', body: 'Close the distraction, open your work. {dur} away so far.' },
  { title: 'Remember your goal', body: "You sat down to study for a reason. {dur} off task." },
  { title: 'Bloop is a little worried', body: "{dur} away from your work. Everything okay?" },
  { title: 'Time flies', body: "It's already been {dur}. Want to get back on track?" },
  { title: 'Easy does it', body: "No guilt, just a nudge: {dur} off task." },
  { title: 'Back to base?', body: '{dur} out exploring. Your work is home base.' },
  { title: 'Your future self says hi 👋', body: 'They hope you come back to studying. {dur} away.' },
  { title: 'Bloop is tapping your shoulder', body: '{dur} off task. Shall we?' },
  { title: 'Focus check', body: "You've been elsewhere for {dur}. Ready when you are." },
  { title: 'Let’s finish strong', body: '{dur} off task. You’re closer to done than you think.' },
  { title: 'A small detour', body: "{dur} away. Detours are fine, now let's get back on the road." },
  { title: 'Bloop kept your seat warm', body: "{dur} off task. It's still warm. Come back?" },
  { title: 'Hey you ✨', body: "You're doing great today. {dur} away, time to return." },
  { title: 'Mind wandering?', body: "That's normal. {dur} off task. Gently bring it back." },
  { title: 'Ready for round two?', body: '{dur} away. Your work is ready when you are.' },
  { title: 'Bloop noticed', body: '{dur} off task. A quick return keeps your score climbing.' },
  { title: 'Your score misses you', body: '{dur} away. Come back and watch it go up again.' },
  { title: 'Little reminder', body: 'One tab at a time. {dur} off task.' },
  { title: 'Focus first, fun later', body: '{dur} away. The fun stuff will still be there after.' },
  { title: 'Let’s get unstuck', body: "If you're stuck, try the smallest next step. {dur} off task." },
  { title: 'Bloop is here for you', body: "{dur} off task. Let's do this together." },
  { title: 'Keep the streak alive', body: '{dur} away. Get back before the streak cools off.' },
  { title: 'You and me vs. this assignment', body: "{dur} off task. Let's win this one." },
  { title: 'Back on track?', body: "{dur} away. Bloop will be so happy when you're back." },
  { title: 'Snack break or distraction?', body: "If it's a break, start one in Bloop. {dur} off task." },
  { title: 'Almost there', body: "{dur} off task. A few focused minutes can finish this." }
]

/** {break}: the break length, e.g. "5 min". */
const BREAK_START: NotifyTemplate[] = [
  { title: 'Break time!', body: 'Nice work. {break} break. Stretch, drink some water 💧' },
  { title: 'Pomodoro done ✅', body: 'You earned a {break} break. Step away from the screen.' },
  { title: 'Great focus!', body: 'Take {break}. Bloop is napping too.' },
  { title: 'Time to rest', body: '{break} break. Look at something far away for a bit.' },
  { title: 'You did it!', body: 'One pomodoro down. Enjoy your {break} break.' },
  { title: 'Stretch it out 🙆', body: '{break} break. Roll your shoulders, stand up, breathe.' },
  { title: 'Break unlocked', body: '{break} to recharge. You worked hard.' },
  { title: 'Nicely done', body: 'Grab a glass of water. {break} break starts now.' },
  { title: 'Pause button', body: '{break} break. Your brain is filing everything away.' },
  { title: 'Bloop is proud of you', body: 'That was a solid block. {break} break.' },
  { title: 'Rest mode', body: '{break} break. Maybe a quick walk?' },
  { title: 'Focus block complete', body: 'Take {break} for yourself. Bloop will wake you up.' },
  { title: 'Breather time', body: '{break} break. Eyes off the screen if you can.' },
  { title: 'Well earned', body: "That's another pomodoro. {break} break, enjoy it." },
  { title: 'Recharge 🔋', body: '{break} break. A snack might help.' },
  { title: 'Step away', body: '{break} break. Come back fresh.' },
  { title: 'One more done', body: 'You keep showing up. {break} break.' },
  { title: 'Break o’clock', body: '{break} break. Bloop is already snoring.' },
  { title: 'Good stuff', body: 'Rest for {break}. You can come back to it after.' },
  { title: 'Time out', body: '{break} break. Shake out your hands, relax your jaw.' },
  { title: 'Progress!', body: 'Another focused block in the books. {break} break.' },
  { title: 'Little reward', body: '{break} break. Do something you enjoy.' },
  { title: 'Mini vacation 🏝️', body: '{break} away from work. You deserve it.' },
  { title: 'Phew!', body: '{break} break. Hydrate and stretch.' },
  { title: 'Break started', body: 'Nice focus. Bloop will let you know when {break} is up.' }
]

const FOCUS_START: NotifyTemplate[] = [
  { title: 'Time to focus', body: "Break's over. Let's start the next pomodoro!" },
  { title: 'Back to it 💪', body: 'Break done. One more focused block.' },
  { title: 'Bloop is awake!', body: "Nap's over. Let's get some work done." },
  { title: 'Ready, set, focus', body: 'Your next pomodoro starts now.' },
  { title: 'Round two', body: 'Break finished. Pick up where you left off.' },
  { title: 'Focus mode on', body: "Let's make this block count." },
  { title: 'Here we go again', body: 'Break over. You know the drill.' },
  { title: 'Let’s do this', body: 'Next pomodoro is starting. Bloop is ready.' },
  { title: 'Break’s up', body: 'Back to your work. Small steps.' },
  { title: 'Welcome back', body: 'Hope that break helped. Time to focus.' },
  { title: 'Next block', body: 'Close the fun tabs, open the work. Go!' },
  { title: 'Rested and ready?', body: 'Your focus block starts now.' },
  { title: 'Bloop says go! 🚀', body: 'New pomodoro. You can do this.' },
  { title: 'Back in action', body: "Break over. Let's keep the momentum." },
  { title: 'Focus time', body: 'One task, one block. Start small.' },
  { title: 'Let’s get going', body: 'Break done. Pick one thing to finish.' },
  { title: 'The timer is running', body: 'Next pomodoro started. Bloop is watching your back.' },
  { title: 'Fresh start', body: 'New block, fresh mind. Go get it.' },
  { title: 'Time to shine ✨', body: 'Break over. Show that work what you’ve got.' },
  { title: 'Ready when you are', body: "Next focus block has started. Let's go." },
  { title: 'Back to the books 📚', body: 'Break finished. One more push.' },
  { title: 'Keep it rolling', body: "You're on a streak. Next pomodoro starts now." },
  { title: 'Here comes focus', body: 'Phone down, work up. New block started.' },
  { title: 'Let’s keep going', body: 'Break over. Bloop is right here with you.' },
  { title: 'Next pomodoro', body: "You've got this. Time to focus." }
]

/** Body shown when a reminder has no label of its own. */
const STUDY_REMINDER: NotifyTemplate[] = [
  { title: 'Time to study! 📚', body: 'Your study pet is ready when you are.' },
  { title: 'Study time', body: "Bloop is waving at you. Let's start a session." },
  { title: 'It’s that time', body: 'Your study reminder is here. Ready?' },
  { title: 'Bloop is ready 🐾', body: 'Start a focus session whenever you are.' },
  { title: 'Let’s study', body: 'Even 25 minutes makes a difference.' },
  { title: 'Reminder from Bloop', body: 'You planned to study now. Want to start?' },
  { title: 'Hey, study buddy', body: 'Bloop saved you a spot. Start a session?' },
  { title: 'Focus o’clock', body: 'Your study time has arrived.' },
  { title: 'Ready to learn?', body: 'One pomodoro to get going.' },
  { title: 'Bloop is waiting', body: "It's study time. Bloop is excited." },
  { title: 'Start small', body: 'Open your notes and start one pomodoro.' },
  { title: 'Your plan says study', body: 'Ready when you are. Bloop is here.' },
  { title: 'Time to get to work', body: "Let's make some progress today." },
  { title: 'Knock knock', body: "It's your study reminder. Shall we?" },
  { title: 'Bloop has a reminder', body: 'Study time! Start a session to begin.' },
  { title: 'Let’s make progress', body: 'Just one block to start. You can do more after.' },
  { title: 'Study session?', body: "Bloop is ready. Are you?" },
  { title: 'Your future self called', body: 'They said thanks for studying now. 📞' },
  { title: 'A gentle reminder', body: 'You planned some study time. Start when you can.' },
  { title: 'Time for focus', body: 'Pick one task and start a pomodoro.' },
  { title: 'Ding! 🔔', body: "Study time. Let's go." },
  { title: 'Let’s go, champ', body: 'Your study session is waiting.' },
  { title: 'Bloop is ready to focus', body: 'Start a session and Bloop will keep you company.' },
  { title: 'Study reminder', body: 'A little now beats a lot later.' },
  { title: 'Hello from Bloop', body: "It's study time. You've got this." },
  { title: 'Get set', body: 'Grab water, open your work, start a session.' },
  { title: 'Today’s study time', body: "Let's get a focused block in." },
  { title: 'Bloop is cheering 📣', body: 'Time to study. Start whenever you’re ready.' },
  { title: 'Your scheduled study time', body: 'Bloop is ready to start the timer.' },
  { title: 'Let’s get started', body: "The hardest part is starting. Let's do it together." }
]

/** {title}: the deadline title, {days}: "1 day" or "3 days", {when}: the date and time. */
const DEADLINE: NotifyTemplate[] = [
  { title: '{title} in {days}', body: '{when}. Want to start a study session?' },
  { title: '{title} is coming up', body: 'In {days} ({when}). A session now would help.' },
  { title: 'Heads up: {title}', body: "It's in {days}, on {when}. Let's prepare." },
  { title: '{days} until {title}', body: '{when}. Bloop can help you get ready.' },
  { title: 'Get ready for {title}', body: 'Only {days} left ({when}). Start a session?' },
  { title: '{title} soon 📅', body: '{days} away, {when}. A little review today goes a long way.' },
  { title: 'Reminder: {title}', body: 'In {days}, {when}. Want to study for it now?' },
  { title: '{title} in {days}', body: "{when}. You've got time, let's use it well." },
  { title: 'Countdown: {title}', body: '{days} to go ({when}). One pomodoro to start?' },
  { title: 'Coming up: {title}', body: 'In {days}, {when}. Bloop is ready when you are.' },
  { title: '{title} is close', body: '{days} left, {when}. Start a session?' },
  { title: 'Don’t forget {title}', body: "It's in {days}, on {when}. Let's get some studying in." },
  { title: 'Prep time for {title}', body: '{days} away ({when}). Bloop believes in you.' },
  { title: '{title} in {days} ⏳', body: '{when}. A focused session now will help.' },
  { title: 'Almost here: {title}', body: '{days} left ({when}). Review a little today?' },
  { title: '{title} on the horizon', body: 'In {days} ({when}). Want to start studying?' },
  { title: 'You can do this: {title}', body: '{days} to prepare ({when}). Start a session?' },
  { title: '{title} reminder', body: 'In {days}, {when}. Bloop can keep you on track.' },
  { title: 'Plan ahead for {title}', body: '{days} left, {when}. A session now helps later.' },
  { title: 'Study for {title}?', body: "It's in {days} ({when}). Let's go." }
]

export const NOTIFICATIONS: Readonly<Record<NotifyKind, readonly NotifyTemplate[]>> = {
  drift: DRIFT,
  breakStart: BREAK_START,
  focusStart: FOCUS_START,
  studyReminder: STUDY_REMINDER,
  deadline: DEADLINE
}

/** Replaces {name} with vars[name]; unknown placeholders are left as they are. */
export function fillTemplate(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/**
 * Picks notification text per event from a shuffle bag: every message of an event is used once
 * before any repeats, and a new round never starts with the message that ended the last one.
 */
export class NotificationPicker {
  private bags = new Map<NotifyKind, number[]>()
  private last = new Map<NotifyKind, number>()

  constructor(private readonly random: () => number = Math.random) {}

  next(kind: NotifyKind, vars: Record<string, string> = {}): NotifyTemplate {
    const list = NOTIFICATIONS[kind]
    let bag = this.bags.get(kind)
    if (!bag || bag.length === 0) {
      bag = list.map((_, i) => i)
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1)) % (i + 1)
        ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
      }
      // Don't start a new round with the message that ended the previous one.
      if (bag.length > 1 && bag[bag.length - 1] === this.last.get(kind)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!]
      this.bags.set(kind, bag)
    }
    const i = bag.pop()!
    this.last.set(kind, i)
    const t = list[i]!
    return { title: fillTemplate(t.title, vars), body: fillTemplate(t.body, vars) }
  }
}
