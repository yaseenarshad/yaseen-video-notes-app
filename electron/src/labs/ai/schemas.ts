/**
 * Strict JSON schemas of the JSON answers (codex `--output-schema`: every object closed, every key required — an
 * optional field is nullable instead). The validators stay the same: `dropNulls` turns the nulls back into absent keys.
 */
type Schema = Record<string, unknown>
const str: Schema = { type: 'string' }
const nstr: Schema = { type: ['string', 'null'] }
const int: Schema = { type: 'integer' }
const span: Schema = { type: 'array', items: int }
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const arr = (items: Schema): Schema => ({ type: 'array', items })

/** The Labs analysis (analysis/prompt.ts "RETURN exactly one JSON object…"). */
export const ANALYSIS_SCHEMA: Schema = obj({
  highlights: arr(obj({ span, first: str, last: str, label: str, why: str, score: int })),
  paragraphScores: str,
  pullQuotes: arr(obj({ chapter: int, span, first: str, last: str })),
  questions: arr(obj({ q: span, qFirst: str, qLast: str, a: { type: ['array', 'null'], items: int }, aFirst: nstr, aLast: nstr })),
  claims: arr(obj({ type: str, span, first: str, last: str })),
  mochiCandidates: arr(obj({ type: str, label: str, span, first: str, last: str })),
})

/** ask-the-video (`{"passages": [...]}`). */
export const ASK_SCHEMA: Schema = obj({ passages: arr(obj({ span, first: str, last: str, score: int })) })

/** A JSON answer with nulls (schema-nullable optional fields) → the same answer without those keys. */
export function dropNulls(text: string): string {
  let v: unknown
  try { v = JSON.parse(text) } catch { return text }
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, y]) => y !== null).map(([k, y]) => [k, walk(y)]))
    return x
  }
  return JSON.stringify(walk(v))
}
