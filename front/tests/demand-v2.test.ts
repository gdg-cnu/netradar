import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDemandAlerts,
  createDemandSnapshot,
  demandPoint,
  filterDemandEvents,
  getDemandSnapshot,
  kstDateKey,
} from '../src/v2/services/demand.ts'
import {
  readSurgeAlertsEnabled,
  saveSurgeAlertsEnabled,
} from '../src/v2/services/preferences.ts'
import { setStorageScope } from '../src/utils/storage.ts'

const noon = Date.parse('2026-11-18T12:00:00+09:00')

test('mock demand data has closed longitude-latitude place polygons and separate integer indices/population', () => {
  const snapshot = createDemandSnapshot(noon)
  assert.equal(snapshot.source, 'mock')
  assert.equal(
    snapshot.places.length,
    new Set(snapshot.places.map((place) => place.id)).size,
  )
  for (const place of snapshot.places) {
    assert.deepEqual(place.polygon[0], place.polygon.at(-1))
    assert.ok(
      place.polygon.every(([lng, lat]) => lng > 126 && lng < 128 && lat > 37 && lat < 38),
    )
    for (const offset of [0, 30, 60] as const) {
      const point = demandPoint(place, offset)
      assert.ok(
        Number.isInteger(point.surgeIndex) &&
          point.surgeIndex >= 0 &&
          point.surgeIndex <= 100,
      )
      assert.ok(Number.isInteger(point.population) && point.population > 100)
      assert.ok(['low', 'moderate', 'high'].includes(point.range))
    }
  }
  assert.notDeepEqual(
    snapshot.places.map((p) => demandPoint(p, 0)),
    snapshot.places.map((p) => demandPoint(p, 60)),
  )
})

test('event filters combine Korea date, remaining events, event type and map bounds without mutating the snapshot', () => {
  const snapshot = createDemandSnapshot(noon)
  const original = structuredClone(snapshot)
  const events = filterDemandEvents(snapshot, {
    now: noon,
    type: 'concert',
    bounds: { west: 127.1, south: 37.5, east: 127.2, north: 37.6 },
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].placeId, 'olympic-hall')
  assert.equal(
    filterDemandEvents(snapshot, { now: noon + 91 * 60 * 1000, type: 'concert' }).length,
    0,
  )
  assert.equal(
    filterDemandEvents(snapshot, {
      now: noon,
      bounds: { west: 128, south: 36, east: 129, north: 37 },
    }).length,
    0,
  )
  assert.equal(
    filterDemandEvents(snapshot, { now: Date.parse('2026-11-19T00:00:00+09:00') }).length,
    0,
  )
  assert.equal(kstDateKey('2026-11-18T15:00:00Z'), '2026-11-19')
  assert.deepEqual(snapshot, original)
})

test('alerts use travel time from the selected origin, cap at three and exclude peaks that cannot be reached', () => {
  const snapshot = createDemandSnapshot(noon)
  assert.ok(snapshot.alerts.length > 0 && snapshot.alerts.length <= 3)
  for (const alert of snapshot.alerts) {
    assert.equal(Date.parse(alert.arrivalAt), noon + alert.travelMinutes * 60_000)
    assert.ok(Date.parse(alert.arrivalAt) <= Date.parse(alert.peakEnd))
    assert.ok(Date.parse(alert.recommendedDepartureAt) >= noon)
    assert.ok(Date.parse(alert.peakStart) <= noon + 60 * 60_000)
  }
  const venue = snapshot.places.find((p) => p.id === 'olympic-hall')!
  const local = createDemandAlerts(snapshot, venue).find((a) => a.placeId === venue.id)!
  assert.equal(local.travelMinutes, 5)
  assert.ok(snapshot.alerts.every((a) => a.surgeIndexAtArrival <= 100))
  const remoteAlerts = createDemandAlerts(snapshot, { lat: 37.4486, lng: 126.76 })
  assert.ok(remoteAlerts.every((alert) => alert.travelMinutes <= 60))
})

test('Gimpo and Seoul Station retain their population places but never generate flight/train events or alerts', () => {
  for (const now of [noon, Date.parse('2026-11-18T23:15:00+09:00')]) {
    const snapshot = createDemandSnapshot(now)
    const expected = [
      {
        id: 'gimpo',
        name: '김포공항',
        lat: 37.558,
        lng: 126.802,
        population: [1800, 3200, 2200],
      },
      {
        id: 'seoul-station',
        name: '서울역',
        lat: 37.5547,
        lng: 126.9706,
        population: [4300, 3600, 2700],
      },
    ]
    assert.equal(snapshot.places.length, 6)
    for (const original of expected) {
      const place = snapshot.places.find((item) => item.id === original.id)!
      assert.equal(place.name, original.name)
      assert.equal(place.type, 'seoul_rtd')
      assert.equal(place.lat, original.lat)
      assert.equal(place.lng, original.lng)
      assert.deepEqual(
        place.points.map((point) => point.population),
        original.population,
      )
      assert.ok(
        place.reasons.every((reason) => !/국내선|항공편|열차|하차 인원/.test(reason)),
      )
      assert.ok(place.reasons.some((reason) => reason.includes('인구')))
    }
    assert.deepEqual(
      snapshot.events.map((event) => event.placeId),
      ['incheon-t1', 'olympic-hall', 'hongdae', 'gangnam'],
    )
    assert.deepEqual(
      new Set(snapshot.events.map((event) => event.type)),
      new Set(['airport', 'concert', 'last_train']),
    )
    for (const origin of snapshot.places) {
      const alerts = createDemandAlerts(snapshot, origin)
      assert.ok(
        alerts.every((alert) => !['gimpo', 'seoul-station'].includes(alert.placeId)),
      )
      assert.ok(alerts.every((alert) => !/국내선|열차 도착/.test(alert.reason)))
    }
  }
})

test('mock reads honor cancellation before and during the pending load', async () => {
  const before = new AbortController()
  before.abort()
  await assert.rejects(getDemandSnapshot({ signal: before.signal }), {
    name: 'AbortError',
  })
  const during = new AbortController()
  const promise = getDemandSnapshot({ signal: during.signal })
  during.abort()
  await assert.rejects(promise, { name: 'AbortError' })
})

test('v2 alert preferences stay account scoped and preserve v1 records; unavailable storage never reports a successful save', () => {
  const values = new Map<string, string>([['netradar:v1:alice:trips', 'legacy-records']])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  })
  setStorageScope('alice')
  assert.equal(saveSurgeAlertsEnabled(false), true)
  assert.equal(readSurgeAlertsEnabled(), false)
  setStorageScope('bob')
  assert.equal(readSurgeAlertsEnabled(), true)
  assert.equal(values.get('netradar:v1:alice:trips'), 'legacy-records')
  values.set('netradar:v2:bob:preferences', 'broken')
  assert.equal(readSurgeAlertsEnabled(), true)
  storage.setItem = () => {
    throw new Error('quota exceeded')
  }
  assert.equal(saveSurgeAlertsEnabled(false), false)
  assert.equal(readSurgeAlertsEnabled(), true)
  setStorageScope('demo')
})
