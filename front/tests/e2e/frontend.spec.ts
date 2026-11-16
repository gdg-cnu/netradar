import { expect, test, type Page } from '@playwright/test'

async function loginDemo(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '데모로 둘러보기' }).click()
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(7)
}
async function navigate(page: Page, label: string) {
  await page
    .locator('nav:visible')
    .getByRole('button', { name: label, exact: true })
    .click()
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
}

test.beforeEach(async ({ page }) => {
  // External tiles are intentionally unavailable: all core frontend flows must remain usable.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
})

test('consent, geographic forecast filters, zone detail and route handoff', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await loginDemo(page)
  await expect(page.locator('.forecast-top-pick')).toContainText('강남역')
  await page.getByRole('button', { name: '승객 수 보기', exact: true }).click()
  await expect(page.locator('.forecast-top-pick')).toContainText('삼성역')
  await page.getByRole('button', { name: '+60분', exact: true }).click()
  await expect(page.locator('.forecast-top-pick')).toContainText('신논현역')
  await page
    .locator('.forecast-zone-list')
    .getByRole('button', { name: /역삼역/ })
    .click()
  await expect(page.locator('#zone-detail-title')).toContainText('역삼역')
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('forecast.png'), fullPage: true })
  await page.getByRole('button', { name: '이 구역으로 동선 추천', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '도착지 검색' })).toHaveValue('역삼역')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '도착지 검색' })).toHaveValue('역삼역')
  expect(errors).toEqual([])
})

test('manual origin, recommendation, reload-safe drive and saved history', async ({
  page,
}, testInfo) => {
  await loginDemo(page)
  await navigate(page, '동선 추천')
  await page.getByRole('button', { name: '동선 추천받기', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('도착지')
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
  await page.getByRole('button', { name: '동선 추천받기', exact: true }).click()
  await expect(page.locator('#route-results-title')).toContainText('잠실역')
  await expect(page.locator('.route-stop-list li')).not.toHaveCount(0)
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('route.png'), fullPage: true })
  await page
    .getByRole('button', { name: '이 동선으로 데모 운행 시작', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '경유지로 이동 중', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '데모: 경유지 도착', exact: true }).click()
  await navigate(page, '시급 지도')
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(7)
  await page.evaluate(() => {
    window.location.hash = '/drive'
  })
  await expect(page.getByRole('timer')).toBeVisible()
  const readWaitUntil = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('netradar:v1:demo:active-drive') || '{}')
          .waitUntil,
    )
  const deadline = await readWaitUntil()
  await page.reload()
  await expect(page.getByRole('timer')).toBeVisible()
  expect(await readWaitUntil()).toBe(deadline)
  await page.getByRole('button', { name: '2분 더 대기 (0/2)', exact: true }).click()
  await expect.poll(readWaitUntil).toBe(deadline + 120000)
  await page
    .getByRole('button', { name: '데모: 승객 탑승', exact: true })
    .evaluate((element) => {
      ;(element as HTMLButtonElement).click()
      window.location.reload()
    })
  await expect(page.getByRole('alert')).toContainText('이전 저장 요청')
  await page.getByRole('button', { name: '실패한 요청 다시 시도', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '승객 탑승 중', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '운행 종료', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('spinbutton', { name: '이번 운송 요금', exact: true })
    .fill('14000')
  await page.getByRole('button', { name: '데모: 하차 기록', exact: true }).click()
  await page
    .getByRole('button', { name: '현재 위치에서 다시 추천받기', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '경유지로 이동 중', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '운행 종료', exact: true }).click()
  await page.getByRole('button', { name: '저장하고 운행 종료', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '오늘도 안전 운전하셨어요' }),
  ).toBeVisible()
  await expect(page.locator('.drive-summary')).toContainText('14,000원')
  await page.screenshot({ path: testInfo.outputPath('summary.png'), fullPage: true })
  await page.getByRole('button', { name: '운행 기록 보기', exact: true }).click()
  await expect(page.locator('.history-ride-grid article')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.history-ride-grid article')).toHaveCount(1)
  await noOverflow(page)
})

test('profile and favorites persist, examples stay separate, logout gates deep links', async ({
  page,
}, testInfo) => {
  await loginDemo(page)
  await navigate(page, '마이페이지')
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('테스트 기사')
  await page.getByRole('combobox', { name: '차종', exact: true }).selectOption('전기')
  await page.getByRole('button', { name: '프로필 저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('프로필을 저장')
  await page.getByRole('button', { name: '+ 장소 추가', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('textbox', { name: '장소 이름', exact: true })
    .fill('테스트 목적지')
  await dialog
    .getByRole('textbox', { name: '주소 또는 장소 검색', exact: true })
    .fill('삼성')
  await dialog.getByRole('button', { name: '주소 검색', exact: true }).click()
  await dialog.getByRole('button', { name: /삼성역/ }).click()
  await dialog.getByRole('button', { name: '장소 저장', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(
    '테스트 기사',
  )
  await expect(page.getByRole('combobox', { name: '차종', exact: true })).toHaveValue(
    '전기',
  )
  await expect(
    page.getByRole('button', { name: '테스트 목적지 삭제', exact: true }),
  ).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true })
  await page.getByRole('button', { name: '테스트 목적지 삭제', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '테스트 목적지 삭제', exact: true }),
  ).not.toBeVisible()
  await navigate(page, '리플레이')
  await expect(
    page.getByRole('heading', { name: '아직 저장된 운행이 없어요' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '예시 기록 보기', exact: true }).click()
  await expect(page.locator('.history-ride-grid article')).toHaveCount(2)
  await page.getByRole('button', { name: '예시 기록 숨기기', exact: true }).click()
  await expect(page.locator('.history-ride-grid article')).toHaveCount(0)
  await navigate(page, '마이페이지')
  await page.getByRole('button', { name: /로그아웃/ }).click()
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).toBeVisible()
  await page.goto('/#/drive')
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).toBeVisible()
})
