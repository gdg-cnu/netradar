import { expect, test } from '@playwright/test'
import { createTestSession, installApi, noOverflow } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await installApi(page)
})

test('email signup checks matching passwords and waits for email confirmation without inventing a session', async ({
  page,
}, testInfo) => {
  let signupRequests = 0
  let signupBody: Record<string, unknown> | undefined
  let redirectTo = ''
  await page.route('https://netradar-test.invalid/auth/v1/signup**', async (route) => {
    signupRequests += 1
    signupBody = route.request().postDataJSON()
    redirectTo = new URL(route.request().url()).searchParams.get('redirect_to') ?? ''
    await route.fulfill({ json: { user: createTestSession().user } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '회원가입하기', exact: true }),
  ).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('신규 가입 기사')
  await page
    .getByRole('textbox', { name: '이메일', exact: true })
    .fill('new-driver@example.invalid')
  await page.getByLabel('비밀번호', { exact: true }).fill('frontend-Test-1234')
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('different-Test-1234')
  await page.getByRole('button', { name: '회원가입하기', exact: true }).click()
  await expect(
    page.getByText('비밀번호가 일치하지 않습니다.', { exact: true }),
  ).toBeVisible()
  expect(signupRequests).toBe(0)
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('frontend-Test-1234')
  await page
    .getByRole('button', { name: '회원가입하기', exact: true })
    .evaluate((element) => {
      ;(element as HTMLButtonElement).click()
      ;(element as HTMLButtonElement).click()
    })
  await expect(page.getByRole('status')).toContainText('이메일')
  expect(signupRequests).toBe(1)
  expect(signupBody).toMatchObject({
    email: 'new-driver@example.invalid',
    data: { full_name: '신규 가입 기사' },
  })
  expect(redirectTo).toBe('http://127.0.0.1:5175/')
  expect(signupBody?.code_challenge).toEqual(expect.any(String))
  await expect(page.locator('nav')).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: '카카오톡 로그인', exact: true }),
  ).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('email-signup.png'), fullPage: true })
})

test('email login can retry invalid credentials and uses the same authenticated app session', async ({
  page,
}) => {
  let attempts = 0
  await page.route('https://netradar-test.invalid/auth/v1/token**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('grant_type')).toBe('password')
    expect(route.request().postDataJSON()).toMatchObject({
      email: 'driver@example.invalid',
    })
    attempts += 1
    await route.fulfill(
      attempts === 1
        ? {
            status: 400,
            json: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
          }
        : { json: createTestSession() },
    )
  })
  await page.goto('/')
  await page.getByRole('checkbox').check()
  await page
    .getByRole('textbox', { name: '이메일', exact: true })
    .fill('driver@example.invalid')
  await page.getByLabel('비밀번호', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '이메일로 로그인', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('비밀번호')
  await page.getByLabel('비밀번호', { exact: true }).fill('frontend-Test-1234')
  await page.getByRole('button', { name: '이메일로 로그인', exact: true }).click()
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(2)
  expect(attempts).toBe(2)
  await page.reload()
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(2)
  await expect(page.locator('.demo-banner')).not.toBeVisible()
})

test('signup with an immediate session enters the app without a confirmation-only dead end', async ({
  page,
}) => {
  await page.route('https://netradar-test.invalid/auth/v1/signup**', (route) =>
    route.fulfill({ json: createTestSession() }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('신규 가입 기사')
  await page
    .getByRole('textbox', { name: '이메일', exact: true })
    .fill('new-driver@example.invalid')
  await page.getByLabel('비밀번호', { exact: true }).fill('frontend-Test-1234')
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('frontend-Test-1234')
  await page.getByRole('button', { name: '회원가입하기', exact: true }).click()
  await expect(page.locator('.forecast-zone-list li')).toHaveCount(2)
})

test('Kakao login remains available with consent and PKCE redirect', async ({ page }) => {
  let authorizationUrl: URL | undefined
  await page.route('https://netradar-test.invalid/auth/v1/authorize**', async (route) => {
    authorizationUrl = new URL(route.request().url())
    await route.fulfill({
      contentType: 'text/html',
      body: '<p>Kakao authorization test boundary</p>',
    })
  })
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: '카카오톡 로그인', exact: true }),
  ).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '카카오톡 로그인', exact: true }).click()
  await expect(page).toHaveURL(/netradar-test\.invalid\/auth\/v1\/authorize/)
  expect(authorizationUrl?.searchParams.get('provider')).toBe('kakao')
  expect(authorizationUrl?.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5175/')
  expect(authorizationUrl?.searchParams.get('code_challenge')).toBeTruthy()
})
