import { expect, test, type Page } from '@playwright/test'

const exampleNow = new Date('2026-11-18T04:00:00Z')
const driveKey = 'netradar:v2:demo:demand-drive'

async function loginDemo(page: Page, runningClock = false) {
  if (runningClock) await page.clock.install({ time: exampleNow })
  else await page.clock.setFixedTime(exampleNow)
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: '데모로 둘러보기', exact: true }),
  ).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '데모로 둘러보기', exact: true }).click()
  await expect(page.locator('main.v2-demand-page')).toBeVisible()
  await expect(page.locator('.v2-demand-place-list li')).not.toHaveCount(0)
}

async function navigate(page: Page, name: string) {
  await page.locator('nav:visible').getByRole('button', { name, exact: true }).click()
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
}

async function readDriveEnvelope(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), driveKey)
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
})

test('demand metrics, time, search, event types and alert selection work without map tiles', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', (route) => {
    apiRequests.push(route.request().url())
    return route.abort()
  })
  await loginDemo(page)
  await expect(page.locator('.demo-banner')).toContainText('목업')
  await expect(page.locator('.v2-demand-map-fallback')).toBeVisible()
  await page.getByRole('button', { name: '전체 장소 보기', exact: true }).click()
  const list = page.getByRole('region', { name: '장소별 수요 예측', exact: true })
  await expect(list.locator('li')).toHaveCount(6)
  await expect(list.locator('li').first()).toContainText('서울역')
  await page
    .getByRole('group', { name: '예측 지표', exact: true })
    .getByRole('button', { name: '예상 인구', exact: true })
    .click()
  await expect(list.locator('li').first()).toContainText('강남역')
  await expect(list.locator('li').first()).toContainText('8,800')
  await page
    .getByRole('group', { name: '예측 시점', exact: true })
    .getByRole('button', { name: '+60분', exact: true })
    .click()
  await expect(list.locator('li').first()).toContainText('7,600')
  await page
    .getByRole('searchbox', { name: '장소 검색', exact: true })
    .fill('존재하지 않는 장소')
  await expect(list.locator('li')).toHaveCount(0)
  await expect(list).toContainText('검색어에 맞는 장소가 없어요')
  await page.getByRole('searchbox', { name: '장소 검색', exact: true }).fill('공항')
  await expect(list.locator('li')).toHaveCount(2)
  await list.getByRole('button', { name: /김포공항/ }).click()
  const details = page.getByRole('complementary', { name: '장소 상세 예측', exact: true })
  await expect(
    details.getByRole('heading', { name: '김포공항', exact: true }),
  ).toBeVisible()
  await expect(details).toContainText('승차대')
  await expect(details).toContainText('서울 인구 관측 지역')
  await expect(details).toContainText('주변 체류 인구')
  await expect(details.locator('.v2-place-events li')).toHaveCount(0)
  await expect(details).not.toContainText('국내선 도착편')
  await page.getByRole('searchbox', { name: '장소 검색', exact: true }).fill('서울역')
  await list.getByRole('button', { name: /서울역/ }).click()
  await expect(
    details.getByRole('heading', { name: '서울역', exact: true }),
  ).toBeVisible()
  await expect(details).toContainText('서울 인구 관측 지역')
  await expect(details.locator('.v2-place-events li')).toHaveCount(0)
  await expect(details).not.toContainText('열차 도착')
  await expect(
    page
      .getByRole('group', { name: '이벤트 유형', exact: true })
      .getByRole('button', { name: '열차', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.v2-alert-title')).not.toContainText('김포공항')
  await expect(page.locator('.v2-alert-title')).not.toContainText('서울역')
  await page
    .getByRole('group', { name: '이벤트 유형', exact: true })
    .getByRole('button', { name: '공항', exact: true })
    .click()
  await expect(page.locator('.v2-event-list li')).toHaveCount(1)
  await expect(page.locator('.v2-event-kind')).toHaveText(['공항'])
  await expect(page.locator('.v2-event-list')).toContainText('인천공항 T1')
  await expect(page.locator('.v2-event-list')).toContainText('입국 인원 1,800명')
  await page
    .getByRole('group', { name: '이벤트 유형', exact: true })
    .getByRole('button', { name: '공연', exact: true })
    .click()
  await expect(page.locator('.v2-event-list li')).toHaveCount(1)
  await expect(page.locator('.v2-event-list')).toContainText('공연 규모 추정 2,400명')
  await page.getByRole('button', { name: /^이벤트 장소 보기:/ }).click()
  await expect(
    details.getByRole('heading', { name: '올림픽공원 공연장', exact: true }),
  ).toBeVisible()
  await expect(details.locator('.v2-place-events')).toContainText(
    '공연 규모 추정 2,400명',
  )
  const alert = page.getByRole('button', { name: /^알림 장소 보기:/ }).first()
  const alertName = (await alert.getAttribute('aria-label'))!.replace(
    '알림 장소 보기: ',
    '',
  )
  await alert.click()
  await expect(
    details.getByRole('heading', { name: alertName, exact: true }),
  ).toBeVisible()
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('demand-map.png'), fullPage: true })
  expect(apiRequests).toEqual([])
  expect(errors).toEqual([])
})

