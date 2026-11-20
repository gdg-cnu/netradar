import { expect, type Page, type Route } from '@playwright/test'

export const NOW = new Date('2026-11-20T22:00:00+09:00')
export const BACKEND = 'http://127.0.0.1:8177'
export type Override = (
  route: Route,
  url: URL,
) => boolean | void | Promise<boolean | void>

export async function relayBackend(page: Page, override?: Override) {
  const requests: URL[] = []
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    expect(route.request().method()).toBe('GET')
    expect(route.request().headers().authorization).toBeUndefined()
    if (await override?.(route, url)) return
    // Same-origin browser requests are relayed to the real local FastAPI router.
    // This deliberately does not claim to verify a deployed CORS configuration.
    const response = await route.fetch({ url: `${BACKEND}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
  return requests
}

export async function loginPreview(page: Page, runningClock = false) {
  if (runningClock) await page.clock.install({ time: NOW })
  else await page.clock.setFixedTime(NOW)
  await page.goto('/')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '데모로 둘러보기', exact: true }).click()
  await expect(page.locator('[data-data-source="server"]')).toBeVisible()
}

export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
}

export async function responseJSON(route: Route, url: URL) {
  const response = await route.fetch({ url: `${BACKEND}${url.pathname}${url.search}` })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
