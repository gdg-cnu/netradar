import { expect, test } from '@playwright/test'
import {
  forecast,
  installApi,
  installSession,
  noOverflow,
  places,
  profile,
  routePlan,
} from './fixtures'

test('favorite search identifies sample coverage and explains empty results', async ({
  page,
}) => {
  await installApi(page)
  await page.goto('/#/mypage')
  await page.getByRole('button', { name: '+ 장소 추가', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('강남역·교대역·신논현역·잠실역 4곳')
  await dialog
    .getByRole('textbox', { name: '주소 또는 장소 검색', exact: true })
    .fill('서울역')
  await dialog.getByRole('button', { name: '주소 검색', exact: true }).click()
  await expect(dialog).toContainText('샘플 장소 4곳')
  await expect(dialog.locator('.favorite-selected')).not.toBeVisible()
})

test('a delayed recommendation cannot overwrite a new destination from the URL', async ({
  page,
}) => {
  let releaseOld: (() => void) | undefined
  let oldSettled = false
  let requests = 0
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/routes/recommendations') return false
    requests += 1
    const first = requests === 1
    const result = routePlan(
      route.request().postDataJSON(),
      first ? 'old-plan' : 'new-plan',
    )
    if (first)
      await new Promise<void>((resolve) => {
        releaseOld = resolve
      })
    try {
      await route.fulfill({ json: result })
    } finally {
      if (first) oldSettled = true
    }
    return true
  })
  await page.goto('/#/route?destination=잠실역&lat=37.5133&lng=127.1002')
  await page.getByRole('button', { name: '출발지 직접 선택', exact: true }).click()
  await page.getByRole('textbox', { name: '출발지 검색', exact: true }).fill('강남')
  await page
    .locator('.route-place-picker')
    .getByRole('button', { name: /강남역/ })
    .click()
  await page.getByRole('button', { name: '동선 추천받기', exact: true }).click()
  await expect.poll(() => Boolean(releaseOld)).toBeTruthy()
  await page.evaluate(() => {
    location.hash = '/route?destination=신논현역&lat=37.5045&lng=127.0251'
  })
  await expect(
    page.getByRole('textbox', { name: '도착지 검색', exact: true }),
  ).toHaveValue('신논현역')
  await page.getByRole('button', { name: '동선 추천받기', exact: true }).click()
  await expect(page.locator('#route-results-title')).toContainText('신논현역')
  releaseOld?.()
  await expect.poll(() => oldSettled).toBeTruthy()
  await expect(page.locator('#route-results-title')).toContainText('신논현역')
  await page.reload()
  await expect(page.locator('#route-results-title')).toContainText('신논현역')
  expect(requests).toBe(2)
})

test.beforeEach(async ({ page }) => {
  await installSession(page)
})

test('new profile is created only after confirmed save, failed saves remain retryable', async ({
  page,
}, testInfo) => {
  let saved: typeof profile | null = null
  let writes = 0
  let submitted: unknown
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/me/profile') return false
    if (route.request().method() === 'PATCH') {
      writes += 1
      submitted = route.request().postDataJSON()
      if (writes === 1) {
        await route.fulfill({ status: 502, json: { detail: 'Temporary test failure' } })
      } else {
        saved = submitted as typeof profile
        await route.fulfill({ json: saved })
      }
    } else {
      await route.fulfill(
        saved
          ? { json: saved }
          : { status: 404, json: { detail: '프로필이 아직 생성되지 않았습니다.' } },
      )
    }
    return true
  })
  await page.goto('/#/mypage')
  await expect(
    page.getByRole('heading', { name: '프로필을 처음 등록해 주세요' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    profile.name,
  )
  await expect(
    page.getByRole('button', { name: '+ 장소 추가', exact: true }),
  ).not.toBeVisible()
  expect(writes).toBe(0)
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('신규 기사')
  await page.getByRole('combobox', { name: '차종', exact: true }).selectOption('전기')
  await page.getByRole('button', { name: '프로필 등록', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('502')
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '신규 기사',
  )
  await expect(
    page.getByRole('button', { name: '+ 장소 추가', exact: true }),
  ).not.toBeVisible()
  await page
    .getByRole('button', { name: '프로필 등록', exact: true })
    .evaluate((element) => {
      ;(element as HTMLButtonElement).click()
      ;(element as HTMLButtonElement).click()
    })
  await expect(
    page.getByRole('button', { name: '+ 장소 추가', exact: true }),
  ).toBeVisible()
  expect(writes).toBe(2)
  expect(submitted).toMatchObject({
    name: '신규 기사',
    vehicleType: '전기',
    favorites: [],
  })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '신규 기사',
  )
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('new-profile.png'), fullPage: true })
})