test('replay examples are opt-in, compare population in people, and preserve missing observations', async ({
  page,
}, testInfo) => {
  await loginDemo(page)
  await navigate(page, '리플레이')
  await expect(
    page.getByRole('heading', { name: '선택한 날짜·장소의 운행이 없어요', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.v2-replay-comparison')).not.toBeVisible()
  const storedBefore = await page.evaluate(() =>
    JSON.stringify(Object.entries(localStorage).sort()),
  )
  await page.getByRole('button', { name: '예시 리플레이 보기', exact: true }).click()
  const comparison = page.getByRole('region', {
    name: '예보 인구와 관측 인구 예시 비교',
    exact: true,
  })
  await expect(comparison).toContainText('실제 수집 자료가 아닙니다')
  await expect(comparison.getByRole('columnheader')).toHaveText([
    '시각 (KST)',
    '예보 인구(예시)',
    '관측 인구(예시)',
  ])
  const missingRow = comparison
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: '17:00', exact: true }) })
  await expect(missingRow.getByRole('cell').last()).toHaveText('관측 없음')
  await expect(comparison.locator('.v2-replay-observed-dot')).toHaveCount(5)
  await expect(comparison.locator('.v2-replay-observed-line')).toHaveCount(2)
  await page
    .getByRole('combobox', { name: '리플레이 장소', exact: true })
    .selectOption('seoul-station')
  await expect(
    comparison.getByRole('heading', { name: '서울역 인구 비교', exact: true }),
  ).toBeVisible()
  await page.getByLabel('리플레이 날짜', { exact: true }).fill('2026-11-17')
  await expect(comparison).toContainText('2026-11-17')
  await expect(page.locator('.v2-replay-trip')).toHaveCount(0)
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('population-replay.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())),
  ).toBe(storedBefore)
  await page.getByRole('button', { name: '예시 리플레이 숨기기', exact: true }).click()
  await expect(comparison).not.toBeVisible()
  await page.reload()
  await expect(page.locator('.v2-replay-comparison')).not.toBeVisible()
  await expect(page.locator('.v2-replay-trip')).toHaveCount(0)
})

