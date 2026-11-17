import { expect, test, type Page } from '@playwright/test'
import { forecast, installApi, installSession, noOverflow } from './fixtures'

const now = Math.floor(Date.now() / 1000) * 1000
const twentyMinutes = 20 * 60 * 1000
const mutedColor = 'rgb(107, 114, 128)'

async function expectFreshness(page: Page, state: 'fresh' | 'stale' | 'unknown') {
  await expect(page.locator('main.forecast-page')).toHaveAttribute(
    'data-freshness',
    state,
  )
  await expect(page.locator('.freshness-badge')).toHaveAttribute('data-freshness', state)
}

async function expectMutedPredictions(page: Page) {
  const polygons = page.locator('.forecast-leaflet path.leaflet-interactive')
  await expect(polygons).toHaveCount(2)
  for (const polygon of await polygons.all()) {
    await expect(polygon).toHaveAttribute('fill', '#6b7280')
  }
  await expect(page.locator('.forecast-trend polyline')).toHaveCSS('stroke', mutedColor)
  await expect(page.locator('.forecast-zone-list li b').first()).toHaveCSS(
    'color',
    'rgb(75, 85, 99)',
  )
  await expect(page.locator('.forecast-zone-list button[aria-pressed="true"]')).toHaveCSS(
    'background-color',
    'rgb(243, 244, 246)',
  )
  await expect(page.locator('.forecast-trend circle').first()).toHaveCSS(
    'fill',
    mutedColor,
  )
}

test.beforeEach(async ({ page }) => {
  await installSession(page)
})

test('a forecast generated twenty minutes ago is muted and readable when map tiles fail', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(now)
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    await route.fulfill({
      json: {
        ...forecast(url),
        generatedAt: new Date(now - twentyMinutes).toISOString(),
      },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'stale')
  await expect(page.locator('.freshness-badge')).toContainText('오래된 예측')
  await expect(page.locator('.freshness-badge')).toContainText('20분 이상')
  await expectMutedPredictions(page)
  await expect(page.locator('.forecast-map-fallback')).toContainText(
    '배경 지도를 불러오지 못했어요',
  )
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(2)
  await expect(page.locator('#zone-detail-title')).toHaveText('강남역')
  await page
    .locator('.forecast-zone-list')
    .getByRole('button', { name: /교대역/ })
    .click()
  await expect(page.locator('#zone-detail-title')).toHaveText('교대역')
  await expectMutedPredictions(page)
  await noOverflow(page)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0)
        requestAnimationFrame(() => resolve())
      }),
  )
  await page.screenshot({
    path: testInfo.outputPath('stale-forecast.png'),
    fullPage: true,
  })
})

