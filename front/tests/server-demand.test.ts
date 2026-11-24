import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createServerDemandClient,
  isServerAlertsResponse,
  isServerConfig,
  isServerEventsResponse,
  isServerHeatmapResponse,
  isServerPlaceDetail,
  SERVER_DEMAND_TIMEOUT_MS,
  ServerDemandError,
} from '../src/v2/services/serverDemand.ts'
import type {
  ServerAlertsResponse,
  ServerConfig,
  ServerEventsResponse,
  ServerHeatmapPlace,
  ServerHeatmapResponse,
  ServerPlaceDetail,
} from '../src/v2/types/serverDemand.ts'

const generatedAt = '2026-11-20T12:00:00+09:00'
const metadata = { generatedAt, source: 'mock' as const }
const config: ServerConfig = {
  detourRatios: { little: 15, normal: 30, much: 50 },
  offsets: [0, 30, 60],
  maxStops: 3,
}
const place: ServerHeatmapPlace = {
  id: 'incheon-t1',
  name: '인천공항 T1',
  type: 'airport',
  lat: 37.4486,
  lng: 126.4512,
  polygon: [
    [126.44, 37.44],
    [126.46, 37.44],
    [126.46, 37.46],
    [126.44, 37.44],
  ],
  points: [0, 30, 60].map((offset) => ({
    offset: offset as 0 | 30 | 60,
    surgeIndex: 70,
    population: null,
    range: 'high',
    populationRange: null,
  })),
}
const heatmap: ServerHeatmapResponse = {
  ...metadata,
  metric: 'surge',
  offset: 0,
  places: [place],
}
const events: ServerEventsResponse = {
  ...metadata,
  events: [
    {
      id: 'last-train',
      placeId: place.id,
      type: 'last_train',
      title: '막차 이동 예시',
      peakAt: '2026-11-20T12:30:00+09:00',
      endsAt: '2026-11-20T13:00:00+09:00',
      expectedExits: null,
      source: '서버의 이벤트 출처 설명',
    },
  ],
}
const detail: ServerPlaceDetail = {
  ...place,
  ...metadata,
  reasons: ['시간대와 이벤트를 반영한 예시'],
  taxiStands: [{ name: '승차장', description: '운영 정보 확인 필요' }],
  events: events.events,
}
const alerts: ServerAlertsResponse = {
  ...metadata,
  alerts: [
    {
      id: 'alert-last-train',
      placeId: place.id,
      reason: '이동 예시',
      travelMinutes: 20,
      recommendedDepartureAt: '2026-11-20T12:10:00+09:00',
      arrivalAt: '2026-11-20T12:20:00+09:00',
      peakStart: '2026-11-20T12:30:00+09:00',
      peakEnd: '2026-11-20T13:00:00+09:00',
      surgeIndexAtArrival: 70,
    },
  ],
}

test('server DTOs preserve mock/model provenance, null measurements and real zero measurements', () => {
  for (const source of ['mock', 'model'] as const) {
    const data = structuredClone({ ...heatmap, source })
    assert.equal(isServerHeatmapResponse(data), true)
    assert.equal(data.places[0].points[0].population, null)
    data.places[0].type = 'seoul_rtd'
    data.places[0].points[0] = {
      offset: 0,
      surgeIndex: 0,
      population: 0,
      range: 'low',
      populationRange: 'low',
    }
    assert.equal(isServerHeatmapResponse(data), true)
    assert.equal(isServerEventsResponse({ ...events, source }), true)
    assert.equal(isServerPlaceDetail({ ...detail, source, type: 'venue' }), true)
    assert.equal(isServerAlertsResponse({ ...alerts, source }), true)
  }
  assert.equal(isServerHeatmapResponse({ ...heatmap, places: [] }), true)
  assert.equal(isServerEventsResponse({ ...events, events: [] }), true)
  assert.equal(isServerAlertsResponse({ ...alerts, alerts: [] }), true)
  assert.equal(
    isServerPlaceDetail({ ...detail, reasons: [], taxiStands: [], events: [] }),
    true,
  )
  assert.equal(isServerConfig(config), true)
})

