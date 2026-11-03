import assert from 'node:assert/strict'
import test from 'node:test'
import { getResolution, isValidCell, latLngToCell } from 'h3-js'
import backendZones from './fixtures/backend-zones.json' with { type: 'json' }
import {
  createDemoForecast,
  forecastSourceLabel,
  forecastSourceNotice,
  normalizeForecastResponse,
  rankForecastZones,
} from '../src/services/forecast.ts'

// Exported from backend/data/mock_zones.py at c6ec2f6; shared with the live-mode E2E suite.
function serverResponse() {
  return {
    generatedAt: '2026-11-03T00:00:00+00:00',
    metric: 'hourly',
    horizon: 0,
    zones: structuredClone(Object.values(backendZones)),
  }
}

function validServerResponse() {
  const response = serverResponse()
  response.zones = response.zones.map((zone) => ({
    ...zone,
    h3Index: latLngToCell(zone.lat, zone.lng, 8),
  }))
  return response
}

test('the actual backend mock markers receive valid display geometry and explicit server-demo provenance', () => {
  const input = serverResponse()
  const original = structuredClone(input)
  const response = normalizeForecastResponse(input)
  assert.equal(response.provenance, 'server-demo')
  assert.deepEqual(
    response.zones.map((zone) => zone.h3Index),
    ['8830e1ca2bfffff', '8830e1cb5bfffff'],
  )
  for (const [index, zone] of response.zones.entries()) {
    assert.equal(zone.provenance, 'server-demo')
    assert.equal(zone.geometrySource, 'server-demo-coordinates')
    assert.equal(isValidCell(zone.h3Index), true)
    assert.equal(getResolution(zone.h3Index), 8)
    assert.equal(zone.id, original.zones[index].id)
    assert.equal(zone.lat, original.zones[index].lat)
    assert.equal(zone.lng, original.zones[index].lng)
    assert.deepEqual(zone.trend, original.zones[index].trend)
  }
  assert.deepEqual(input, original, 'normalization must not mutate backend values')
  assert.equal(forecastSourceLabel(response.provenance), '서버 예시 데이터')
  assert.match(
    forecastSourceNotice(response.provenance),
    /실제 수요·수익을 나타내지 않습니다/,
  )
})

test('backend time-series values, including future rankings, remain authoritative after adaptation', () => {
  const { zones } = normalizeForecastResponse(serverResponse())
  assert.equal(rankForecastZones(zones, 'hourly', 0)[0].id, 'gangnam')
  const after30 = rankForecastZones(zones, 'hourly', 30)
  assert.equal(after30[0].id, 'gyodae')
  assert.equal(after30[0].current.netHourly, 30000)
  assert.equal(after30[1].current.netHourly, 29000)
  assert.equal(rankForecastZones(zones, 'hourly', 60)[0].current.netHourly, 25000)
  assert.equal(rankForecastZones(zones, 'passengers', 60)[0].current.passengers, 6)
  assert.deepEqual(
    zones[0].trend.map((point) => point.minutes),
    [0, 30, 60],
  )
})

test('arbitrary invalid geometry is still rejected, even when labeled as demo', () => {
  const badZones = [
    { ...backendZones.gangnam, h3Index: 'not-a-cell' },
    { ...backendZones.gangnam, h3Index: 'mock-gyodae' },
    { ...backendZones.gangnam, id: 'other', h3Index: 'mock-other' },
    { ...backendZones.gangnam, h3Index: latLngToCell(37.4979, 127.0276, 7) },
    { ...backendZones.gangnam, h3Index: 'not-a-cell', demo: true },
  ]
  for (const zone of badZones) {
    assert.throws(
      () => normalizeForecastResponse({ ...serverResponse(), zones: [zone] }),
      /H3 구역/,
    )
  }
})

