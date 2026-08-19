import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { HostedWebSearchEventType, HostedWebSearchState } from './events.ts'

export const HOSTED_WEB_SEARCH_EVENT_TYPES: readonly HostedWebSearchEventType[] = [
  'bridge/hosted-web-search/start',
  'bridge/hosted-web-search/update',
  'bridge/hosted-web-search/end',
]

/**
 * Register the Bridge event family with the current DSH persistence catalog.
 *
 * DSH rc.7 exposes the catalog as a runtime Set but does not yet expose a
 * public third-party event registration method. Mutating this exported Set is
 * the narrow compatibility seam: the DSH session implementation and all
 * persistence backends remain untouched, while a Bridge-loaded runtime knows
 * that these log-only facts are safe to preserve. The Bridge Host must be
 * loaded before persisted sessions are resumed.
 */
export function registerHostedWebSearchSessionEvents(): void {
  const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
  for (const type of HOSTED_WEB_SEARCH_EVENT_TYPES) catalog.add(type)
}

/** Return the live session associated with the current Agent initiator, if any. */
export function currentInitiatorSession(ctx: Context): Session | undefined {
  try {
    return ctx.get('agents')?.currentInitiator()?.session
  } catch {
    // Agent service disposal can race a final provider callback. A missing
    // session only disables the auxiliary card; it must not break native text.
    return undefined
  }
}

/**
 * Locate the currently open DSH step. Hosted events are written from inside a
 * provider stream, after `step/start` and before `step/end`; scanning the
 * durable boundaries keeps turn/step placement deterministic on replay.
 */
export function activeTurnStep(session: Session): { turn: number; step: number } {
  let turn = 0
  let step = 0
  let stepOpen = false
  for (const event of session.events) {
    if (event.type === 'turn/start') {
      turn = event.data.turn
      step = 0
      stepOpen = false
    } else if (event.type === 'turn/end') {
      if (event.data.turn === turn) stepOpen = false
    } else if (event.type === 'step/start') {
      turn = event.data.turn
      step = event.data.step
      stepOpen = true
    } else if (event.type === 'step/end' && event.data.turn === turn && event.data.step === step) {
      stepOpen = false
    }
  }
  return { turn, step: stepOpen ? step : 0 }
}

/** Append one Bridge checkpoint without letting an auxiliary failure abort Pi. */
export function appendHostedWebSearchCheckpoint<T extends HostedWebSearchEventType>(
  session: Session | undefined,
  type: T,
  data: SessionEventMap[T],
): boolean {
  if (session === undefined) return false
  try {
    // The public Session.append conditional tuple cannot see that these
    // declaration-merged event types are all non-surface events while T is a
    // generic. Keep the cast at this compatibility boundary; the runtime
    // Session still validates the event catalog and JSON payload.
    const append = session.append as unknown as (eventType: HostedWebSearchEventType, eventData: HostedWebSearchState) => unknown
    append.call(session, type, data as HostedWebSearchState)
    return true
  } catch {
    // The remote response remains useful even if a host has no live persistence
    // carrier or is shutting down. The caller can continue native parsing.
    return false
  }
}

/** Type guard useful to tests and diagnostics without importing DSH internals. */
export function isHostedWebSearchState(value: unknown): value is HostedWebSearchState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return state.version === 1
    && typeof state.searchId === 'string'
    && typeof state.turn === 'number'
    && typeof state.step === 'number'
    && typeof state.provider === 'string'
    && typeof state.model === 'string'
    && typeof state.status === 'string'
    && Array.isArray(state.queries)
    && Array.isArray(state.sources)
    && Array.isArray(state.citations)
}