test('missing source or measurements and incompatible client-only place/event types are rejected', () => {
  for (const source of [undefined, null, 'live', 'demo', 'unknown']) {
    assert.equal(isServerHeatmapResponse({ ...heatmap, source }), false)
    assert.equal(isServerEventsResponse({ ...events, source }), false)
    assert.equal(isServerAlertsResponse({ ...alerts, source }), false)
    assert.equal(isServerPlaceDetail({ ...detail, source }), false)
  }
  for (const type of ['concert', 'train', 'last_train', undefined])
    assert.equal(
      isServerHeatmapResponse({ ...heatmap, places: [{ ...place, type }] }),
      false,
    )
  assert.equal(
    isServerEventsResponse({
      ...events,
      events: [{ ...events.events[0], type: 'train' }],
    }),
    false,
  )
  for (const patch of [
    { population: undefined },
    { populationRange: undefined },
    { population: null, populationRange: 'low' },
    { population: 0, populationRange: null },
    { population: -1, populationRange: 'low' },
    { population: 1.5, populationRange: 'low' },
    { surgeIndex: 101 },
    { surgeIndex: -1 },
    { surgeIndex: 1.5 },
    { surgeIndex: Number.NaN },
    { range: null },
    { offset: 15 },
  ])
    assert.equal(
      isServerHeatmapResponse({
        ...heatmap,
        places: [
          {
            ...place,
            points: [{ ...place.points[0], ...patch }, ...place.points.slice(1)],
          },
        ],
      }),
      false,
      JSON.stringify(patch),
    )
  assert.equal(
    isServerEventsResponse({
      ...events,
      events: [{ ...events.events[0], expectedExits: undefined }],
    }),
    false,
  )
  assert.equal(
    isServerEventsResponse({
      ...events,
      events: [{ ...events.events[0], expectedExits: -1 }],
    }),
    false,
  )
  assert.equal(
    isServerEventsResponse({
      ...events,
      events: [{ ...events.events[0], expectedExits: 0 }],
    }),
    true,
  )
})

test('heatmaps reject repeated or missing horizons, malformed coordinates/rings and duplicate IDs', () => {
  for (const points of [
    place.points.slice(1),
    [place.points[0], place.points[0], place.points[2]],
    [...place.points, place.points[0]],
  ])
    assert.equal(
      isServerHeatmapResponse({ ...heatmap, places: [{ ...place, points }] }),
      false,
    )
  for (const polygon of [
    place.polygon.slice(0, -1),
    [
      [37.44, 126.44],
      [37.44, 126.46],
      [37.46, 126.46],
      [37.44, 126.44],
    ],
    [
      [126, 37],
      [127, 38],
      [128, 39],
      [126, 37],
    ],
    [
      [126, 37],
      [126, 37],
      [126, 37],
      [126, 37],
    ],
    [
      [126, 37],
      [Infinity, 37],
      [127, 38],
      [126, 37],
    ],
  ])
    assert.equal(
      isServerHeatmapResponse({ ...heatmap, places: [{ ...place, polygon }] }),
      false,
    )
  for (const patch of [
    { lat: 126 },
    { lng: -181 },
    { lat: Number.NaN },
    { id: '' },
    { id: ' spaced ' },
  ])
    assert.equal(
      isServerHeatmapResponse({ ...heatmap, places: [{ ...place, ...patch }] }),
      false,
    )
  assert.equal(isServerHeatmapResponse({ ...heatmap, places: [place, place] }), false)
})

test('timestamps require a valid timezone, and detail events must belong to the selected place', () => {
  for (const badDate of [
    undefined,
    '',
    'invalid',
    '2026-11-20T12:00:00',
    '2026-02-30T12:00:00+09:00',
  ]) {
    assert.equal(isServerHeatmapResponse({ ...heatmap, generatedAt: badDate }), false)
    assert.equal(
      isServerEventsResponse({
        ...events,
        events: [{ ...events.events[0], peakAt: badDate }],
      }),
      false,
    )
  }
  assert.equal(
    isServerEventsResponse({
      ...events,
      events: [{ ...events.events[0], endsAt: '2026-11-20T12:29:59+09:00' }],
    }),
    false,
  )
  assert.equal(
    isServerPlaceDetail({
      ...detail,
      events: [{ ...events.events[0], placeId: 'other-place' }],
    }),
    false,
  )
  assert.equal(
    isServerPlaceDetail({ ...detail, events: [events.events[0], events.events[0]] }),
    false,
  )
  assert.equal(isServerPlaceDetail({ ...detail, reasons: undefined }), false)
})

