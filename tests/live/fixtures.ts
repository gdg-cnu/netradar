import { expect, type Page, type Route } from '@playwright/test'
import backendZones from '../fixtures/backend-zones.json' with { type: 'json' }
import backendPlaces from '../fixtures/backend-places.json' with { type: 'json' }
import type { UserProfile } from '../../src/types/profile'
import type { RouteRequest } from '../../src/types/route'

export const places = backendPlaces
export const profile: UserProfile = {
  name: '연동 테스트 기사',
  vehicleType: 'LPG',
  notifications: false,
  favorites: [],
}

export function routePlan(request: RouteRequest, id = 'route-test') {
  const stop = places[1]
  return {
    ...request,
    id,
    generatedAt: Date.now(),
    demo: false,
    direct: { minutes: 20, kilometers: 7, earnings: 0 },
    recommended: { minutes: 28, kilometers: 9, earnings: 1500 },
    stops: [{ ...stop, waitMinutes: 5, expectedHourlyRate: 28000 }],
    directPath: [
      [request.origin.lat, request.origin.lng],
      [37.5, 127.06],
      [request.destination.lat, request.destination.lng],
    ],
    recommendedPath: [
      [request.origin.lat, request.origin.lng],
      [stop.lat, stop.lng],
      [37.5, 127.06],
      [request.destination.lat, request.destination.lng],
    ],
  }
}

export function forecast(url: URL) {
  return {
    generatedAt: new Date().toISOString(),
    metric: url.searchParams.get('metric') ?? 'hourly',
    horizon: Number(url.searchParams.get('horizon') ?? 0),
    zones: structuredClone(Object.values(backendZones)),
  }
}

export function createTestSession() {
  const user = {
    id: '10000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'frontend-test@example.invalid',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'kakao', providers: ['kakao'] },
    user_metadata: { full_name: profile.name },
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expiresAt, aud: 'authenticated' })}.test-signature`
  return {
    access_token: accessToken,
    refresh_token: 'isolated-test-refresh-token',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
}

export async function installSession(page: Page) {
  const session = createTestSession()
  await page.addInitScript((session) => {
    if (sessionStorage.getItem('netradar-test-session-seeded')) return
    sessionStorage.setItem('netradar-test-session-seeded', 'true')
    localStorage.setItem('sb-netradar-test-auth-token', JSON.stringify(session))
  }, session)
  await page.route('https://netradar-test.invalid/**', (route) =>
    route.fulfill({ status: 200, json: { user: session.user } }),
  )
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
}

type ApiHandler = (route: Route, url: URL) => boolean | void | Promise<boolean | void>

export async function installApi(page: Page, handler?: ApiHandler) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    expect(route.request().headers().authorization).toMatch(/^Bearer /)
    if (await handler?.(route, url)) return
    if (url.pathname === '/api/v1/forecast/zones') {
      await route.fulfill({ json: forecast(url) })
    } else if (url.pathname === '/api/v1/me/profile') {
      await route.fulfill({ json: profile })
    } else if (url.pathname === '/api/v1/places/search') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      await route.fulfill({
        json: places.filter((place) =>
          `${place.name}${place.address}`.toLowerCase().includes(q),
        ),
      })
    } else if (url.pathname === '/api/v1/me/trips') {
      await route.fulfill({ json: [] })
    } else {
      await route.fulfill({ status: 501, json: { detail: 'Unexpected test endpoint' } })
    }
  })
}

export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
}
