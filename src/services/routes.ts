import { apiRequest, isDemoMode } from './api'
import type {
  Coordinates,
  DriveAction,
  TripEventResponse,
  Place,
  RoutePlan,
  RouteRequest,
} from '../types/route'
import {
  isPlace,
  isRoutePlan,
  isTripEventResponse,
  validCoordinates,
} from '../types/route'
export type { Place } from '../types/route'

const samplePlaces: Place[] = [
  {
    id: 'gangnam',
    name: '강남역',
    address: '서울 강남구 강남대로 396',
    lat: 37.4979,
    lng: 127.0276,
  },
  {
    id: 'samsung',
    name: '삼성역',
    address: '서울 강남구 테헤란로 538',
    lat: 37.5088,
    lng: 127.0632,
  },
  {
    id: 'sinnonhyeon',
    name: '신논현역',
    address: '서울 강남구 봉은사로 102',
    lat: 37.5045,
    lng: 127.0254,
  },
  {
    id: 'gyodae',
    name: '교대역',
    address: '서울 서초구 서초대로 294',
    lat: 37.4934,
    lng: 127.0141,
  },
  {
    id: 'jamsil',
    name: '잠실역',
    address: '서울 송파구 올림픽로 265',
    lat: 37.5133,
    lng: 127.1001,
  },
  {
    id: 'seoul',
    name: '서울역',
    address: '서울 용산구 한강대로 405',
    lat: 37.5547,
    lng: 126.9706,
  },
  {
    id: 'lpg',
    name: '강남 LPG 충전소 (데모)',
    address: '서울 강남구 · 예시 충전소',
    lat: 37.5023,
    lng: 127.0455,
  },
  {
    id: 'ev',
    name: '강남 전기차 충전소 (데모)',
    address: '서울 강남구 · 예시 충전소',
    lat: 37.4994,
    lng: 127.0325,
  },
]
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  if (query.trim().length < 2) return []
  const result = await apiRequest<Place[]>(
    `/places/search?q=${encodeURIComponent(query.trim())}`,
    { signal },
    () => {
      const term = query.trim().toLowerCase().replace(/\s+/g, '')
      return samplePlaces.filter((p) =>
        `${p.name}${p.address}`.toLowerCase().replace(/\s+/g, '').includes(term),
      )
    },
  )
  if (!Array.isArray(result) || !result.every(isPlace))
    throw new Error('장소 검색 응답을 확인할 수 없어요. 다시 시도해 주세요.')
  return result
}
export async function recommendRoute(
  request: RouteRequest,
  signal?: AbortSignal,
): Promise<RoutePlan> {
  if (!validCoordinates(request.origin) || !isPlace(request.destination))
    throw new Error('출발 위치와 목적지를 먼저 선택해 주세요.')
  const result = await apiRequest<RoutePlan>(
    '/routes/recommendations',
    {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    },
    () => {
      const straightKm = Math.max(
        1,
        Math.hypot(
          (request.destination.lat - request.origin.lat) * 111,
          (request.destination.lng - request.origin.lng) * 88,
        ),
      )
      const minutes = Math.max(8, Math.round(straightKm * 3))
      const ratio = { little: 0.15, normal: 0.3, much: 0.45 }[request.detour]
      const count = { little: 1, normal: 2, much: 3 }[request.detour]
      const stops = samplePlaces
        .filter(
          (p) =>
            !p.name.includes('데모') &&
            p.id !== request.destination.id &&
            !request.excludeStopIds?.includes(p.id) &&
            Math.hypot(p.lat - request.destination.lat, p.lng - request.destination.lng) >
              0.001,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.lat - request.origin.lat, a.lng - request.origin.lng) -
            Math.hypot(b.lat - request.origin.lat, b.lng - request.origin.lng),
        )
        .slice(0, count)
        .map((p, i) => ({
          ...p,
          waitMinutes: 2 + i,
          expectedHourlyRate: 32000 - i * 3000,
        }))
      return {
        ...request,
        id: `demo-route-${Date.now()}`,
        generatedAt: Date.now(),
        demo: true,
        direct: {
          minutes,
          kilometers: Number((straightKm * 1.2).toFixed(1)),
          earnings: minutes * 330,
        },
        recommended: {
          minutes: Math.round(minutes * (1 + ratio)),
          kilometers: Number((straightKm * 1.2 * (1 + ratio)).toFixed(1)),
          earnings: Math.round(minutes * (1 + ratio) * 480),
        },
        stops,
      }
    },
  )
  if (!isRoutePlan(result))
    throw new Error('동선 응답 형식이 올바르지 않아요. 다시 추천받아 주세요.')
  if (!isDemoMode() && result.demo)
    throw new Error('실제 모드에서 예시 동선이 반환되어 시작할 수 없어요.')
  return result
}
export async function createTrip(
  plan: RoutePlan,
  requestId: string,
): Promise<{ id: string }> {
  if (plan.demo !== isDemoMode())
    throw new Error('저장된 동선의 실행 모드가 달라요. 동선을 다시 추천받아 주세요.')
  const result = await apiRequest<{ id: string }>(
    '/trips',
    {
      method: 'POST',
      body: JSON.stringify({
        routeId: plan.id,
        destination: plan.destination,
        detour: plan.detour,
      }),
      headers: { 'Idempotency-Key': requestId },
    },
    () => ({ id: `demo-trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
  )
  if (!result || typeof result.id !== 'string' || !result.id)
    throw new Error('운행을 시작하지 못했어요. 다시 시도해 주세요.')
  return result
}
export async function sendTripEvent(
  tripId: string,
  eventId: string,
  action: DriveAction,
): Promise<TripEventResponse> {
  const result = await apiRequest<TripEventResponse>(
    `/trips/${encodeURIComponent(tripId)}/events`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': eventId },
      body: JSON.stringify({
        eventId,
        type: action.type,
        occurredAt: 'now' in action ? action.now : Date.now(),
        payload: action,
      }),
    },
    () => ({ accepted: true }),
  )
  const requireTotals =
    !isDemoMode() && (action.type === 'DROP_OFF' || action.type === 'FINISH')
  if (!isTripEventResponse(result, requireTotals))
    throw new Error(
      requireTotals
        ? '서버의 수익 정산 응답을 확인할 수 없어요. 같은 요청을 다시 시도해 주세요.'
        : '운행 상태를 저장하지 못했어요. 다시 시도해 주세요.',
    )
  return result
}
export function demoDropoffLocation(location: Coordinates): Coordinates {
  return {
    lat: Math.min(90, location.lat + 0.002),
    lng: Math.min(180, location.lng + 0.002),
  }
}
