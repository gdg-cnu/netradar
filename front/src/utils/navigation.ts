import type { Page } from '../types/app'

export const validPages: Page[] = ['map', 'route', 'drive', 'replay', 'mypage']

export function getRoute(): { page: Page; params: Record<string, string> } {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  const page = validPages.includes(path as Page) ? (path as Page) : 'map'
  return { page, params: Object.fromEntries(new URLSearchParams(query)) }
}

export function navigateTo(page: Page, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString()
  window.location.hash = `/${page}${query ? `?${query}` : ''}`
}
