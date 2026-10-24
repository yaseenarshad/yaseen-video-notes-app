// 📍 Home (the main spot) and back / forward history: core/home.ts (served to the player as /home.js).
import { describe, expect, it } from 'vitest'
import { homeTracker } from './home'

/** Plays from the tracker's time for `secs` at `rate`, one status sample every 250 ms. */
function player(start = 0) {
  const h = homeTracker()
  let t = start, wall = 1_000_000
  const s = {
    h,
    get t() { return t },
    play(secs: number, rate = 1) {
      for (let k = 0; k < secs * 4; k++) { wall += 250; t += 0.25 * rate; h.tick(t, rate, wall) }
    },
    pause(secs: number) { for (let k = 0; k < secs * 4; k++) { wall += 250; h.tick(t, 1, wall, true) } },
    /** A seek the page makes (click, key, home, …): reported, then the status settles. */
    seek(to: number) { h.seek(t, to, wall); t = to },
    /** A jump nobody reported (the YouTube seek bar): only the status shows it. */
    scrub(to: number) { wall += 250; t = to; h.tick(t, 1, wall) },
    back() { const to = h.back(t, wall); if (to !== null) t = to; return to },
    forward() { const to = h.forward(t, wall); if (to !== null) t = to; return to },
    view: () => h.view(t),
  }
  h.tick(t, 1, wall)
  return s
}

describe('home', () => {
  it('follows the playhead during normal play (and while paused stays)', () => {
    const p = player(100)
    p.play(60)
    expect(p.view()).toMatchObject({ home: 160, frozen: false, away: false, back: [], forward: [] })
    p.pause(30)
    expect(p.view().home).toBe(160)
  })

  it('3× continuous play is not a jump', () => {
    const p = player(0)
    p.play(120, 3)
    expect(p.view()).toMatchObject({ home: 360, frozen: false, back: [] })
  })

  it('a big jump freezes home at the spot before it and pushes it on the back stack', () => {
    const p = player(0)
    p.play(100)                // home 100
    p.seek(1000)               // click a word far ahead
    p.play(30)
    expect(p.view()).toMatchObject({ home: 100, frozen: true, away: true, back: [100] })
    p.seek(2000)               // another jump while away: home stays, the spot left is pushed
    expect(p.view()).toMatchObject({ home: 100, back: [100, 1030] })
  })

  it('a jump from the YouTube seek bar (not reported) is detected from the status time', () => {
    const p = player(0)
    p.play(50)
    p.scrub(500)
    p.play(5)
    expect(p.view()).toMatchObject({ home: 50, frozen: true, away: true, back: [50] })
  })

  it('returning to home unfreezes it: by playing into it, or by landing on it (H)', () => {
    const p = player(0)
    p.play(100)
    p.seek(40)                 // jump back 60 s: frozen at 100
    expect(p.view()).toMatchObject({ home: 100, frozen: true })
    p.play(55)
    expect(p.view()).toMatchObject({ home: 100, frozen: true, away: false })
    p.play(14)                 // passes 100 by playing
    expect(p.view()).toMatchObject({ home: 109, frozen: false })
    p.seek(600); p.play(5)
    expect(p.view()).toMatchObject({ home: 109, frozen: true, away: true })
    p.seek(p.view().home! - 1) // H: lands on home
    expect(p.view()).toMatchObject({ frozen: false, away: false })
    p.play(10)
    expect(p.view().home).toBe(118)
  })

  it('small skips never freeze on their own, but skips that add up to > 20 s are a detour', () => {
    const p = player(0)
    p.play(100)
    p.seek(p.t - 5)            // Z
    p.play(2)
    expect(p.view()).toMatchObject({ home: 100, frozen: false })
    p.play(10)                 // plays back through home: follows again
    expect(p.view()).toMatchObject({ home: 107, frozen: false })
    p.seek(p.t - 10); p.play(1); p.seek(p.t - 10); p.play(1); p.seek(p.t - 10)   // ← ← ←
    expect(p.view()).toMatchObject({ home: 107, frozen: true, away: true, back: [107] })
    // a forward skip while following just moves along (home is within 20 s behind)
    const q = player(0)
    q.play(50); q.seek(q.t + 10); q.play(3)
    expect(q.view()).toMatchObject({ home: 63, frozen: false, back: [] })
  })

  it('suggests "Make this Home?" after ~3 min of listening away; never moves home itself', () => {
    const p = player(0)
    p.play(100); p.seek(1000)
    p.play(170)
    expect(p.view()).toMatchObject({ home: 100, suggest: false })
    p.pause(60)
    expect(p.view().suggest).toBe(false)
    p.play(15)
    expect(p.view()).toMatchObject({ home: 100, suggest: true, frozen: true })
    p.h.makeHome(p.t)
    expect(p.view()).toMatchObject({ home: 1185, frozen: false, suggest: false, away: false })
  })

  it('back / forward like a browser: no new entries, a new jump clears forward, duplicates within 5 s merge, cap 30', () => {
    const p = player(0)
    p.play(100); p.seek(500); p.play(10); p.seek(900); p.play(10)
    expect(p.view().back).toEqual([100, 510])
    expect(p.back()).toBe(510)
    expect(p.view()).toMatchObject({ back: [100], forward: [910] })
    expect(p.back()).toBe(100)
    expect(p.view()).toMatchObject({ back: [], forward: [910, 510], home: 100, frozen: false })
    expect(p.back()).toBeNull()
    expect(p.forward()).toBe(510)
    expect(p.view()).toMatchObject({ back: [100], forward: [910], frozen: true, home: 100 })
    p.play(2)
    p.seek(1500)               // a new big jump: forward cleared
    expect(p.view()).toMatchObject({ back: [100, 512], forward: [] })
    p.seek(1600); p.seek(1502); p.seek(2000)   // bouncing: 1502 replaces 1500
    expect(p.view().back).toEqual([100, 512, 1600, 1502])
    const q = player(0)
    for (let k = 1; k <= 40; k++) { q.play(1); q.seek(k * 100) }
    expect(q.view().back.length).toBe(30)
  })
})

