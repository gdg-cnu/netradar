import { useEffect, useState, useSyncExternalStore } from 'react'
import { createTrip, recommendRoute, sendTripEvent } from '../services/routes'
import { saveTrip } from '../services/history'
import { getStorageScope, readStored, writeStored } from '../utils/storage'
import { driveReducer, emptyDrive, isDriveState } from '../types/route'
import type { Coordinates, DriveAction, DriveState, RoutePlan } from '../types/route'

const storageKey = 'active-drive'
interface DriveSnapshot {
  state: DriveState
  pending: boolean
  error: string
  needsRecovery: boolean
}
interface PendingEvent {
  tripId: string
  revision: number
  eventId: string
  action: DriveAction
}
interface DriveStore {
  scope: string
  snapshot: DriveSnapshot
  retryWork: (() => Promise<boolean>) | null
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DriveSnapshot
  emit: () => void
}
// A shared store keeps in-flight mutations alive across page navigation.
// Each request retains its initiating account scope, including after logout.
const stores = new Map<string, DriveStore>()
function getStore(scope: string): DriveStore {
  const existing = stores.get(scope)
  if (existing) return existing
  const listeners = new Set<() => void>()
  const store: DriveStore = {
    scope,
    snapshot: {
      state: readStored<DriveState>(storageKey, { ...emptyDrive }, isDriveState, scope),
      pending: false,
      error: '',
      needsRecovery: false,
    },
    retryWork: null,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => store.snapshot,
    emit: () => listeners.forEach((listener) => listener()),
  }
  stores.set(scope, store)
  const interrupted = readStored<PendingEvent | null>(
    'pending-drive-event',
    null,
    (value) => {
      if (!value || typeof value !== 'object') return value === null
      const item = value as PendingEvent
      const state = store.snapshot.state
      if (
        item.tripId !== state.tripId ||
        item.revision !== state.revision ||
        !item.action ||
        typeof item.action !== 'object'
      )
        return false
      if (
        ![
          'ARRIVE',
          'PICK_UP',
          'DROP_OFF',
          'SKIP',
          'EXTEND_WAIT',
          'RECOMMEND',
          'FINISH',
        ].includes(item.action.type)
      )
        return false
      const candidate = driveReducer(state, item.action)
      return (
        candidate !== state &&
        isDriveState(candidate) &&
        item.eventId === `${state.tripId}:${state.revision + 1}:${item.action.type}`
      )
    },
    scope,
  )
  if (interrupted) {
    store.snapshot = {
      ...store.snapshot,
      needsRecovery: true,
      error:
        '이전 저장 요청의 완료 여부를 확인해야 해요. 같은 요청을 다시 보내 안전하게 확인해 주세요.',
    }
    store.retryWork = () => submitEvent(store, interrupted)
  }
  return store
}
function update(store: DriveStore, patch: Partial<DriveSnapshot>) {
  store.snapshot = { ...store.snapshot, ...patch }
  store.emit()
}
function tripDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function saveCompleted(state: DriveState, scope: string) {
  if (
    state.phase !== 'finished' ||
    !state.tripId ||
    !state.plan ||
    state.startedAt === null ||
    state.endedAt === null
  )
    return
  saveTrip(
    {
      id: state.tripId,
      date: tripDate(state.startedAt),
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      destination: state.plan.destination.name,
      stops: state.visitedStops,
      passengers: state.passengers,
      ...state.totals,
      demo: state.plan.demo,
    },
    scope,
  )
}
function commit(store: DriveStore, next: DriveState) {
  writeStored(storageKey, next, store.scope)
  update(store, { state: next })
  saveCompleted(next, store.scope)
}
async function run(store: DriveStore, work: () => Promise<boolean>): Promise<boolean> {
  if (store.snapshot.pending) return false
  update(store, { pending: true, error: '' })
  try {
    const success = await work()
    if (success) store.retryWork = null
    return success
  } catch (caught) {
    store.retryWork = work
    update(store, {
      error: caught instanceof Error ? caught.message : '운행 정보를 저장하지 못했어요.',
    })
    return false
  } finally {
    update(store, { pending: false })
  }
}
function ensureOwner(store: DriveStore) {
  if (getStorageScope() !== store.scope)
    throw new Error(
      '로그인 계정이 변경되었어요. 기존 계정으로 다시 로그인해 저장을 확인해 주세요.',
    )
}
async function submitEvent(store: DriveStore, envelope: PendingEvent): Promise<boolean> {
  ensureOwner(store)
  const before = store.snapshot.state
  if (before.revision !== envelope.revision) return false
  writeStored('pending-drive-event', envelope, store.scope)
  update(store, { needsRecovery: true })
  const response = await sendTripEvent(envelope.tripId, envelope.eventId, envelope.action)
  const action = envelope.action
  const confirmed =
    (action.type === 'DROP_OFF' || action.type === 'FINISH') && response.totals
      ? { ...action, totals: response.totals }
      : action
  // An accepted response must be saved even if its initiating view/account is no longer open.
  commit(store, driveReducer(before, confirmed))
  writeStored('pending-drive-event', null, store.scope)
  update(store, { needsRecovery: false })
  return true
}
async function perform(store: DriveStore, action: DriveAction): Promise<boolean> {
  if (store.snapshot.needsRecovery) return false
  const before = store.snapshot.state
  if (driveReducer(before, action) === before || !before.tripId) return false
  const eventId = `${before.tripId}:${before.revision + 1}:${action.type}`
  // The action and timestamp are frozen once, and reused by retries.
  return run(store, () =>
    submitEvent(store, {
      tripId: before.tripId!,
      revision: before.revision,
      eventId,
      action,
    }),
  )
}
async function start(store: DriveStore, plan: RoutePlan): Promise<boolean> {
  if (
    !['idle', 'finished'].includes(store.snapshot.state.phase) ||
    plan.stops.length === 0 ||
    store.snapshot.pending
  )
    return false
  const previousIntent = readStored<{ planId: string; key: string } | null>(
    'trip-start-intent',
    null,
    (value) =>
      value === null ||
      (!!value &&
        typeof value === 'object' &&
        typeof (value as { planId: unknown }).planId === 'string' &&
        typeof (value as { key: unknown }).key === 'string'),
    store.scope,
  )
  const intent =
    previousIntent?.planId === plan.id
      ? previousIntent
      : {
          planId: plan.id,
          key: `start-${plan.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }
  writeStored('trip-start-intent', intent, store.scope)
  return run(store, async () => {
    ensureOwner(store)
    const trip = await createTrip(plan, intent.key)
    commit(
      store,
      driveReducer(store.snapshot.state, {
        type: 'START',
        plan,
        tripId: trip.id,
        now: Date.now(),
      }),
    )
    writeStored('trip-start-intent', null, store.scope)
    return true
  })
}
async function reroute(store: DriveStore): Promise<boolean> {
  const before = store.snapshot.state
  if (
    store.snapshot.needsRecovery ||
    before.phase !== 'needs-route' ||
    !before.plan ||
    !before.location ||
    !before.tripId
  )
    return false
  // Prepare once. If the event request fails, retry the identical route and timestamp.
  let preparedAction: Extract<DriveAction, { type: 'RECOMMEND' }> | null = null
  const eventId = `${before.tripId}:${before.revision + 1}:RECOMMEND`
  return run(store, async () => {
    if (store.snapshot.state.revision !== before.revision) return false
    if (!preparedAction) {
      ensureOwner(store)
      const plan = await recommendRoute({
        origin: before.location!,
        destination: before.plan!.destination,
        detour: before.plan!.detour,
        excludeStopIds: [before.plan!.stops[before.stopIndex].id],
      })
      if (plan.stops.length === 0)
        throw new Error(
          '추천할 경유지가 없어요. 잠시 후 다시 시도하거나 운행을 종료해 주세요.',
        )
      preparedAction = { type: 'RECOMMEND', plan, now: Date.now() }
    }
    return submitEvent(store, {
      tripId: before.tripId!,
      revision: before.revision,
      eventId,
      action: preparedAction,
    })
  })
}

export function useDrive() {
  const store = getStore(getStorageScope())
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    // Recover the case where the tab closed after state persistence but before history was saved.
    saveCompleted(store.snapshot.state, store.scope)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [store])
  function reset() {
    if (store.snapshot.pending) return
    commit(store, driveReducer(store.snapshot.state, { type: 'RESET' }))
    store.retryWork = null
    update(store, { error: '' })
  }
  return {
    ...snapshot,
    now,
    reset,
    start: (plan: RoutePlan) => start(store, plan),
    reroute: () => reroute(store),
    retry: () => (store.retryWork ? run(store, store.retryWork) : Promise.resolve(false)),
    arrive: () => perform(store, { type: 'ARRIVE', now: Date.now() }),
    pickup: () => perform(store, { type: 'PICK_UP', now: Date.now() }),
    dropoff: (fare: number, location: Coordinates) =>
      perform(store, { type: 'DROP_OFF', now: Date.now(), fare, location }),
    skip: () => perform(store, { type: 'SKIP', now: Date.now() }),
    extendWait: () => perform(store, { type: 'EXTEND_WAIT', now: Date.now() }),
    finish: () => perform(store, { type: 'FINISH', now: Date.now() }),
  }
}
