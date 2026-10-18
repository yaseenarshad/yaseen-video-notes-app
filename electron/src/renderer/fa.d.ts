import type { FaAPI } from '../shared/api'

declare global {
  interface Window { fa: FaAPI }
}
