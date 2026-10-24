/**
 * 📍 Home (the main spot) and back / forward history for the player, so jumping around a video never loses
 * your place.
 *
 * - **Home follows** the playhead while the video plays normally: it moves to the current time whenever that
 *   is at most ~20 s after home and reached by continuous play (any speed: 3× is not a jump).
 * - **A big jump** (|Δ| > 20 s: a click on a word / time / chapter / note / find result, ⌘[ / ⌘], the YouTube seek
 *   bar, …) **freezes** home at the spot before the jump. Jumps the page makes itself are reported with
 *   `seek()`; any other discontinuity in the status time that playback at the reported rate cannot explain
 *   (the seek bar) is detected by `tick()`.
 * - **Small skips** (Z / X / arrows, 5–10 s) never freeze home on their own, but skips that add up to more than
 *   20 s away from home without playing back to it are a detour too (frozen).
 * - **Reaching home again** by continuous play (or passing it), or landing within ~3 s of it, unfreezes it.
 * - After ~3 min of continuous listening while frozen, `suggest` is true (the page offers "Make this Home?";
 *   home never moves by itself).
 * - **History**: every big jump pushes the spot it left onto the back stack (cap 30; a spot within 5 s of one
 *   already on it replaces it) and clears the forward stack. `back()` / `forward()` move between them without adding
 *   entries. In memory only (one tracker per tab).
 *
 * IMPORTANT: `homeTracker` must stay self-contained (no imports, no module-level helpers): the app serves its
 * source to the player page as `/home.js` via `Function.prototype.toString` (like `noteAnchor.ts`).
 */

export type SeekKind = 'seek' | 'nav'

export interface HomeView {
  /** The main spot (s); null before the first status. */
  home: number | null
  /** True while away on a detour (home does not follow). */
  frozen: boolean
  /** True when the current time is more than ~20 s from home (show the 📍 pin and the chip). */
  away: boolean
  /** True after ~3 min of continuous listening away from home: offer "Make this Home?". */
  suggest: boolean
  back: number[]
  forward: number[]
}

export interface HomeTracker {
  /** A status sample: the video time, its rate, the wall clock (ms) and whether it is paused. */
  tick(t: number, rate: number, wall: number, paused?: boolean): void
  /** A seek the page makes itself: `nav` = back / forward (no history entry), `seek` = anything else. */
  seek(from: number, to: number, wall: number, kind?: SeekKind): void
  /** ⌘[: the spot to go to (null when the stack is empty). Moves the tracker there. */
  back(cur: number, wall: number): number | null
  /** ⌘]: the spot to go to (null when the stack is empty). */
  forward(cur: number, wall: number): number | null
  /** "Make this Home": home = t, following again. `landing`: the page is seeking to that time now (resume). */
  makeHome(t: number, wall?: number, landing?: number): void
  view(cur: number): HomeView
}