describe('stray status times', () => {
  it('a sample or two at 0 from the YouTube frame is not a jump; a real one lasts', () => {
    const p = player(0)
    p.play(300)
    p.h.tick(0, 1, 1_000_000 + 300 * 1000 + 50); p.h.tick(0, 1, 1_000_000 + 300 * 1000 + 100)
    p.play(5)
    expect(p.view()).toMatchObject({ home: 305, frozen: false, back: [] })
  })
})

describe('seeks landing', () => {
  it('old status times right after a seek of ours (or the resume) are not jumps', () => {
    const h = homeTracker()
    h.makeHome(1800, 0, 1797)              // resume: home from the file, the page seeks to 3 s before it
    h.tick(0, 1, 100); h.tick(0.06, 1, 160) // the frame still reports its start
    h.tick(1797, 1, 900); h.tick(1797.5, 1, 1400)
    expect(h.view(1797.5)).toMatchObject({ home: 1800, frozen: false, back: [] })
    h.tick(1801, 1, 4900)
    expect(h.view(1801)).toMatchObject({ home: 1801, frozen: false })
    h.seek(1801, 3000, 5000)
    h.tick(1801.1, 1, 5100)                 // not landed yet
    h.tick(3000.1, 1, 5200); h.tick(3000.6, 1, 5700)
    expect(h.view(3000.6)).toMatchObject({ home: 1801, frozen: true, back: [1801] })
  })
})

describe('served to the page', () => {
  it('is self-contained (its source runs on its own, as /home.js)', () => {
    const fn = new Function('return (' + homeTracker.toString() + ')')() as typeof homeTracker
    const h = fn()
    h.tick(10, 1, 0); h.seek(10, 500, 100)
    expect(h.view(500)).toMatchObject({ home: 10, frozen: true, away: true, back: [10] })
  })
})
