import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

test('web app manifest is linked and installable metadata is complete', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const response = await request.get(href!)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({
    short_name: '넷레이더',
    lang: 'ko',
    start_url: '/',
    display: 'standalone',
    theme_color: '#ff7033',
  })
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(
    manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable'),
  ).toBe(true)

  for (const icon of manifest.icons as { src: string }[]) {
    const iconResponse = await request.get(`/${icon.src}`)
    expect(iconResponse.ok(), icon.src).toBe(true)
    expect(iconResponse.headers()['content-type']).toContain('image/png')
  }
})

test('service worker registers and serves the app shell offline', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // 첫 방문에서 설치된 서비스 워커가 페이지를 제어하도록 한 번 새로고침합니다.
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#root')).not.toBeEmpty()
  await context.setOffline(false)
})
