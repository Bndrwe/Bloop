import { describe, expect, it } from 'vitest'
import {
  allCourses,
  courseCodeOf,
  judgeContent,
  pageTitle,
  titleKey,
  urlKey,
  urlText,
  type JudgeContext
} from '../src/main/contentJudge'

const NONE: JudgeContext = { courses: [], deadlineTitles: [], focusWords: [] }
const ME: JudgeContext = {
  courses: [
    { label: 'CHEM 201', name: 'CHEM 201 - Organic Chemistry' },
    { label: 'HIST 110', name: 'World History Since 1500' },
    { label: 'MATH 220', name: 'Linear Algebra' }
  ],
  deadlineTitles: ['CHEM 201: Midterm 2', 'PSYC 101: Reading response on cognitive dissonance', 'Essay draft due'],
  focusWords: ['Notion', 'Overleaf', 'brightspace']
}

const yt = (title: string, ctx: JudgeContext = NONE, url = 'https://www.youtube.com/watch?v=abc') =>
  judgeContent({ domain: 'youtube.com', url, title: `${title} - YouTube - Google Chrome` }, ctx)

describe('pageTitle', () => {
  it('strips the browser suffix, the site name and the notification counter', () => {
    expect(pageTitle('Organic Chemistry Lecture 12: SN1 vs SN2 - YouTube - Google Chrome', 'youtube.com')).toBe(
      'Organic Chemistry Lecture 12: SN1 vs SN2'
    )
    expect(pageTitle('(3) Minecraft Hardcore - YouTube', 'youtube.com')).toBe('Minecraft Hardcore')
    expect(pageTitle('How I study | by Sam | Medium', 'medium.com')).toBe('How I study - by Sam')
    expect(pageTitle('A lecture on Vimeo', 'vimeo.com')).toBe('A lecture')
  })
  it('gives "" for a bare site name', () => {
    expect(pageTitle('YouTube', 'youtube.com')).toBe('')
    expect(pageTitle('YouTube - Google Chrome', 'youtube.com')).toBe('')
    expect(pageTitle('Reddit - Dive into anything', 'reddit.com')).toBe('')
    expect(pageTitle('', 'youtube.com')).toBe('')
    expect(pageTitle(undefined, 'youtube.com')).toBe('')
  })
})

