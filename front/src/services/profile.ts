import { ApiError, apiRequest } from './api'
import { getStorageScope, readStored, writeStored } from '../utils/storage'
import type { FavoritePlace, UserProfile } from '../types/profile'

const favoriteKinds = ['home', 'lpg', 'ev', 'custom']

export function isFavoritePlace(value: unknown): value is FavoritePlace {
  if (!value || typeof value !== 'object') return false
  const place = value as FavoritePlace
  return (
    typeof place.id === 'string' &&
    typeof place.label === 'string' &&
    place.label.trim().length > 0 &&
    typeof place.address === 'string' &&
    place.address.trim().length > 0 &&
    Number.isFinite(place.lat) &&
    place.lat >= -90 &&
    place.lat <= 90 &&
    Number.isFinite(place.lng) &&
    place.lng >= -180 &&
    place.lng <= 180 &&
    favoriteKinds.includes(place.kind)
  )
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as UserProfile
  return (
    typeof profile.name === 'string' &&
    profile.name.trim().length > 0 &&
    typeof profile.vehicleType === 'string' &&
    typeof profile.notifications === 'boolean' &&
    Array.isArray(profile.favorites) &&
    profile.favorites.every(isFavoritePlace)
  )
}

function defaultProfile(): UserProfile {
  return {
    name: '데모 기사',
    vehicleType: 'LPG',
    notifications: true,
    favorites: [
      {
        id: 'home',
        label: '집',
        address: '서울 송파구 잠실동',
        lat: 37.5111,
        lng: 127.0863,
        kind: 'home',
      },
      {
        id: 'lpg',
        label: 'LPG 충전소',
        address: '서울 강남구 개포동 충전소 (예시)',
        lat: 37.4809,
        lng: 127.0638,
        kind: 'lpg',
      },
      {
        id: 'ev',
        label: '전기차 충전소',
        address: '서울 강남구 삼성동 충전소 (예시)',
        lat: 37.5118,
        lng: 127.0592,
        kind: 'ev',
      },
    ],
  }
}

export async function getProfile(): Promise<UserProfile> {
  const account = getStorageScope()
  const profile = await apiRequest<UserProfile>('/me/profile', {}, () => {
    const stored = readStored<unknown>('profile', null, undefined, account)
    return isProfile(stored) ? stored : defaultProfile()
  })
  if (!isProfile(profile)) throw new Error('프로필 응답 형식을 확인할 수 없습니다.')
  return profile
}

export type ProfileSettings =
  | { kind: 'registered'; profile: UserProfile }
  | { kind: 'unregistered'; draft: UserProfile }

/** A missing profile is an editable draft, never an implicitly saved profile. */
export async function getProfileForSettings(
  userName?: string,
  load: () => Promise<UserProfile> = getProfile,
): Promise<ProfileSettings> {
  try {
    const profile = await load()
    if (!isProfile(profile)) throw new Error('프로필 응답 형식을 확인할 수 없습니다.')
    return { kind: 'registered', profile }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    return {
      kind: 'unregistered',
      draft: {
        name: typeof userName === 'string' ? userName.trim().slice(0, 30) : '',
        vehicleType: 'LPG',
        notifications: true,
        favorites: [],
      },
    }
  }
}

export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  const account = getStorageScope()
  const normalized = {
    ...profile,
    name: profile.name.trim(),
    favorites: profile.favorites.map((place) => ({
      ...place,
      label: place.label.trim(),
      address: place.address.trim(),
    })),
  }
  if (!isProfile(normalized)) throw new Error('이름과 즐겨찾기 주소를 확인해주세요.')
  const saved = await apiRequest<UserProfile>(
    '/me/profile',
    {
      method: 'PATCH',
      body: JSON.stringify(normalized),
    },
    () => {
      writeStored('profile', normalized, account)
      return normalized
    },
  )
  if (!isProfile(saved)) throw new Error('저장된 프로필 응답 형식이 올바르지 않습니다.')
  if (account === getStorageScope())
    window.dispatchEvent(new Event('netradar:profile-changed'))
  return saved
}
