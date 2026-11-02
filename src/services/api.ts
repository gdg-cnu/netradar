import { getAccessToken } from './auth'

export const isDemoMode = () => import.meta.env?.VITE_API_MODE !== 'live'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit,
  mock: () => T | Promise<T>,
): Promise<T> {
  if (isDemoMode()) {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    await new Promise((resolve) => setTimeout(resolve, 180))
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    return mock()
  }
  const base = import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new ApiError('API 서버 주소가 설정되지 않았습니다.', 0)
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timeout = window.setTimeout(abort, 12000)
  try {
    const token = await getAccessToken()
    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${base}/${path.replace(/^\//, '')}`, {
      ...options,
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event('netradar:unauthorized'))
      throw new ApiError(
        response.status === 401
          ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
          : response.status === 403
            ? '이 작업에 접근할 권한이 없습니다.'
            : `요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. (${response.status})`,
        response.status,
      )
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw error
    throw new ApiError(
      controller.signal.aborted
        ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.'
        : '서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.',
      0,
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
