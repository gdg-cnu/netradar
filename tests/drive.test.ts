import test from 'node:test'
import assert from 'node:assert/strict'
import {
  driveReducer,
  emptyDrive,
  isDriveState,
  isTripEventResponse,
} from '../src/types/route.ts'
import type { RoutePlan } from '../src/types/route.ts'

const plan: RoutePlan = {
  id: 'route-1',
  generatedAt: 1000,
  demo: true,
  origin: { lat: 37.5, lng: 127 },
  destination: { id: 'end', name: '목적지', address: '서울', lat: 37.6, lng: 127.1 },
  detour: 'normal',
  direct: { minutes: 10, kilometers: 3, earnings: 3000 },
  recommended: { minutes: 13, kilometers: 4, earnings: 5000 },
  stops: [
    {
      id: 'stop',
      name: '경유지',
      address: '서울',
      lat: 37.52,
      lng: 127.02,
      waitMinutes: 2,
      expectedHourlyRate: 30000,
    },
  ],
}
const start = () =>
  driveReducer(emptyDrive, { type: 'START', tripId: 'trip-1', plan, now: 1000 })
test('invalid and duplicate transitions do not change an active drive', () => {
  const s = start()
  assert.equal(driveReducer(s, { type: 'START', tripId: 'trip-2', plan, now: 2000 }), s)
  assert.equal(driveReducer(s, { type: 'PICK_UP', now: 2000 }), s)
  const arrived = driveReducer(s, { type: 'ARRIVE', now: 2000 })
  assert.equal(driveReducer(arrived, { type: 'ARRIVE', now: 3000 }), arrived)
  assert.equal(arrived.visitedStops, 1)
})
test('wait deadline survives serialization and extensions are bounded', () => {
  const arrived = driveReducer(start(), { type: 'ARRIVE', now: 2000 })
  const restored = JSON.parse(JSON.stringify(arrived))
  assert.equal(isDriveState(restored), true)
  assert.equal(restored.waitUntil, 122000)
  const once = driveReducer(restored, { type: 'EXTEND_WAIT', now: 130000 })
  assert.equal(once.waitUntil, 250000)
  const twice = driveReducer(once, { type: 'EXTEND_WAIT', now: 131000 })
  assert.equal(driveReducer(twice, { type: 'EXTEND_WAIT', now: 132000 }), twice)
})
test('pickup → dropoff → recommendation → completion preserves totals and prevents passenger abandonment', () => {
  let s = driveReducer(start(), { type: 'ARRIVE', now: 2000 })
  s = driveReducer(s, { type: 'PICK_UP', now: 3000 })
  assert.equal(driveReducer(s, { type: 'PICK_UP', now: 3100 }), s)
  assert.equal(driveReducer(s, { type: 'FINISH', now: 3200 }), s)
  s = driveReducer(s, {
    type: 'DROP_OFF',
    fare: 14000,
    location: { lat: 37.53, lng: 127.03 },
    now: 4000,
  })
  assert.equal(s.phase, 'needs-route')
  assert.equal(s.totals.revenue, 14000)
  assert.equal(s.passengers, 1)
  assert.equal(
    driveReducer(s, {
      type: 'DROP_OFF',
      fare: 14000,
      location: { lat: 37.53, lng: 127.03 },
      now: 4100,
    }),
    s,
  )
  s = driveReducer(s, { type: 'RECOMMEND', plan: { ...plan, id: 'route-2' }, now: 5000 })
  assert.equal(s.phase, 'travelling')
  assert.equal(s.totals.revenue, 14000)
  s = driveReducer(s, { type: 'FINISH', now: 6000 })
  assert.equal(s.phase, 'finished')
  assert.equal(s.endedAt, 6000)
  assert.equal(isDriveState(s), true)
  assert.equal(driveReducer(s, { type: 'FINISH', now: 7000 }), s)
})
test('skip leads to a new recommendation and corrupted persistence is rejected', () => {
  const s = driveReducer(start(), { type: 'SKIP', now: 2000 })
  assert.equal(s.phase, 'needs-route')
  assert.equal(s.passengers, 0)
  assert.equal(isDriveState({ ...s, plan: { ...plan, stops: [] } }), false)
  assert.equal(isDriveState({ ...s, location: { lat: 999, lng: 0 } }), false)
  assert.equal(isDriveState({ ...s, revision: -1 }), false)
})

test('live accounting requires all totals and accepts a legitimate negative extra profit', () => {
  assert.equal(isTripEventResponse({ accepted: true }, true), false)
  assert.equal(isTripEventResponse({ accepted: true, totals: {} }, true), false)
  assert.equal(
    isTripEventResponse({ accepted: true, totals: { revenue: 10000, cost: 3000 } }, true),
    false,
  )
  assert.equal(
    isTripEventResponse(
      { accepted: true, totals: { revenue: 10000, cost: 3000, extraProfit: -1200 } },
      true,
    ),
    true,
  )
  assert.equal(
    isTripEventResponse(
      { accepted: true, totals: { revenue: 10000, cost: -1, extraProfit: 0 } },
      true,
    ),
    false,
  )
  assert.equal(isTripEventResponse({ accepted: true }, false), true)
})