test('profile server failures cannot become a new account and unauthorized sessions are gated', async ({
  page,
}) => {
  let failure = 500
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/me/profile') return false
    await route.fulfill({ status: failure, json: { detail: 'Test error' } })
    return true
  })
  await page.goto('/#/mypage')
  await expect(page.getByRole('alert')).toContainText('500')
  await expect(
    page.getByRole('button', { name: '프로필 등록', exact: true }),
  ).not.toBeVisible()
  failure = 401
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '카카오톡 로그인', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('로그인이 만료')
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).not.toBeVisible()
})

test('current backend sample forecasts render with disclosure and retain horizon selection', async ({
  page,
}, testInfo) => {
  await installApi(page)
  await page.goto('/#/map')
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(2)
  await expect(page.locator('main')).toContainText('서버 예시 데이터')
  await expect(page.locator('.demo-banner')).not.toBeVisible()
  await expect(page.locator('.forecast-top-pick')).toContainText('강남역')
  await page.getByRole('button', { name: '+30분', exact: true }).click()
  await expect(page.locator('.forecast-top-pick')).toContainText('교대역')
  await page
    .locator('.forecast-zone-list')
    .getByRole('button', { name: /교대역/ })
    .click()
  await expect(page.locator('#zone-detail-title')).toContainText('교대역')
  await expect(page.locator('main')).toContainText('30,000')
  await noOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath('server-sample-forecast.png'),
    fullPage: true,
  })
})

test('a malformed ordinary forecast stays an error instead of falling back to samples', async ({
  page,
}) => {
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/forecast/zones') return false
    const response = forecast(url)
    response.zones[0].h3Index = 'invalid-real-cell'
    await route.fulfill({ json: response })
    return true
  })
  await page.goto('/#/map')
  await expect(page.getByRole('alert')).toContainText('지역 예측 데이터')
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(0)
})

test('route request uses the agreed detour and draws server paths without sample roads', async ({
  page,
}, testInfo) => {
  let requestBody: Record<string, unknown> | undefined
  await installApi(page, async (route, url) => {
    if (url.pathname !== '/api/v1/routes/recommendations') return false
    requestBody = route.request().postDataJSON()
    const start = places[0]
    const stop = places[1]
    const end = places[3]
    await route.fulfill({
      json: {
        ...requestBody,
        id: 'route-test',
        generatedAt: Date.now(),
        demo: false,
        direct: { minutes: 20, kilometers: 7, earnings: 0 },
        recommended: { minutes: 28, kilometers: 9, earnings: 1500 },
        stops: [{ ...stop, waitMinutes: 5, expectedHourlyRate: 28000 }],
        directPath: [
          [start.lat, start.lng],
          [37.5, 127.06],
          [end.lat, end.lng],
        ],
        recommendedPath: [
          [start.lat, start.lng],
          [stop.lat, stop.lng],
          [37.5, 127.06],
          [end.lat, end.lng],
        ],
      },
    })
    return true
  })
  await page.goto('/#/route')
  await page.getByRole('button', { name: '출발지 직접 선택', exact: true }).click()
  await page.getByRole('textbox', { name: '출발지 검색', exact: true }).fill('강남')
  await page
    .locator('.route-place-picker')
    .getByRole('button', { name: /강남역/ })
    .click()
  await page.getByRole('textbox', { name: '도착지 검색', exact: true }).fill('잠실')
  await page
    .locator('ul[aria-label="장소 검색 결과"]')
    .getByRole('button', { name: /잠실역/ })
    .click()
  await page.getByRole('button', { name: '많이', exact: true }).click()
  await expect(page.locator('main')).toContainText('50%')
  await page.getByRole('button', { name: '동선 추천받기', exact: true }).click()
  await expect(page.locator('#route-results-title')).toContainText('잠실역')
  expect(requestBody).toMatchObject({
    detour: 'much',
    origin: { lat: places[0].lat, lng: places[0].lng },
  })
  await expect(page.locator('.route-leaflet-map path.route-line-direct')).toHaveCount(1)
  await expect(
    page.locator('.route-leaflet-map path.route-line-recommended'),
  ).toHaveCount(1)
  await expect(page.locator('main')).toContainText('예시')
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('server-route.png'), fullPage: true })
})