test('alerts distinguish recommended departure from immediate departure, and reject out-of-window forecasts', () => {
  assert.equal(isServerAlertsResponse(alerts), true)
  for (const patch of [
    { travelMinutes: 61 },
    { travelMinutes: -1 },
    { surgeIndexAtArrival: 101 },
    { arrivalAt: '2026-11-20T12:30:00+09:00' },
    { recommendedDepartureAt: '2026-11-20T11:59:59+09:00' },
    { peakStart: '2026-11-20T13:00:01+09:00', peakEnd: '2026-11-20T13:30:00+09:00' },
    { peakEnd: '2026-11-20T12:19:00+09:00' },
  ])
    assert.equal(
      isServerAlertsResponse({ ...alerts, alerts: [{ ...alerts.alerts[0], ...patch }] }),
      false,
    )
  assert.equal(
    isServerAlertsResponse({ ...alerts, alerts: [alerts.alerts[0], alerts.alerts[0]] }),
    false,
  )
  for (const patch of [
    { offsets: [0, 30, 30] },
    { offsets: [0, 15, 60] },
    { maxStops: 0 },
    { detourRatios: { little: 30, normal: 15, much: 50 } },
  ])
    assert.equal(isServerConfig({ ...config, ...patch }), false)
})

test('backend second-precision KST generation and arrival stay consistent across timezone representations', () => {
  // services/clock.py serializes generatedAt and arrivalAt with timespec="seconds".
  const response = structuredClone(alerts)
  response.alerts[0].arrivalAt = '2026-11-20T03:20:00Z'
  assert.equal(isServerAlertsResponse(response), true)
  response.alerts[0].arrivalAt = '2026-11-20T03:20:01Z'
  assert.equal(isServerAlertsResponse(response), false)
  response.alerts[0].arrivalAt = '2026-11-20T03:19:59Z'
  assert.equal(isServerAlertsResponse(response), false)
  // A syntactically valid future timestamp remains usable; freshness is a separate concern.
  const future = new Date(Date.now() + 86_400_000).toISOString()
  assert.equal(isServerHeatmapResponse({ ...heatmap, generatedAt: future }), true)
  assert.equal(isServerEventsResponse({ ...events, generatedAt: future }), true)
})

test('all five public GET endpoints encode parameters and never send credentials or a bearer token', async () => {
  const requests: { url: URL; init: RequestInit }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push({ url, init: init! })
    const payload = url.pathname.endsWith('/heatmap')
      ? { ...heatmap, metric: 'population', offset: 30 }
      : url.pathname.includes('/places/')
        ? { ...detail, id: '공항 & T1', events: [] }
        : url.pathname.endsWith('/events')
          ? events
          : url.pathname.endsWith('/alerts/top')
            ? alerts
            : config
    return Response.json(payload)
  }
  const client = createServerDemandClient({
    baseUrl: 'https://api.example.test/api/v1/',
    fetcher,
  })
  const bounds = { west: 126.4, south: 37.2, east: 127.5, north: 37.7 }
  const data = await client.getServerHeatmap({ metric: 'population', offset: 30, bounds })
  await client.getServerPlaceDetail('공항 & T1')
  await client.getServerEvents({
    type: 'concert',
    bounds,
    from: generatedAt,
    to: '2026-11-21T00:00:00+09:00',
  })
  await client.getServerAlerts({ lat: 37.5, lng: 127 })
  await client.getServerConfig()
  assert.equal(data.source, 'mock')
  assert.equal(data.places[0].points[0].population, null)
  assert.equal(requests[0].url.pathname, '/api/v1/heatmap')
  assert.equal(requests[0].url.searchParams.get('bbox'), '126.4,37.2,127.5,37.7')
  assert.equal(requests[0].url.searchParams.get('offset'), '30')
  assert.equal(requests[0].url.searchParams.get('metric'), 'population')
  assert.equal(
    requests[1].url.pathname,
    `/api/v1/places/${encodeURIComponent('공항 & T1')}`,
  )
  assert.equal(requests[2].url.searchParams.get('from'), generatedAt)
  assert.equal(requests[2].url.searchParams.get('to'), '2026-11-21T00:00:00+09:00')
  assert.equal(requests[2].url.searchParams.get('type'), 'concert')
  assert.equal(requests[3].url.pathname, '/api/v1/alerts/top')
  assert.equal(requests[3].url.searchParams.get('lat'), '37.5')
  assert.equal(requests[3].url.searchParams.get('lng'), '127')
  assert.equal(requests[4].url.pathname, '/api/v1/config')
  for (const { init } of requests) {
    assert.equal(init.method, 'GET')
    assert.equal(init.credentials, 'omit')
    assert.equal(new Headers(init.headers).get('Accept'), 'application/json')
    assert.equal(new Headers(init.headers).has('Authorization'), false)
  }
})

