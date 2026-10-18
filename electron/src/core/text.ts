// Swift-compatible text helpers, so the files this app writes are byte-identical to the
// Swift app's (same whitespace classes, same trimming, same number parsing).

/** Swift `Character.isWhitespace` (Unicode White_Space). */
export const WS = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000'
/** Foundation `CharacterSet.whitespaces` (Zs + tab). */
const SPACES = '\\t \\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000'
/** Foundation `CharacterSet.whitespacesAndNewlines`. */
const SPACES_NL = SPACES + '\\n\\v\\f\\r\\u0085\\u2028\\u2029'

const reTrimWS = new RegExp(`^[${SPACES}]+|[${SPACES}]+$`, 'g')
const reTrimWSNL = new RegExp(`^[${SPACES_NL}]+|[${SPACES_NL}]+$`, 'g')
const reSplitWS = new RegExp(`[${WS}]+`)

/** `trimmingCharacters(in: .whitespaces)` */
export const trimWS = (s: string): string => s.replace(reTrimWS, '')
/** `trimmingCharacters(in: .whitespacesAndNewlines)` */
export const trimWSNL = (s: string): string => s.replace(reTrimWSNL, '')
/** `split(whereSeparator: { $0.isWhitespace })` (empty pieces dropped). */
export const splitWS = (s: string): string[] => s.split(reSplitWS).filter((x) => x.length > 0)

/** Swift `Double(String)`: true when the text parses as a Double. */
export function isSwiftDouble(s: string): boolean {
  return /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|0[xX](?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)(?:[pP][+-]?\d+)?|inf|infinity|nan|snan)$/i.test(s)
}

/** Swift `Double(String)` for plain decimals (nil → null). */
export function swiftDouble(s: string): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null
  return Number(s)
}

/** Swift `Int(String)` (nil → null). */
export function swiftInt(s: string | null | undefined): number | null {
  if (s == null || !/^[+-]?\d+$/.test(s)) return null
  return parseInt(s, 10)
}

/** `String(format: "%02d", n)` */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Grapheme clusters (Swift `Character`s). */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
export function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (x) => x.segment)
}
