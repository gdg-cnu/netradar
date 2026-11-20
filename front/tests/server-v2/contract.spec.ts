import { expect, test } from '@playwright/test'
import { BACKEND } from './fixtures'

test('production public routers expose nullable populations, filters, alerts and config without credentials', async ({
  request,
}) => {
  const get = async (path: string) => {
    const response = await request.get(`${BACKEND}/api/v1${path}`)
    expect(response.status()).toBe(200)
    return response.json()
  }
  const config = await get('/config')
  expect(config).toEqual({
    detourRatios: { little: 15, normal: 30, much: 50 },
    offsets: [0, 30, 60],
    maxStops: 3,
  })
  const heatmap = await get('/heatmap?metric=population&offset=60')
  expect(heatmap).toMatchObject({
    source: 'mock',
    metric: 'population',
    offset: 60,
    generatedAt: '2026-11-20T22:00:00+09:00',
  })
  expect(heatmap.places).toHaveLength(5)
  const airport = heatmap.places.find(
    (place: { id: string }) => place.id === 'incheon-t1',
  )
  expect(
    airport.points.map((point: { population: unknown }) => point.population),
  ).toEqual([null, null, null])
  expect(
    airport.points.map((point: { populationRange: unknown }) => point.populationRange),
  ).toEqual([null, null, null])
  for (const place of heatmap.places) {
    expect(place.polygon[0]).toEqual(place.polygon.at(-1))
    expect(place.points.map((point: { offset: number }) => point.offset)).toEqual([
      0, 30, 60,
    ])
  }
  const bounded = await get(
    '/heatmap?metric=surge&offset=30&bbox=126.76,37.41,127.19,37.72',
  )
  expect(
    bounded.places.some((place: { id: string }) => place.id === 'incheon-t1'),
  ).toBeFalsy()
  const detail = await get('/places/hongdae')
  expect(detail).toMatchObject({ id: 'hongdae', source: 'mock' })
  expect(detail.reasons.length).toBeGreaterThan(0)
  expect(detail.taxiStands.length).toBeGreaterThan(0)
  const events = await get(
    '/events?type=last_train&from=2026-11-20T13%3A00%3A00Z&to=2026-11-20T15%3A00%3A00Z',
  )
  expect(events.events).toHaveLength(3)
  expect(
    events.events.every(
      (event: { type: string; expectedExits: unknown }) =>
        event.type === 'last_train' && event.expectedExits === null,
    ),
  ).toBeTruthy()
  const gangnam = await get('/alerts/top?lat=37.4979&lng=127.0276')
  const hongdae = await get('/alerts/top?lat=37.5572&lng=126.9245')
  expect(gangnam.alerts[0]).toMatchObject({
    placeId: 'kspo-dome',
    surgeIndexAtArrival: 63,
  })
  expect(hongdae.alerts[0]).toMatchObject({
    placeId: 'kspo-dome',
    surgeIndexAtArrival: 95,
  })
  expect((await request.get(`${BACKEND}/api/v1/places/missing`)).status()).toBe(404)
  expect((await request.get(`${BACKEND}/api/v1/heatmap?offset=15`)).status()).toBe(422)
})
