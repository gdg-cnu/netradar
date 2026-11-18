import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDemandDriveAction,
  createDemandPlan,
  defaultDemandDraft,
  demandStorageKey,
  demandWaitSeconds,
  placeOrigin,
  readDemandDraft,
  readDemandDrive,
  readDemandTrips,
  saveDemandDraft,
  startDemandDrive,
  transitionDemandDrive,
} from '../src/v2/services/drive.ts'
import { createDemandSnapshot } from '../src/v2/services/demand.ts'
import { setStorageScope } from '../src/utils/storage.ts'
import type { DemandDriveState, DemandRouteDraft } from '../src/v2/types/drive.ts'

const now = Date.parse('2026-11-18T14:59:00Z')
const snapshot = createDemandSnapshot(now)
const gangnam = snapshot.places.find((place) => place.id === 'gangnam')!
const seoul = snapshot.places.find((place) => place.id === 'seoul-station')!
let entries: Map<string, string>
beforeEach(() => {
  entries = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value)
      },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  })
  setStorageScope('demo')
})
function draft(): DemandRouteDraft {
  return { ...defaultDemandDraft(), origin: placeOrigin(gangnam) }
}
function begin() {
  return startDemandDrive(createDemandPlan(draft(), snapshot), 'demo', now)
}
function act(
  state: DemandDriveState,
  action: Parameters<typeof applyDemandDriveAction>[2],
  at = now + 1000,
) {
  return applyDemandDriveAction(state.id, state.revision, action, 'demo', at)
}

test('V2 route requires explicit origin and optional destination; draft survives serialization', () => {
  assert.throws(() => createDemandPlan(defaultDemandDraft(), snapshot), /출발지/)
  const value = draft()
  const plan = createDemandPlan(value, snapshot)
  assert.equal(plan.destinationId, null)
  assert.equal(plan.destinationName, null)
  saveDemandDraft({ ...value, plan })
  assert.deepEqual(readDemandDraft(), { ...value, plan })
  assert.deepEqual(value, draft())
  const favorite = {
    id: 'favorite',
    name: '저장한 집',
    lat: 37.49,
    lng: 127.04,
    kind: 'place' as const,
  }
  const favoritePlan = createDemandPlan(
    { ...value, destination: favorite, destinationId: favorite.id },
    snapshot,
  )
  assert.deepEqual(favoritePlan.destination, favorite)
})

test('detour fixture limits to 1/2/3 unique stops and explicit map target stays first', () => {
  for (const [detour, count] of [
    [15, 1],
    [30, 2],
    [50, 3],
  ] as const) {
    const plan = createDemandPlan(
      { ...draft(), detour, targetPlaceId: 'hongdae' },
      snapshot,
    )
    assert.equal(plan.stops.length, count)
    assert.equal(new Set(plan.stops.map((stop) => stop.placeId)).size, count)
    assert.equal(plan.stops[0].placeId, 'hongdae')
  }
  assert.throws(
    () => createDemandPlan({ ...draft(), targetPlaceId: 'missing' }, snapshot),
    /선택한 장소/,
  )
})

test('ranking uses arrival-time fixture demand rather than current demand', () => {
  const fixture = structuredClone(snapshot)
  fixture.places = [
    {
      ...fixture.places[0],
      id: 'arriving-demand',
      lat: 37.6,
      lng: 127,
      points: [
        {
          offset: 0,
          surgeIndex: 10,
          population: 100,
          range: 'low',
          populationRange: 'low',
        },
        {
          offset: 30,
          surgeIndex: 80,
          population: 100,
          range: 'high',
          populationRange: 'low',
        },
        {
          offset: 60,
          surgeIndex: 10,
          population: 100,
          range: 'low',
          populationRange: 'low',
        },
      ],
    },
    {
      ...fixture.places[1],
      id: 'current-demand',
      lat: 37.59,
      lng: 127,
      points: [
        {
          offset: 0,
          surgeIndex: 90,
          population: 100,
          range: 'high',
          populationRange: 'low',
        },
        {
          offset: 30,
          surgeIndex: 30,
          population: 100,
          range: 'low',
          populationRange: 'low',
        },
        {
          offset: 60,
          surgeIndex: 10,
          population: 100,
          range: 'low',
          populationRange: 'low',
        },
      ],
    },
  ]
  const original = structuredClone(fixture)
  const plan = createDemandPlan(
    {
      ...draft(),
      detour: 15,
      origin: { id: 'origin', name: '직접 선택', lat: 37.5, lng: 127, kind: 'current' },
    },
    fixture,
  )
  assert.equal(plan.stops[0].placeId, 'arriving-demand')
  assert.equal(plan.stops[0].forecastOffset, 30)
  assert.equal(plan.stops[0].surgeIndexAtArrival, 80)
  assert.deepEqual(fixture, original)
  const distant = createDemandPlan(
    { ...draft(), targetPlaceId: 'incheon-t1', detour: 15 },
    snapshot,
  )
  assert.ok(distant.stops[0].arrivalMinutes > 60)
  assert.equal(distant.stops[0].surgeIndexAtArrival, null)
})