test('surge notification preferences survive reload and logout gates v2 deep links', async ({
  page,
}) => {
  await loginDemo(page)
  await expect(
    page.getByRole('heading', { name: '지금 주목할 급증 알림', exact: true }),
  ).toBeVisible()
  await navigate(page, '마이페이지')
  const toggle = page.getByRole('switch', { name: '지도 급증 알림', exact: true })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await navigate(page, '수요 지도')
  await expect(
    page.getByRole('heading', { name: '지금 주목할 급증 알림', exact: true }),
  ).not.toBeVisible()
  await navigate(page, '마이페이지')
  await toggle.click()
  await navigate(page, '수요 지도')
  await expect(
    page.getByRole('heading', { name: '지금 주목할 급증 알림', exact: true }),
  ).toBeVisible()
  await navigate(page, '마이페이지')
  await page.getByRole('button', { name: /로그아웃/ }).click()
  await expect(
    page.getByRole('button', { name: '데모로 둘러보기', exact: true }),
  ).toBeVisible()
  await page.goto('/#/drive')
  await expect(
    page.getByRole('button', { name: '데모로 둘러보기', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.v2-demand-page')).not.toBeVisible()
})

test('quick departure without a destination restores an active trip and saves it once in the current account', async ({
  page,
}, testInfo) => {
  await loginDemo(page)
  await navigate(page, '동선 추천')
  await page.getByRole('button', { name: '목업 동선 추천', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('출발지')
  await page
    .getByRole('combobox', { name: '출발지 직접 선택', exact: true })
    .selectOption('seoul-station')
  await page
    .getByRole('combobox', { name: '목적지 (선택)', exact: true })
    .selectOption('gimpo')
  await page.getByRole('button', { name: /^50%/ }).click()
  await page.getByRole('button', { name: '목업 동선 추천', exact: true }).click()
  expect((await readDriveEnvelope(page)).draft.plan).toMatchObject({
    destinationId: 'gimpo',
    detour: 50,
  })
  await navigate(page, '수요 지도')
  await page
    .getByRole('button', { name: /^바로 출발:/ })
    .first()
    .click()
  await expect(page).toHaveURL(/targetPlaceId=.*view=quick/)
  await expect(
    page.getByRole('combobox', { name: '목적지 (선택)', exact: true }),
  ).toHaveValue('')
  expect((await readDriveEnvelope(page)).draft).toMatchObject({
    destinationId: null,
    destination: null,
    detour: 15,
    plan: null,
  })
  await page
    .getByRole('combobox', { name: '출발지 직접 선택', exact: true })
    .selectOption('gangnam')
  await page.getByRole('button', { name: '목업 동선 추천', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '동선 추천 결과', exact: true }),
  ).toContainText('수요')
  const connection = page.getByRole('region', { name: '목업 장소 연결도', exact: true })
  await expect(connection).toHaveAttribute('data-freshness', 'fresh')
  await page.clock.setFixedTime(new Date(exampleNow.getTime() + 20 * 60_000))
  // Returning to an old recommendation must re-evaluate its generation time.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(connection).toHaveAttribute('data-freshness', 'stale')
  await expect(connection.locator('.freshness-badge')).toContainText('20분 이상')
  await expect(connection.locator('.v2-arrival-index').first()).toHaveCSS(
    'background-color',
    'rgb(237, 237, 237)',
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('stale-route.png'), fullPage: true })
  await page.getByRole('button', { name: '목업 동선 추천', exact: true }).click()
  await expect(connection).toHaveAttribute('data-freshness', 'fresh')
  await noOverflow(page)
  await page
    .getByRole('button', { name: '목업 운행 시작', exact: true })
    .evaluate((element) => {
      ;(element as HTMLButtonElement).click()
      ;(element as HTMLButtonElement).click()
    })
  await expect(
    page.getByRole('button', { name: '목업: 경유지 도착', exact: true }),
  ).toBeVisible()
  const tripId = (await readDriveEnvelope(page)).drive.id
  expect((await readDriveEnvelope(page)).drive.plan.destinationName).toBeNull()
  expect((await readDriveEnvelope(page)).drive.plan.stops).toHaveLength(1)
  await page.getByRole('button', { name: '목업: 경유지 도착', exact: true }).click()
  await expect(page.getByRole('timer')).toBeVisible()
  const deadline = (await readDriveEnvelope(page)).drive.waitUntil
  await page.reload()
  await expect(page.getByRole('timer')).toBeVisible()
  expect((await readDriveEnvelope(page)).drive.waitUntil).toBe(deadline)
  expect((await readDriveEnvelope(page)).drive.id).toBe(tripId)
  await page.getByRole('button', { name: '2분 더 대기 (0/2)', exact: true }).click()
  expect((await readDriveEnvelope(page)).drive.waitUntil).toBe(deadline + 120000)
  await page.getByRole('button', { name: '목업: 승객 탑승', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '운행 종료', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('spinbutton', { name: '이번 운송 요금', exact: true })
    .fill('14000')
  await page
    .getByRole('combobox', { name: '하차 장소 (목업)', exact: true })
    .selectOption('gangnam')
  await page.getByRole('button', { name: '목업: 하차 기록', exact: true }).click()
  await page.getByRole('button', { name: '운행 종료', exact: true }).click()
  await page
    .getByRole('button', { name: '저장하고 운행 종료', exact: true })
    .evaluate((element) => {
      ;(element as HTMLButtonElement).click()
      ;(element as HTMLButtonElement).click()
    })
  await expect(
    page.getByRole('button', { name: '리플레이에서 기록 보기', exact: true }),
  ).toBeVisible()
  expect((await readDriveEnvelope(page)).trips).toHaveLength(1)
  expect((await readDriveEnvelope(page)).trips[0]).toMatchObject({
    id: tripId,
    source: 'mock',
    fare: 14000,
    passengers: 1,
    destinationName: null,
  })
  await page.getByRole('button', { name: '리플레이에서 기록 보기', exact: true }).click()
  await expect(page.locator('.v2-replay-trip')).toHaveCount(1)
  await expect(page.locator('.v2-replay-trip')).toContainText('14,000원')
  await expect(page.locator('.v2-replay-trip')).toContainText('목적지 없이')
  await expect(page.locator('.v2-replay-comparison')).not.toBeVisible()
  await page.reload()
  await expect(page.locator('.v2-replay-trip')).toHaveCount(1)
  await page.getByRole('button', { name: '예시 리플레이 보기', exact: true }).click()
  expect((await readDriveEnvelope(page)).trips).toHaveLength(1)
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('saved-mock-trip.png'),
    fullPage: true,
  })
  // Keep a valid record under a different account, then remove only this account's data.
  await page.evaluate((key) => {
    localStorage.setItem(
      'netradar:v2:other-driver:demand-drive',
      localStorage.getItem(key)!,
    )
    localStorage.removeItem(key)
  }, driveKey)
  await page.reload()
  await expect(page.locator('.v2-replay-trip')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: '선택한 날짜·장소의 운행이 없어요', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('netradar:v2:other-driver:demand-drive')!).trips
          .length,
    ),
  ).toBe(1)
})

test('visible place polygons use metric ranges, age to gray, refresh, and tolerate location denial', async ({
  page,
}) => {
  const apiRequests: string[] = []
  await page.route('**/api/v1/**', (route) => {
    apiRequests.push(route.request().url())
    return route.abort()
  })
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) =>
          error?.({
            code: 1,
            message: 'Test location denied',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          }),
      },
    })
  })
  await loginDemo(page, true)
  await expect(page.locator('.v2-demand-leaflet')).toBeVisible()
  await expect(page.locator('.v2-demand-map-loading')).not.toBeVisible()
  await expect(page.locator('.v2-demand-map-fallback')).not.toBeVisible()
  const polygons = page.locator('.v2-demand-leaflet path.leaflet-interactive')
  await expect(polygons).toHaveCount(6)
  const colors = () =>
    polygons.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('fill')),
    )
  await expect
    .poll(colors)
    .toEqual(['#f39b58', '#f39b58', '#fbd4b8', '#e64b15', '#f39b58', '#f39b58'])
  await page
    .getByRole('group', { name: '예측 지표', exact: true })
    .getByRole('button', { name: '예상 인구', exact: true })
    .click()
  await expect
    .poll(colors)
    .toEqual(['#f39b58', '#fbd4b8', '#e64b15', '#e64b15', '#e64b15', '#e64b15'])
  await page
    .getByRole('group', { name: '예측 시점', exact: true })
    .getByRole('button', { name: '+60분', exact: true })
    .click()
  const populationColors = [
    '#f39b58',
    '#fbd4b8',
    '#f39b58',
    '#f39b58',
    '#e64b15',
    '#e64b15',
  ]
  await expect.poll(colors).toEqual(populationColors)
  await page.clock.fastForward(20 * 60_000)
  await expect(page.locator('main.v2-demand-page')).toHaveAttribute(
    'data-freshness',
    'stale',
  )
  await expect.poll(colors).toEqual(Array(6).fill('#6b7280'))
  await expect(page.locator('.freshness-badge')).toContainText('20분 이상')
  await page.getByRole('button', { name: '예측 새로고침', exact: true }).click()
  await expect(page.locator('main.v2-demand-page')).toHaveAttribute(
    'data-freshness',
    'fresh',
  )
  await expect.poll(colors).toEqual(populationColors)
  await page.getByRole('button', { name: '내 위치', exact: true }).click()
  await expect(page.locator('main')).toContainText('위치를 확인할 수 없어요')
  await page.getByRole('button', { name: '전체 장소 보기', exact: true }).click()
  await page.getByRole('searchbox', { name: '장소 검색', exact: true }).fill('서울역')
  await page
    .getByRole('region', { name: '장소별 수요 예측', exact: true })
    .getByRole('button', { name: /서울역/ })
    .click()
  await expect(
    page
      .getByRole('complementary', { name: '장소 상세 예측', exact: true })
      .getByRole('heading', { name: '서울역', exact: true }),
  ).toBeVisible()
  await noOverflow(page)
  expect(apiRequests).toEqual([])
})
