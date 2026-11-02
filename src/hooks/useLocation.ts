import { useSyncExternalStore } from 'react'

type LocationState = {
  position: { lat: number; lng: number } | null
  status: 'idle' | 'loading' | 'granted' | 'denied' | 'unavailable'
  error: string
  updatedAt: number | null
}

let state: LocationState = { position: null, status: 'idle', error: '', updatedAt: null }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function update(next: LocationState) {
  state = next
  listeners.forEach((listener) => listener())
}

function requestLocation() {
  if (state.status === 'loading') return
  if (!navigator.geolocation) {
    update({
      ...state,
      status: 'unavailable',
      error: '이 브라우저는 위치 정보를 지원하지 않습니다.',
    })
    return
  }
  update({ ...state, status: 'loading', error: '' })
  navigator.geolocation.getCurrentPosition(
    ({ coords, timestamp }) =>
      update({
        position: { lat: coords.latitude, lng: coords.longitude },
        status: 'granted',
        error: '',
        updatedAt: timestamp,
      }),
    (error) =>
      update({
        position: null,
        updatedAt: null,
        status: error.code === 1 ? 'denied' : 'unavailable',
        error:
          error.code === 1
            ? '위치 접근이 거절되었습니다. 브라우저 사이트 설정에서 허용하거나 목적지를 직접 입력해 주세요.'
            : '현재 위치를 확인하지 못했습니다. 다시 시도하거나 목적지를 직접 입력해 주세요.',
      }),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
  )
}

export function useLocation() {
  return { ...useSyncExternalStore(subscribe, () => state), requestLocation }
}