describe('urlText', () => {
  it('reads a YouTube search, a channel handle and Shorts', () => {
    expect(urlText('https://www.youtube.com/results?search_query=organic+chemistry+sn2')).toContain('organic chemistry sn2')
    expect(urlText('https://www.youtube.com/@3blue1brown')).toContain('3blue1brown')
    expect(urlText('https://www.youtube.com/shorts/xyz')).toContain('#shorts')
  })
  it('reads a subreddit and a post slug', () => {
    const t = urlText('https://www.reddit.com/r/chemhelp/comments/abc/help_with_sn2_mechanism/')
    expect(t).toContain('r/chemhelp')
    expect(t).toContain('help with sn2 mechanism')
  })
  it('reads an article slug without its hash id', () => {
    expect(urlText('https://medium.com/@sam/how-to-solve-recurrence-relations-3f2a9c1b')).toBe('how to solve recurrence relations')
  })
  it('ignores video ids and junk', () => {
    expect(urlText('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('')
    expect(urlText('not a url at all ::')).toBe('')
    expect(urlText(undefined)).toBe('')
  })
})

describe('judgeContent: study', () => {
  const study: [string, JudgeContext?][] = [
    ['Organic Chemistry Lecture 12: SN1 vs SN2'],
    ['Lecture 3: Eigenvalues and Eigenvectors | MIT 18.06 Linear Algebra'],
    ['Khan Academy: Intro to derivatives'],
    ['Crash Course World History #21'],
    ['SN2 Reaction Mechanism - The Organic Chemistry Tutor'],
    ['But what is a neural network? | 3Blue1Brown'],
    ['How to solve quadratic equations step by step'],
    ['Calculus 1 Final Exam Review'],
    ['Thermodynamics explained in 10 minutes'],
    ['Practice problems: stoichiometry'],
    ['APA format citations tutorial'],
    ['Python tutorial for beginners - full course'],
    ['Music theory lecture: intervals'],
    ['Midterm review session CHEM 201', ME]
  ]
  for (const [title, ctx] of study) {
    it(`"${title}" is study`, () => expect(yt(title, ctx).verdict).toBe('study'))
  }

  it('a course code wins and is the reason', () => {
    const r = yt('Organic Chemistry Lecture 12: SN1 vs SN2', ME)
    expect(r).toMatchObject({ verdict: 'study', reason: 'matches CHEM 201' })
  })
  it('matches a course code written without a space or with a dash', () => {
    expect(yt('chem201 week 5 recording', ME)).toMatchObject({ verdict: 'study', reason: 'matches CHEM 201' })
    expect(yt('MATH-220 recitation', ME)).toMatchObject({ verdict: 'study', reason: 'matches MATH 220' })
  })
  it('matches a course by its name', () => {
    expect(yt('Linear Algebra full walk through', ME)).toMatchObject({ verdict: 'study', reason: 'matches MATH 220' })
  })
  it('matches a course code that only appears in a deadline title', () => {
    expect(yt('PSYC 101 study guide', ME)).toMatchObject({ verdict: 'study', reason: 'matches PSYC 101' })
  })
  it('matches distinctive words from an upcoming deadline', () => {
    expect(yt('Cognitive dissonance in 5 minutes', ME)).toMatchObject({ verdict: 'study', reason: 'matches a PSYC 101 deadline' })
  })
  it('without the course list a plain title can stay unsure', () => {
    expect(yt('chem201 week 5 recording').verdict).toBe('unsure')
  })
  it('a YouTube search counts too', () => {
    const r = judgeContent(
      { domain: 'youtube.com', url: 'https://www.youtube.com/results?search_query=sn2+reaction+mechanism+tutorial', title: 'YouTube' },
      NONE
    )
    expect(r.verdict).toBe('study')
  })
  it('a study subreddit is study', () => {
    const r = judgeContent({ domain: 'reddit.com', url: 'https://www.reddit.com/r/chemhelp/', title: 'r/chemhelp' }, NONE)
    expect(r.verdict).toBe('study')
  })
  it('a Medium tutorial is study', () => {
    const r = judgeContent({ domain: 'medium.com', url: 'https://medium.com/@a/x', title: 'A gentle tutorial on recursion | Medium' }, NONE)
    expect(r.verdict).toBe('study')
  })
  it('"of course" is not a course', () => {
    expect(yt('Of course he did that').verdict).not.toBe('study')
  })
})

describe('judgeContent: not study', () => {
  const fun: [string, string][] = [
    ["Minecraft Hardcore Let's Play #45", 'looks like gameplay'],
    ['Fortnite gameplay no commentary', 'looks like gameplay'],
    ['My morning routine VLOG', 'looks like a vlog'],
    ['Extreme prank on my roommate', 'looks like a prank video'],
    ['Reacting to my old TikToks', 'looks like a reaction video'],
    ['Lakers vs Celtics Full Game Highlights', 'looks like highlights'],
    ['Dune: Part Three | Official Trailer', 'looks like a trailer'],
    ['Taylor Swift - Anti-Hero (Official Music Video)', 'looks like music'],
    ['Try Not To Laugh Challenge #7', 'looks like something funny'],
    ['Best fails compilation 2026', 'looks like something funny'],
    ['Dank memes that cured my depression', 'looks like memes'],
    ['Spicy noodle MUKBANG', 'looks like a mukbang'],
    ['ASMR tapping sounds for sleep', 'looks like ASMR'],
    ['cat does a backflip #shorts', 'looks like Shorts']
  ]
  for (const [title, reason] of fun) {
    it(`"${title}" is not study (${reason})`, () => expect(yt(title)).toMatchObject({ verdict: 'not-study', reason }))
  }
  it('stays not study for a student with courses', () => {
    expect(yt("Minecraft Hardcore Let's Play #45", ME).verdict).toBe('not-study')
  })
  it('YouTube Shorts by URL alone', () => {
    const r = judgeContent({ domain: 'youtube.com', url: 'https://www.youtube.com/shorts/abc', title: 'YouTube' }, NONE)
    expect(r).toMatchObject({ verdict: 'not-study', reason: 'looks like Shorts' })
  })
  it('an entertainment subreddit is not study', () => {
    const r = judgeContent({ domain: 'reddit.com', url: 'https://www.reddit.com/r/memes/', title: 'r/memes' }, NONE)
    expect(r.verdict).toBe('not-study')
  })
  it('a chemical reaction is not a reaction video', () => {
    expect(yt('Balancing chemical reactions explained').verdict).toBe('study')
  })
})

describe('judgeContent: unsure', () => {
  it('no readable title', () => {
    expect(judgeContent({ domain: 'youtube.com', url: 'https://www.youtube.com/', title: 'YouTube' }, ME)).toMatchObject({
      verdict: 'unsure',
      reason: 'no title to judge'
    })
    expect(judgeContent({ domain: 'youtube.com', title: '' }, ME).verdict).toBe('unsure')
  })
  it('no signals either way', () => {
    expect(yt('What happened to Sam?').verdict).toBe('unsure')
    expect(yt('My thoughts on the new phone').verdict).toBe('unsure')
  })
  it('mixed signals', () => {
    expect(yt('Minecraft redstone tutorial')).toMatchObject({ verdict: 'unsure', reason: 'mixed signals' })
  })
  it('page text tips an unclear title (weighs half)', () => {
    const page = { domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=q', title: 'Episode 4 - YouTube' }
    expect(judgeContent(page, NONE).verdict).not.toBe('study')
    const withText = judgeContent({ ...page, pageText: 'Lecture 4 of the organic chemistry course | Lecture notes and practice problems' }, NONE)
    expect(withText.verdict).toBe('study')
  })
})

describe('course helpers', () => {
  it('courseCodeOf', () => {
    expect(courseCodeOf('CHEM 201: Midterm 2')).toBe('CHEM 201')
    expect(courseCodeOf('Essay draft due')).toBeNull()
  })
  it('allCourses merges Brightspace courses and deadline codes', () => {
    expect(allCourses(ME).map((c) => c.label)).toEqual(['CHEM 201', 'HIST 110', 'MATH 220', 'PSYC 101'])
  })
})

describe('keys', () => {
  it('urlKey: YouTube video id, search, short links; drops other query and hash', () => {
    expect(urlKey('https://www.youtube.com/watch?v=abc&t=42s#x')).toBe('youtube.com/watch?v=abc')
    expect(urlKey('https://m.youtube.com/watch?v=abc')).toBe('youtube.com/watch?v=abc')
    expect(urlKey('https://youtu.be/abc?si=zz')).toBe('youtube.com/watch?v=abc')
    expect(urlKey('https://www.youtube.com/results?search_query=SN2+Mechanism')).toBe('youtube.com/results?search_query=sn2 mechanism')
    expect(urlKey('https://www.reddit.com/r/chemhelp/?utm=1')).toBe('reddit.com/r/chemhelp')
    expect(urlKey('chrome://newtab')).toBeUndefined()
    expect(urlKey(undefined)).toBeUndefined()
  })
  it('titleKey', () => {
    expect(titleKey('youtube.com', 'Organic  Chemistry Lecture - YouTube - Google Chrome')).toBe('youtube.com|organic chemistry lecture')
    expect(titleKey('youtube.com', 'YouTube')).toBeUndefined()
  })
})