test('invalid request parameters/configuration fail before fetching, and response identity must match the request', async () => {
  let requests = 0
  const fetcher: typeof fetch = async () => {
    requests += 1
    return Response.json(heatmap)
  }
  const client = createServerDemandClient({
    baseUrl: 'https://api.example.test/api/v1',
    fetcher,
  })
  await assert.rejects(
    client.getServerHeatmap({
      metric: 'surge',
      offset: 0,
      bounds: { west: 127, east: 126, north: 38, south: 37 },
    }),
    { kind: 'request' },
  )
  await assert.rejects(client.getServerAlerts({ lat: NaN, lng: 127 }), {
    kind: 'request',
  })
  await assert.rejects(client.getServerPlaceDetail(' '), { kind: 'request' })
  await assert.rejects(client.getServerEvents({ from: '2026-11-20T12:00:00' }), {
    kind: 'request',
  })
  await assert.rejects(client.getServerEvents({ from: generatedAt, to: generatedAt }), {
    kind: 'request',
  })
  for (const baseUrl of [
    '',
    'file:///private/api',
    'https://user:secret@example.test/api',
  ])
    await assert.rejects(
      createServerDemandClient({ baseUrl, fetcher }).getServerConfig(),
      { kind: 'configuration' },
    )
  assert.equal(requests, 0)
  await assert.rejects(client.getServerHeatmap({ metric: 'population', offset: 0 }), {
    kind: 'response',
  })
  const wrongDetail = createServerDemandClient({
    baseUrl: 'https://api.example.test/api/v1',
    fetcher: async () => Response.json(detail),
  })
  await assert.rejects(wrongDetail.getServerPlaceDetail('other-place'), {
    kind: 'response',
  })
})

test('HTTP failures, broken JSON, malformed data and network failures remain failures without fallback', async () => {
  for (const status of [401, 404, 422, 500, 501]) {
    const client = createServerDemandClient({
      baseUrl: 'https://api.example.test',
      fetcher: async () => new Response('private server detail', { status }),
    })
    await assert.rejects(
      client.getServerConfig(),
      (error) =>
        error instanceof ServerDemandError &&
        error.kind === 'http' &&
        error.status === status &&
        !error.message.includes('private'),
    )
  }
  for (const response of [
    new Response('<html>failure</html>'),
    Response.json({ ...config, offsets: [0, 15] }),
  ]) {
    const client = createServerDemandClient({
      baseUrl: 'https://api.example.test',
      fetcher: async () => response,
    })
    await assert.rejects(client.getServerConfig(), { kind: 'response' })
  }
  const client = createServerDemandClient({
    baseUrl: 'https://api.example.test',
    fetcher: async () => {
      throw new TypeError('offline')
    },
  })
  await assert.rejects(client.getServerConfig(), { kind: 'network' })
})

test('pre-aborted and pending requests abort without an HTTP error or leftover caller listener', async (t) => {
  let requests = 0
  const fetcher: typeof fetch = async (_url, init) => {
    requests += 1
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    )
  }
  const client = createServerDemandClient({
    baseUrl: 'https://api.example.test',
    fetcher,
  })
  const before = new AbortController()
  before.abort()
  await assert.rejects(client.getServerConfig(before.signal), { name: 'AbortError' })
  assert.equal(requests, 0)
  const pending = new AbortController()
  const removed = t.mock.method(pending.signal, 'removeEventListener')
  const request = client.getServerEvents({ signal: pending.signal })
  pending.abort()
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(removed.mock.callCount(), 1)
})

test('the public client times out at 12 seconds and clears its timer after success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requestSignal: AbortSignal | null | undefined
  const hanging: typeof fetch = async (_url, init) => {
    requestSignal = init?.signal
    return new Promise<Response>((_resolve, reject) =>
      requestSignal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    )
  }
  const timeoutClient = createServerDemandClient({
    baseUrl: 'https://api.example.test',
    fetcher: hanging,
  })
  const timedOut = assert.rejects(timeoutClient.getServerConfig(), { kind: 'timeout' })
  t.mock.timers.tick(SERVER_DEMAND_TIMEOUT_MS - 1)
  assert.equal(requestSignal?.aborted, false)
  t.mock.timers.tick(1)
  await timedOut

  const successClient = createServerDemandClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (_url, init) => {
      requestSignal = init?.signal
      return Response.json(config)
    },
  })
  await successClient.getServerConfig()
  t.mock.timers.tick(SERVER_DEMAND_TIMEOUT_MS)
  assert.equal(requestSignal?.aborted, false)
})