test('arrival deadline survives reload; duplicate event is ignored and extensions stop at two', () => {
  const initial = begin()
  let state = act(initial, { type: 'arrive' })
  assert.equal(state.waitUntil, now + 181000)
  assert.deepEqual(readDemandDrive(), state)
  assert.equal(demandWaitSeconds(readDemandDrive()!, now + 61000), 120)
  assert.equal(demandWaitSeconds(state, now + 200000), 0)
  const first = act(state, { type: 'extend' }, now + 200000)
  assert.equal(first.waitUntil, now + 320000)
  const duplicate = act(state, { type: 'extend' }, now + 200001)
  assert.equal(duplicate.waitExtensions, 1)
  state = act(first, { type: 'extend' }, now + 210000)
  assert.equal(state.waitUntil, now + 440000)
  assert.equal(state.waitExtensions, 2)
  assert.throws(() => act(state, { type: 'extend' }), /운행 상태/)
  assert.equal(readDemandDrive()!.waitExtensions, 2)
})

test('pickup prevents finishing; recorded fares stay distinct from omitted fares and survive rerouting', () => {
  let state = act(begin(), { type: 'arrive' })
  const before = structuredClone(state)
  state = act(state, { type: 'pickup' })
  assert.deepEqual(before.visits, [
    {
      placeId: before.plan.stops[0].placeId,
      name: before.plan.stops[0].name,
      arrivedAt: now + 1000,
      pickedUp: false,
      fare: 0,
      fareRecorded: false,
    },
  ])
  assert.throws(() => act(state, { type: 'finish' }), /하차/)
  for (const fare of [-1, 1.5, NaN, Infinity, 1_000_001]) {
    assert.throws(
      () => act(state, { type: 'dropoff', fare, location: placeOrigin(seoul) }),
      /요금/,
    )
  }
  state = act(state, { type: 'dropoff', fare: null, location: placeOrigin(seoul) })
  assert.equal(state.visits[0].fareRecorded, false)
  assert.equal(state.fare, 0)
  const plan = createDemandPlan({ ...draft(), origin: state.lastLocation }, snapshot)
  state = act(state, { type: 'reroute', plan })
  state = act(state, { type: 'arrive' })
  state = act(state, { type: 'pickup' })
  state = act(state, { type: 'dropoff', fare: 14000, location: placeOrigin(gangnam) })
  assert.equal(state.passengers, 2)
  assert.equal(state.fare, 14000)
  assert.equal(state.visits.filter((visit) => visit.fareRecorded).length, 1)
  const finished = act(state, { type: 'finish' }, now + 120000)
  assert.equal(finished.phase, 'finished')
  assert.equal(readDemandTrips()[0].fareRecordedCount, 1)
  assert.equal(readDemandTrips()[0].date, '2026-11-19')
})

test('skipping visits advances without invented pickup and completion is stored exactly once', () => {
  let state = begin()
  assert.throws(() => transitionDemandDrive(state, { type: 'pickup' }), /운행 상태/)
  state = act(state, { type: 'skip' })
  assert.equal(state.stopIndex, 1)
  state = act(state, { type: 'arrive' })
  state = act(state, { type: 'skip' })
  assert.equal(state.phase, 'next')
  assert.equal(state.passengers, 0)
  const finished = act(state, { type: 'finish' }, now + 120000)
  assert.deepEqual(act(state, { type: 'finish' }, now + 121000), finished)
  assert.deepEqual(act(finished, { type: 'finish' }, now + 122000), finished)
  assert.equal(readDemandTrips().length, 1)
  assert.deepEqual(readDemandTrips()[0].stopNames, [state.plan.stops[1].name])
  assert.equal(readDemandTrips()[0].durationMinutes, 2)
})

test('start is idempotent while active and each account uses an isolated V2 document without changing V1', () => {
  entries.set('netradar:v1:demo:trips', '[{"legacy":true}]')
  const initial = begin()
  const second = startDemandDrive(
    createDemandPlan({ ...draft(), detour: 50 }, snapshot),
    'demo',
    now + 1000,
  )
  assert.equal(second.id, initial.id)
  assert.equal(readDemandDrive('other-user'), null)
  assert.deepEqual(readDemandTrips('other-user'), [])
  act(initial, { type: 'finish' })
  assert.equal(readDemandTrips().length, 1)
  setStorageScope('other-user')
  assert.deepEqual(readDemandTrips(), [])
  assert.equal(readDemandDrive(), null)
  assert.equal(entries.get('netradar:v1:demo:trips'), '[{"legacy":true}]')
  assert.equal(entries.size, 2)
})

test('failed persistence cannot complete a drive or fabricate a completed trip', () => {
  const state = begin()
  const stored = entries.get(demandStorageKey())
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: () => {
        throw new Error('quota')
      },
    },
  })
  assert.throws(() => act(state, { type: 'finish' }), /저장할 수 없습니다/)
  assert.equal(entries.get(demandStorageKey()), stored)
  assert.equal(readDemandDrive()!.phase, 'travelling')
  assert.deepEqual(readDemandTrips(), [])
})

test('invalid schema and broken state are not resumed as an active drive', () => {
  const state = begin()
  entries.set(demandStorageKey(), JSON.stringify({ version: 1, drive: state, trips: [] }))
  assert.equal(readDemandDrive(), null)
  entries.set(
    demandStorageKey(),
    JSON.stringify({
      version: 2,
      drive: { ...state, stopIndex: 99 },
      trips: [{ source: 'mock' }],
    }),
  )
  assert.equal(readDemandDrive(), null)
  assert.deepEqual(readDemandTrips(), [])
  entries.set(demandStorageKey(), '{broken')
  assert.deepEqual(readDemandDraft(), defaultDemandDraft())
})
