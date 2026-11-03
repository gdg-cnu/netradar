import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DETOUR_OPTIONS,
  isRoutePath,
  isRoutePlan,
  type RoutePlan,
  type RouteRequest,
} from '../src/types/route.ts'
import {
  placeSearchEmptyMessage,
  placeSearchNotice,
  recommendRoute,
  routeEstimateNotice,
  searchPlaces,
} from '../src/services/routes.ts'

const request: RouteRequest = {
  origin: { lat: 37.4979, lng: 127.0276 },
  destination: {
    id: 'jamsil',
    name: '잠실역',
    address: '서울 송파구',
    lat: 37.5133,
    lng: 127.1002,
  },
  detour: 'much',
}
const plan: RoutePlan = {
  ...request,
  id: 'route-geometry',
  generatedAt: 1000,
  demo: false,
  direct: { minutes: 20, kilometers: 8, earnings: 0 },
  recommended: { minutes: 27, kilometers: 10, earnings: 3200 },
  stops: [],
  directPath: [
    [37.4979, 127.0276],
    [37.5001, 127.0501],
    [37.5133, 127.1002],
  ],
  recommendedPath: [
    [37.4979, 127.0276],
    [37.5045, 127.0251],
    [37.5133, 127.1002],
  ],
}

test('route response accepts latitude-longitude paths while retaining legacy and missing-geometry support', () => {
  assert.equal(isRoutePlan(plan), true)
  assert.equal(isRoutePlan({ ...plan, directPath: [], recommendedPath: [] }), true)
  const { directPath: _direct, recommendedPath: _recommended, ...legacy } = plan
  assert.equal(isRoutePlan(legacy), true)
  assert.equal(isRoutePlan({ ...plan, recommendedPath: [] }), true)
})

test('malformed, reversed, and nonfinite route geometry is rejected before map rendering', () => {
  for (const path of [
    null,
    'line',
    [[37.5, 127]],
    [
      [127, 37.5],
      [127.1, 37.6],
    ],
    [
      [37.5, 127],
      [NaN, 127],
    ],
    [
      [37.5, 127],
      [37.6, Infinity],
    ],
    [
      [37.5, 127],
      [37.6, 127, 1],
    ],
    [[37.5, 127], null],
  ]) {
    assert.equal(isRoutePath(path), false)
    assert.equal(isRoutePlan({ ...plan, directPath: path }), false)
    assert.equal(isRoutePlan({ ...plan, recommendedPath: path }), false)
  }
})

test('much detour and demo metrics use the backend 50 percent limit without inventing road geometry', async () => {
  assert.deepEqual(
    DETOUR_OPTIONS.map((option) => option.percent),
    [15, 30, 50],
  )
  const demo = await recommendRoute(request)
  assert.equal(demo.demo, true)
  assert.equal(demo.recommended.minutes, Math.round(demo.direct.minutes * 1.5))
  assert.equal(demo.stops.length, 3)
  assert.equal(demo.directPath, undefined)
  assert.equal(demo.recommendedPath, undefined)
})

test('source notices distinguish verified sample fixtures from unknown APIs', () => {
  assert.match(placeSearchNotice('sample'), /강남역·교대역·신논현역·잠실역 4곳/)
  assert.match(placeSearchEmptyMessage('sample'), /샘플 장소 4곳/)
  assert.doesNotMatch(placeSearchNotice('unknown'), /샘플|데모|실시간/)
  assert.doesNotMatch(placeSearchEmptyMessage('unknown'), /샘플|데모/)
  assert.match(routeEstimateNotice(false, 'sample'), /예시 추정값/)
  assert.match(routeEstimateNotice(false, 'unknown'), /확인되지 않았/)
  assert.match(routeEstimateNotice(true, 'unknown'), /시뮬레이션/)
})

test('place and recommendation requests honor cancellation', async () => {
  const controller = new AbortController()
  const searching = searchPlaces('강남', controller.signal)
  controller.abort()
  await assert.rejects(
    searching,
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
  await assert.rejects(
    recommendRoute(request, controller.signal),
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
})
