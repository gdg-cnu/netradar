import { expect, test, type Page } from '@playwright/test'
import { loginPreview, noOverflow, NOW, relayBackend, responseJSON } from './fixtures'

const section = (page: Page, name: string) => page.locator(`[data-api-section="${name}"]`)
const places = (page: Page) =>
  page.getByRole('region', { name: '장소별 수요 예측', exact: true })
const detail = (page: Page) =>
  page.getByRole('complementary', { name: '장소 상세 예측', exact: true })
const oldTime = new Date(NOW.getTime() - 25 * 60_000).toISOString()

async function choose(page: Page, group: string, label: string) {
  await page
    .getByRole('group', { name: group, exact: true })
    .getByRole('button', { name: label, exact: true })
    .click()
}

async function allPlaces(page: Page) {
  await page.getByRole('button', { name: '전체 장소 보기', exact: true }).click()
  await expect(places(page).locator('li')).toHaveCount(5)
}

async function tilesSucceed(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
}

test('real public APIs drive metrics, filters, nullable populations and origin-specific alerts', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const requests = await relayBackend(page)
  await loginPreview(page)
  await expect(section(page, 'heatmap')).toHaveAttribute('data-freshness', 'fresh')
  await expect(section(page, 'heatmap')).toContainText('서버 예시 데이터')
  await expect(page.locator('.v2-demand-map-fallback')).toBeVisible()
  await expect
    .poll(() =>
      requests.some(
        (url) => url.pathname.endsWith('/heatmap') && url.searchParams.has('bbox'),
      ),
    )
    .toBeTruthy()
  await allPlaces(page)
  await choose(page, '예측 지표', '예상 인구')
  await choose(page, '예측 시점', '+60분')
  await expect
    .poll(() =>
      requests.some(
        (url) =>
          url.pathname.endsWith('/heatmap') &&
          url.searchParams.get('metric') === 'population' &&
          url.searchParams.get('offset') === '60',
      ),
    )
    .toBeTruthy()
  await places(page)
    .getByRole('button', { name: /인천공항/ })
    .click()
  await expect(detail(page)).toContainText('인구 데이터 없음')
  await expect(detail(page).locator('.v2-place-trend-values')).toHaveText(
    '데이터 없음데이터 없음데이터 없음',
  )
  await expect(detail(page).locator('svg circle')).toHaveCount(0)
  await expect(detail(page).locator('svg polyline')).toHaveCount(0)
  await expect(
    detail(page).getByRole('button', { name: '동선 추천', exact: true }),
  ).toBeDisabled()
  await expect(
    detail(page).getByRole('button', { name: '바로 출발', exact: true }),
  ).toBeDisabled()
  await choose(page, '이벤트 유형', '막차')
  await expect(page.locator('.v2-event-kind')).toHaveText(['막차', '막차', '막차'])
  await expect(page.locator('.v2-event-list li')).toHaveCount(3)
  await expect(page.locator('.v2-event-list')).toContainText('유출 인원 데이터 없음')
  await expect
    .poll(() =>
      requests.some(
        (url) =>
          url.pathname.endsWith('/events') &&
          url.searchParams.get('type') === 'last_train' &&
          url.searchParams.has('from') &&
          url.searchParams.has('to'),
      ),
    )
    .toBeTruthy()
  await page.getByLabel('알림 출발 위치', { exact: true }).selectOption('gangnam')
  await expect(section(page, 'alerts').locator('dd').last()).toContainText('63')
  await page.getByLabel('알림 출발 위치', { exact: true }).selectOption('hongdae')
  await expect(section(page, 'alerts').locator('dd').last()).toContainText('95')
  await expect
    .poll(() =>
      requests
        .filter((url) => url.pathname.endsWith('/alerts/top'))
        .map((url) => url.searchParams.get('lat')),
    )
    .toContain('37.5572')
  await section(page, 'alerts')
    .getByRole('button', { name: /^알림 장소 보기:/ })
    .first()
    .click()
  await expect(detail(page).getByRole('heading', { name: /KSPO|올림픽/ })).toBeVisible()
  await expect(
    section(page, 'alerts')
      .getByRole('button', { name: /^바로 출발:/ })
      .first(),
  ).toBeDisabled()
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('server-demand-map.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test('model metadata, missing middle population and independently stale endpoint sections stay truthful', async ({
  page,
}, testInfo) => {
  await relayBackend(page, async (route, url) => {
    if (!/\/(heatmap|events|alerts\/top|places\/gangnam)$/.test(url.pathname))
      return false
    const body = await responseJSON(route, url)
    body.source = 'model'
    if (!url.pathname.endsWith('/heatmap')) body.generatedAt = oldTime
    if (url.pathname.endsWith('/alerts/top')) {
      for (const alert of body.alerts) {
        for (const key of [
          'recommendedDepartureAt',
          'arrivalAt',
          'peakStart',
          'peakEnd',
        ]) {
          alert[key] = new Date(Date.parse(alert[key]) - 25 * 60_000).toISOString()
        }
      }
    }
    if (url.pathname.endsWith('/places/gangnam')) {
      body.points[1].population = null
      body.points[1].populationRange = null
    }
    await route.fulfill({ json: body })
    return true
  })
  await loginPreview(page)
  await allPlaces(page)
  await choose(page, '예측 지표', '예상 인구')
  await places(page)
    .getByRole('button', { name: /강남역/ })
    .click()
  await page.getByLabel('알림 출발 위치', { exact: true }).selectOption('gangnam')
  await expect(section(page, 'heatmap')).toHaveAttribute('data-freshness', 'fresh')
  for (const name of ['detail', 'events', 'alerts']) {
    await expect(section(page, name)).toHaveAttribute('data-freshness', 'stale')
    await expect(section(page, name)).toContainText('서버 모델 예측')
    await expect(section(page, name)).toContainText('생성 후 20분 이상')
  }
  await expect(
    detail(page).locator('.v2-place-trend-values [data-missing="true"]'),
  ).toHaveText('데이터 없음')
  await expect(detail(page).locator('svg circle')).toHaveCount(2)
  await expect(detail(page).locator('svg polyline')).toHaveCount(0)
  await expect(detail(page).locator('svg circle').first()).toHaveCSS(
    'fill',
    'rgb(98, 98, 98)',
  )
  await expect(detail(page).locator('svg title')).toContainText('30분 후 데이터 없음')
  await expect(detail(page).locator('svg title')).not.toContainText('30분 후 0명')
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('server-model-missing-population.png'),
    fullPage: true,
  })
})

