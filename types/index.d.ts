/** The last main-thread model request, as the API reported its usage. */
export type LastRequest = {
  /** When the response arrived, in `$.clock.now()` milliseconds. */
  at: number
  /** Input tokens served from the prompt cache. */
  read: number
  /** Input tokens written to the prompt cache. */
  write: number
  /** Input tokens neither read from nor written to the cache. */
  uncached: number
  /** Tokens the response generated; the next request sends them back. */
  output?: number
  model: string
}

/** Session totals over every main-thread request seen. */
export type Totals = {
  read: number
  write: number
  uncached: number
  requests: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-status': {
      last: LastRequest | null
      totals: Totals
      /** A clock tick, so the countdown redraws by itself. */
      now: number
    }
  }
}