test('refreshing an old forecast with a new server timestamp restores fresh colors', async ({
  page,
}) => {
  await page.clock.setFixedTime(now)
  let requests = 0
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    requests += 1
    await route.fulfill({
      json: {
        ...forecast(url),
        generatedAt: new Date(requests === 1 ? now - twentyMinutes : now).toISOString(),
      },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'stale')
  await expectMutedPredictions(page)
  await page.getByRole('button', { name: '예측 새로고침', exact: true }).click()
  await expectFreshness(page, 'fresh')
  await expect(page.locator('.freshness-badge')).toContainText('최근 생성')
  await expect(
    page.locator('.forecast-leaflet path.leaflet-interactive').first(),
  ).toHaveAttribute('fill', '#e04412')
  await expect(page.locator('.forecast-trend polyline')).not.toHaveCSS(
    'stroke',
    mutedColor,
  )
  await expect(page.locator('.forecast-source-badge')).toHaveAttribute(
    'data-provenance',
    'server-demo',
  )
  await expect(page.locator('.demo-banner')).not.toBeVisible()
  expect(requests).toBe(2)
  await noOverflow(page)
})

test('an open forecast turns stale exactly at twenty minutes without another request', async ({
  page,
}) => {
  await page.clock.install({ time: now - 60_000 })
  let requests = 0
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    requests += 1
    await route.fulfill({
      json: {
        ...forecast(url),
        generatedAt: new Date(now - twentyMinutes + 1000).toISOString(),
      },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'fresh')
  await page.clock.pauseAt(now)
  await expectFreshness(page, 'fresh')
  await page.clock.runFor(999)
  await expectFreshness(page, 'fresh')
  await page.clock.runFor(1)
  await expectFreshness(page, 'stale')
  await expectMutedPredictions(page)
  expect(requests).toBe(1)
})

test('aging a visible map preserves marker focus and a popup the user closed', async ({
  page,
}) => {
  await page.clock.install({ time: now - 60_000 })
  // The last matching route overrides installSession's offline tile fixture.
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  let requests = 0
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    requests += 1
    await route.fulfill({
      json: {
        ...forecast(url),
        generatedAt: new Date(now - twentyMinutes + 1000).toISOString(),
      },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'fresh')
  await expect(page.locator('.forecast-leaflet')).toBeVisible()
  await expect(page.locator('.forecast-tile-loading')).not.toBeVisible()
  await expect(page.locator('.forecast-map-fallback')).not.toBeVisible()
  await expect(page.locator('.forecast-popup')).toBeVisible()
  await page.locator('.leaflet-popup-close-button').click()
  await expect(page.locator('.forecast-popup')).not.toBeVisible()
  const marker = page.locator('.forecast-top-marker[aria-label="추천 1위 강남역"]')
  await marker.focus()
  await expect(marker).toBeFocused()
  await page.clock.pauseAt(now)
  await expectFreshness(page, 'fresh')
  await page.clock.runFor(1000)
  await expectFreshness(page, 'stale')
  await expect(marker).toBeFocused()
  await expect(page.locator('.forecast-popup')).not.toBeVisible()
  await expect(marker).toHaveCSS('background-color', mutedColor)
  await expectMutedPredictions(page)
  expect(requests).toBe(1)
})

test('a failed live refresh stays an error and cannot become a successful demo forecast', async ({
  page,
}) => {
  await page.clock.setFixedTime(now)
  let requests = 0
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    requests += 1
    await route.fulfill(
      requests === 1
        ? {
            json: {
              ...forecast(url),
              generatedAt: new Date(now - twentyMinutes).toISOString(),
            },
          }
        : { status: 502, json: { detail: 'Forecast refresh unavailable' } },
    )
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'stale')
  await page.getByRole('button', { name: '예측 새로고침', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('502')
  await expect(page.locator('main.forecast-page')).not.toHaveAttribute(
    'data-freshness',
    'fresh',
  )
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(0)
  await expect(page.locator('.forecast-top-pick')).not.toBeVisible()
  await expect(page.locator('.demo-banner')).not.toBeVisible()
  expect(requests).toBe(2)
})

test('selecting the sixty-minute horizon does not extend freshness from generation time', async ({
  page,
}) => {
  await page.clock.setFixedTime(now)
  const requestedHorizons: string[] = []
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    requestedHorizons.push(url.searchParams.get('horizon') ?? '')
    await route.fulfill({
      json: {
        ...forecast(url),
        generatedAt: new Date(now - twentyMinutes).toISOString(),
      },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'stale')
  await page.getByRole('button', { name: '+60분', exact: true }).click()
  await expect(page.getByRole('button', { name: '+60분', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expectFreshness(page, 'stale')
  await expect(page.locator('.forecast-top-pick')).toContainText('60분 후')
  await expectMutedPredictions(page)
  expect(requestedHorizons).toEqual(['0', '60'])
})

test('an implausibly future generation time is labeled unknown and muted', async ({
  page,
}) => {
  await page.clock.setFixedTime(now)
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    await route.fulfill({
      json: { ...forecast(url), generatedAt: new Date(now + 61_000).toISOString() },
    })
    return true
  })
  await page.goto('/#/map')
  await expectFreshness(page, 'unknown')
  await expect(page.locator('.freshness-badge')).toContainText('생성 시각 확인 불가')
  await expectMutedPredictions(page)
  await expect(page.locator('#zone-detail-title')).toHaveText('강남역')
  await noOverflow(page)
})