test('stale heatmap grays polygons while fresh detail and event metadata remain fresh', async ({
  page,
}) => {
  const requests = await relayBackend(page, async (route, url) => {
    if (!url.pathname.endsWith('/heatmap')) return false
    const body = await responseJSON(route, url)
    body.generatedAt = oldTime
    await route.fulfill({ json: body })
    return true
  })
  await tilesSucceed(page)
  await loginPreview(page)
  await allPlaces(page)
  await expect(section(page, 'heatmap')).toHaveAttribute('data-freshness', 'stale')
  const polygons = page.locator(
    '.v2-demand-leaflet .leaflet-overlay-pane path.leaflet-interactive',
  )
  await expect(polygons).toHaveCount(5)
  for (const polygon of await polygons.all())
    await expect(polygon).toHaveAttribute('fill', '#6b7280')
  await places(page)
    .getByRole('button', { name: /강남역/ })
    .click()
  await expect(places(page).locator('button[aria-pressed="true"]')).toHaveCSS(
    'background-color',
    'rgb(237, 237, 237)',
  )
  await expect(section(page, 'detail')).toHaveAttribute('data-freshness', 'fresh')
  await expect(section(page, 'events')).toHaveAttribute('data-freshness', 'fresh')
  await allPlaces(page)
  await places(page).getByRole('button', { name: /홍대/ }).click()
  await page.getByRole('checkbox', { name: '지도 안의 장소만 보기', exact: true }).check()
  await expect
    .poll(() => {
      const bbox = requests
        .filter(
          (url) => url.pathname.endsWith('/heatmap') && url.searchParams.has('bbox'),
        )
        .at(-1)
        ?.searchParams.get('bbox')
        ?.split(',')
        .map(Number)
      return bbox
        ? Math.abs((bbox[0] + bbox[2]) / 2 - 126.9245) < 0.001 &&
            Math.abs((bbox[1] + bbox[3]) / 2 - 37.5572) < 0.001
        : false
    })
    .toBeTruthy()
})