test('known markers do not bypass coordinate, temporal, or response validation', () => {
  const badZones = [
    { ...backendZones.gangnam, lat: 91 },
    { ...backendZones.gangnam, lng: Infinity },
    { ...backendZones.gangnam, lat: '37.4979' },
    { ...backendZones.gangnam, trend: backendZones.gangnam.trend.slice(0, 2) },
    {
      ...backendZones.gangnam,
      trend: [
        backendZones.gangnam.trend[0],
        backendZones.gangnam.trend[0],
        backendZones.gangnam.trend[2],
      ],
    },
    {
      ...backendZones.gangnam,
      trend: backendZones.gangnam.trend.map((point) => ({ ...point, fuelCost: -1 })),
    },
  ]
  for (const zone of badZones)
    assert.throws(() => normalizeForecastResponse({ ...serverResponse(), zones: [zone] }))
  for (const patch of [
    { metric: 'invalid' },
    { horizon: 15 },
    { generatedAt: 'invalid' },
  ]) {
    assert.throws(() => normalizeForecastResponse({ ...serverResponse(), ...patch }))
  }
})

test('a regular server response without source metadata is never presented as verified model output', () => {
  for (const metadata of [
    {},
    { source: 'unknown' },
    { source: 'live' },
    { demo: false },
  ]) {
    const response = normalizeForecastResponse({ ...validServerResponse(), ...metadata })
    assert.equal(response.provenance, 'server-unspecified')
    assert.ok(response.zones.every((zone) => zone.provenance === 'server-unspecified'))
    assert.ok(response.zones.every((zone) => zone.geometrySource === 'provided'))
    assert.match(forecastSourceLabel(response.provenance), /출처 미확인/)
  }
})

test('supported optional source declarations are reflected and zone declarations can form a mixed response', () => {
  const response = validServerResponse()
  assert.equal(
    normalizeForecastResponse({ ...response, source: 'model' }).provenance,
    'server-model',
  )
  assert.equal(
    normalizeForecastResponse({ ...response, demo: true }).provenance,
    'server-demo',
  )
  const mixed = normalizeForecastResponse({
    ...response,
    source: 'model',
    zones: [{ ...response.zones[0], source: 'mock' }, response.zones[1]],
  })
  assert.equal(mixed.provenance, 'mixed')
  assert.equal(mixed.zones[0].provenance, 'server-demo')
  assert.equal(mixed.zones[1].provenance, 'server-model')
  assert.match(forecastSourceLabel(mixed.provenance), /혼합/)
  assert.match(forecastSourceLabel(mixed.zones[1].provenance), /서버 표기/)
})

test('a known server example and an undeclared regular zone retain separate provenance', () => {
  const response = serverResponse()
  const second = response.zones[1]
  const mixed = normalizeForecastResponse({
    ...response,
    zones: [
      response.zones[0],
      { ...second, h3Index: latLngToCell(second.lat, second.lng, 8) },
    ],
  })
  assert.equal(mixed.provenance, 'mixed')
  assert.deepEqual(
    mixed.zones.map((zone) => zone.provenance),
    ['server-demo', 'server-unspecified'],
  )
})

test('malformed or contradictory optional metadata is rejected rather than hiding examples', () => {
  const invalidMetadata = [
    { source: 'trusted-ai' },
    { source: null },
    { source: { kind: 'model' } },
    { demo: 'false' },
    { demo: null },
    { source: 'mock', demo: false },
    { source: 'model', demo: true },
  ]
  for (const metadata of invalidMetadata) {
    assert.throws(
      () => normalizeForecastResponse({ ...validServerResponse(), ...metadata }),
      /출처 표시/,
    )
    const response = validServerResponse()
    assert.throws(
      () =>
        normalizeForecastResponse({
          ...response,
          zones: [{ ...response.zones[0], ...metadata }],
        }),
      /출처 표시/,
    )
  }
  assert.throws(
    () => normalizeForecastResponse({ ...serverResponse(), demo: false }),
    /서버 예시 구역/,
  )
  assert.throws(
    () => normalizeForecastResponse({ ...serverResponse(), source: 'model' }),
    /서버 예시 구역/,
  )
})

test('local demo transport remains distinct from server-delivered examples', () => {
  const local = normalizeForecastResponse(createDemoForecast('hourly', 0), 'local-demo')
  assert.equal(local.provenance, 'local-demo')
  assert.ok(local.zones.every((zone) => zone.provenance === 'local-demo'))
  assert.match(forecastSourceLabel(local.provenance), /로컬 데모/)
  assert.notEqual(
    local.provenance,
    normalizeForecastResponse(serverResponse()).provenance,
  )
})
