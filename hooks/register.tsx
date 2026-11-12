import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LastRequest, Totals } from '../types'

const NO_TOTALS: Totals = { read: 0, write: 0, uncached: 0, requests: 0 }

const last = atom({ plugin: 'cache-status', key: 'last' } as const, null)
const totals = atom({ plugin: 'cache-status', key: 'totals' } as const, NO_TOTALS)
const now = atom({ plugin: 'cache-status', key: 'now' } as const, 0)

const TICK_MS = 15_000

// The API's published billing rates for cached input, against one uncached
// input token: a cache read, and a cache write per lifetime.
const READ_X = 0.1
const WRITE_X_5M = 1.25
const WRITE_X_1H = 2

const k = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n)

const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0

const span = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Did the last request read from or write to the cache at all. */
const isCached = (one: LastRequest): boolean => one.read > 0 || one.write > 0

/** The tokens the next request sends again: the whole conversation so far. */
const contextOf = (one: LastRequest): number =>
  one.read + one.write + one.uncached + (one.output ?? 0)

/** Is the conversation still cached, and until when. */
function headline(one: LastRequest, at: number, ttlMs: number): string {
  if (!isCached(one)) {
    return 'Cache: OFF (last request was not cached)'
  }

  const left = one.at + ttlMs - at

  return left > 0
    ? `Cache: WARM, expires in ${span(left)}`
    : `Cache: EXPIRED ${span(-left)} ago`
}

/** The dot per state: an emoji, since the desktop footer drops text colour. */
const DOT: Record<string, string> = {
  success: '🟢',
  warning: '🟡',
  error: '🔴',
  inactive: '⚪',
}

/** The footer indicator: its colour and its words. */
function indicator(one: LastRequest, at: number, ttlMs: number): { color: string; detail: string } {
  if (!isCached(one)) {
    return { color: 'inactive', detail: 'off' }
  }

  const left = one.at + ttlMs - at

  if (left <= 0) {
    return { color: 'error', detail: 'expired' }
  }

  const soon = ttlMs > 5 * 60_000 ? 10 * 60_000 : 60_000

  return { color: left <= soon ? 'warning' : 'success', detail: span(left) }
}

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000
  const ttlName = options.cacheTtl === '5m' ? '5m' : '1h'
  const writeX = options.cacheTtl === '5m' ? WRITE_X_5M : WRITE_X_1H

  /** What the next prompt re-sends, and whether the cache serves it. */
  const forecast = (one: LastRequest, at: number): string => {
    const context = k(contextOf(one))

    if (!isCached(one)) {
      return `next prompt re-sends ${context} tokens, at the plain input rate if it is not cached either`
    }

    return one.at + ttlMs - at > 0
      ? `next prompt re-sends ${context} tokens, read from the cache (${READ_X}x input rate); ` +
          `once expired they are rewritten (${writeX}x)`
      : `next prompt re-sends ${context} tokens, rewritten to the cache (${writeX}x input rate)`
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-status',
      description: 'Print the prompt-cache status of this conversation',
    })
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then(at => update($, now, () => at))
    })

    return next(e)
  })

  // /clear ends the conversation in the same process and raises no
  // session.start: forget the old conversation's request and totals.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, last, () => null)
      await update($, totals, () => NO_TOTALS)
    }

    return next(e)
  })

  on('command.run', { command: 'cache-status' }, async $ => {
    const one = await read($, last)

    if (one === null) {
      return { text: 'No model request seen yet.' }
    }

    const at = await $.clock.now()
    const all = await read($, totals)
    const sum = all.read + all.write + all.uncached

    return {
      text:
        `${headline(one, at, ttlMs)} (${ttlName} lifetime); ` +
        `${forecast(one, at)}. ` +
        `Whole conversation: ${percent(all.read, sum)}% of input read from cache over ${all.requests} requests.`,
    }
  })

  // Each model request of a turn reports what it read from and wrote to the
  // prompt cache. Subagents keep caches of their own: main thread only.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const response = yield* next(e)
    const usage = response.usage

    if (isMain && usage !== null) {
      const at = await $.clock.now()
      const one: LastRequest = {
        at,
        read: usage.cache_read_input_tokens,
        write: usage.cache_creation_input_tokens,
        uncached: usage.input_tokens,
        output: usage.output_tokens,
        model: usage.model,
      }
      await update($, last, () => one)
      await update($, now, () => at)
      await update($, totals, sum => ({
        read: sum.read + one.read,
        write: sum.write + one.write,
        uncached: sum.uncached + one.uncached,
        requests: sum.requests + 1,
      }))
    }

    return response
  })

  // The footer, right of the prompt: the indicator beside the engine's mode
  // labels, as plain text, nothing to click. The dot is an emoji: the desktop
  // footer drops text colour.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const one = await read($, last)

    if (one === null) {
      return next(e)
    }

    const at = Math.max(one.at, await read($, now))
    const mark = indicator(one, at, ttlMs)
    const dot = DOT[mark.color] ?? '⚪'

    // The terminal takes the indicator as one more mode label, so the engine
    // draws its own separator between it and whatever the footer row holds
    // before it (a Debug or IDE pill).
    if (e.surface === 'terminal') {
      const modes = [...e.props.modes, `${dot} Cache ${mark.detail}`]

      return next({ ...e, props: { ...e.props, modes } })
    }

    // The desktop draws no label a hook adds to `modes`, so there the mod
    // draws its own beside the engine's.
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {await next(e)}
        <Text>
          {dot} Cache <Text dimColor>{mark.detail}</Text>
        </Text>
      </Box>
    )
  })
}