export function homeTracker(opts: { jump?: number; dedupe?: number; cap?: number; suggestAfter?: number; near?: number; settleMs?: number } = {}): HomeTracker {
  const JUMP = opts.jump ?? 20, DEDUPE = opts.dedupe ?? 5, CAP = opts.cap ?? 30, SUGGEST = opts.suggestAfter ?? 180
  const NEAR = opts.near ?? 3, SETTLE = opts.settleMs ?? 5000
  let home: number | null = null, frozen = false, awayPlay = 0, settleUntil = 0
  /** A seek of ours that the status has not shown yet (its samples may still report the old time). */
  let pending: number | null = null
  /** A jump seen in the status but not confirmed yet: it must last ~0.4 s (the YouTube frame reports a stray 0 at times). */
  let suspect: { from: number; to: number; wall: number; lastT: number; lastWall: number; anchor: { t: number; wall: number; rate: number; paused: boolean } } | null = null
  const CONFIRM = 400
  let last: { t: number; wall: number; rate: number; paused: boolean } | null = null
  let back: number[] = [], fwd: number[] = []

  // a spot within 5 s of one already on the stack replaces it (bouncing between two spots stays two entries)
  const push = (stack: number[], t: number): void => {
    for (let i = stack.length - 1; i >= 0; i--) if (Math.abs(stack[i] - t) < DEDUPE) stack.splice(i, 1)
    stack.push(t)
    if (stack.length > CAP) stack.shift()
  }

  // A discontinuity from `from` to `to`.
  const moved = (from: number, to: number, kind: SeekKind | 'inferred'): void => {
    if (home === null) home = from
    const big = kind === 'nav' || Math.abs(to - from) > JUMP
    if (big) {
      if (!frozen) {
        // re-listening a few seconds before home keeps home where it was
        if (!(from < home && home - from <= JUMP)) home = from
        frozen = true
      }
      if (kind !== 'nav') { push(back, from); fwd = [] }
    } else if (!frozen && Math.abs(to - home) > JUMP) {
      // small skips that added up to a detour
      frozen = true
      push(back, home); fwd = []
    }
    if (frozen && Math.abs(to - home) <= NEAR) frozen = false
    awayPlay = 0
  }

  return {
    tick(t, rate, wall, paused = false) {
      const sample = { t, wall, rate, paused }
      const L = last
      last = sample
      const fits = (prevT: number, prevWall: number, prevRate: number, prevPaused: boolean): boolean => {
        const dt = Math.max(0, (wall - prevWall) / 1000)
        return t >= prevT - 1 && t <= prevT + (prevPaused && paused ? 0 : Math.max(rate, prevRate, 0) * dt) + 1.5
      }
      if (home === null) { home = t; return }
      if (pending !== null) {
        // a seek of ours is landing: ignore the old times until the status shows it (or ~5 s passed)
        if (Math.abs(t - pending) <= NEAR || wall >= settleUntil) pending = null
        return
      }
      if (!L) return
      if (suspect) {
        const S = suspect
        if (fits(S.lastT, S.lastWall, rate, paused)) {
          // still on the new track: a real jump once it lasted ~0.4 s
          S.lastT = t; S.lastWall = wall
          if (wall - S.wall >= CONFIRM) { suspect = null; moved(S.from, t, 'inferred') } else last = S.anchor
          return
        }
        if (fits(S.anchor.t, S.anchor.wall, S.anchor.rate, S.anchor.paused)) { suspect = null; return }   // a stray sample
        suspect = { ...S, to: t, wall, lastT: t, lastWall: wall }   // jumped again: still from the same spot
        last = S.anchor
        return
      }
      const dt = Math.max(0, (wall - L.wall) / 1000)
      const playing = !(L.paused && paused)
      const maxAdvance = (playing ? Math.max(rate, L.rate, 0) * dt : 0) + 1.5
      if (t < L.t - 1 || t > L.t + maxAdvance) {
        suspect = { from: L.t, to: t, wall, lastT: t, lastWall: wall, anchor: L }
        last = L
        return
      }
      // continuous
      if (!frozen) {
        if (t >= home) home = t
      } else if (L.t <= home + 1 && t >= home - 1 && t >= L.t) {
        frozen = false   // played back to home (or through it)
        home = Math.max(home, t)
      } else if (!paused) {
        awayPlay += dt
      }
    },
    seek(from, to, wall, kind = 'seek') {
      suspect = null
      moved(from, to, kind)
      last = { t: to, wall, rate: last?.rate ?? 1, paused: last?.paused ?? false }
      pending = to; settleUntil = wall + SETTLE
    },
    back(cur, wall) {
      const to = back.pop()
      if (to === undefined) return null
      push(fwd, cur)
      this.seek(cur, to, wall, 'nav')
      return to
    },
    forward(cur, wall) {
      const to = fwd.pop()
      if (to === undefined) return null
      push(back, cur)
      this.seek(cur, to, wall, 'nav')
      return to
    },
    makeHome(t, wall, landing) {
      home = t; frozen = false; awayPlay = 0; suspect = null
      if (wall !== undefined) last = { t, wall, rate: last?.rate ?? 1, paused: last?.paused ?? false }
      // the page seeks there too (resume): wait for the status to show it
      if (landing !== undefined && wall !== undefined) { pending = landing; settleUntil = wall + SETTLE }
    },
    view(cur) {
      const away = home !== null && Math.abs(cur - home) > JUMP
      return { home, frozen, away, suggest: frozen && awayPlay >= SUGGEST, back: back.slice(), forward: fwd.slice() }
    },
  }
}