for (const failure of ['500', 'malformed'] as const) {
  test(`heatmap ${failure} shows an error without local mock fallback and retries the API`, async ({
    page,
  }) => {
    let broken = true
    await relayBackend(page, async (route, url) => {
      if (!broken || !url.pathname.endsWith('/heatmap')) return false
      if (failure === '500')
        await route.fulfill({ status: 500, json: { detail: 'Injected failure' } })
      else {
        const body = await responseJSON(route, url)
        body.source = 'unverified'
        await route.fulfill({ json: body })
      }
      return true
    })
    await loginPreview(page)
    await expect(
      page.getByRole('button', { name: '지도 다시 시도', exact: true }),
    ).toBeVisible()
    await expect(places(page).locator('li')).toHaveCount(0)
    await expect(page.locator('.v2-demand-place-list')).not.toContainText('서울역')
    broken = false
    await page.getByRole('button', { name: '지도 다시 시도', exact: true }).click()
    await expect(places(page).locator('li').first()).toBeVisible()
    await expect(section(page, 'heatmap')).toContainText('서버 예시 데이터')
  })
}

test('detail 404 cannot show an unrelated local detail and explicit retry restores the server result', async ({
  page,
}) => {
  let broken = true
  await relayBackend(page, async (route, url) => {
    if (!broken || !url.pathname.endsWith('/places/gangnam')) return false
    await route.fulfill({ status: 404, json: { detail: '장소를 찾을 수 없습니다.' } })
    return true
  })
  await loginPreview(page)
  await allPlaces(page)
  await places(page).getByRole('button', { name: /홍대/ }).click()
  await expect(detail(page).getByRole('heading', { name: /홍대/ })).toBeVisible()
  await places(page)
    .getByRole('button', { name: /강남역/ })
    .click()
  await expect(
    page.getByRole('button', { name: '장소 상세 다시 시도', exact: true }),
  ).toBeVisible()
  await expect(detail(page)).toHaveAttribute('data-freshness', 'unknown')
  await expect(detail(page).locator('.v2-place-main-value')).toHaveCount(0)
  await expect(detail(page).locator('svg')).toHaveCount(0)
  await expect(detail(page).getByRole('heading', { name: /홍대/ })).toHaveCount(0)
  broken = false
  await page.getByRole('button', { name: '장소 상세 다시 시도', exact: true }).click()
  await expect(
    detail(page).getByRole('heading', { name: '강남역', exact: true }),
  ).toBeVisible()
})

test('a 12-second request timeout remains an API error without a successful demo fallback', async ({
  page,
}) => {
  let heldRequests = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await relayBackend(page, async (route, url) => {
    if (!url.pathname.endsWith('/heatmap') || url.searchParams.get('offset') !== '60')
      return false
    expect(url.searchParams.has('bbox')).toBeFalsy()
    heldRequests += 1
    await held
    await route.abort().catch(() => undefined)
    return true
  })
  try {
    await loginPreview(page, true)
    // Finish the initial requests and remove bbox-driven cancellations before
    // timing one distinct request. Unchecking an undefined bbox need not refetch.
    await allPlaces(page)
    await expect(
      page.getByRole('checkbox', { name: '지도 안의 장소만 보기', exact: true }),
    ).not.toBeChecked()
    await page.clock.pauseAt(new Date(NOW.getTime() + 60_000))
    await choose(page, '예측 시점', '+60분')
    await expect.poll(() => heldRequests).toBe(1)
    await expect(places(page)).toHaveAttribute('aria-busy', 'true')
    await expect(places(page).locator('li')).toHaveCount(0)
    await page.clock.runFor(11_999)
    await expect(
      page.getByRole('button', { name: '지도 다시 시도', exact: true }),
    ).not.toBeVisible()
    await expect(places(page)).toHaveAttribute('aria-busy', 'true')
    await page.clock.runFor(1)
    await expect(
      page.getByRole('button', { name: '지도 다시 시도', exact: true }),
    ).toBeVisible()
    await expect(section(page, 'heatmap')).toContainText(
      '서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
    )
    await expect(places(page)).toHaveAttribute('aria-busy', 'false')
    await expect(places(page).locator('li')).toHaveCount(0)
    await expect(page.locator('.v2-demand-place-list')).not.toContainText('서울역')
  } finally {
    release()
  }
})
