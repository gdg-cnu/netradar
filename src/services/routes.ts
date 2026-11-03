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
  getDetourOption,
  isPlace,
  isRoutePlan,
  isTripEventResponse,
  validCoordinates,
} from '../types/route'
export type { Place } from '../types/route'

export type PlaceSearchSource = 'demo' | 'sample' | 'unknown'
export function getPlaceSearchSource(): PlaceSearchSource {
  if (isDemoMode()) return 'demo'
  return import.meta.env?.VITE_PLACE_SEARCH_SOURCE === 'sample' ? 'sample' : 'unknown'
}
export function placeSearchNotice(source: PlaceSearchSource): string {
  if (source === 'demo')
    return '데모 장소 목록에서 검색해요. 강남역·교대역·신논현역·삼성역·잠실역·서울역과 예시 충전소를 선택할 수 있어요.'
  if (source === 'sample')
    return '현재 연결된 서버는 강남역·교대역·신논현역·잠실역 4곳의 샘플 장소를 검색합니다. 전체 주소·충전소 검색은 아직 지원하지 않아요.'
  return '연결된 장소 API의 결과를 표시합니다. 검색 가능한 지역·장소는 서버가 제공하는 범위에 따라 달라요.'
}
export function placeSearchEmptyMessage(source: PlaceSearchSource): string {
  if (source === 'sample')
    return '샘플 장소 4곳 중 일치하는 결과가 없어요. 강남역·교대역·신논현역·잠실역을 검색하거나 저장된 즐겨찾기를 선택해 주세요.'
  if (source === 'demo')
    return '데모 목록에 일치하는 장소가 없어요. 강남역·삼성역·잠실역 등을 검색해 보세요.'
  return '검색 결과가 없어요. 다른 장소 이름이나 주소를 입력해 주세요. 장소 검색 API의 지원 범위를 벗어났을 수도 있어요.'
}
export function routeEstimateNotice(
  demo: boolean,
  configuredSource: string | undefined = import.meta.env?.VITE_ROUTE_ESTIMATE_SOURCE,
): string {
  if (demo)
    return '실제 교통·수요와 연결되지 않은 시뮬레이션입니다. 실제 길 안내로 사용하지 마세요.'
  if (configuredSource === 'sample')
    return '도로 경로는 서버 제공 정보이며, 예상 수익은 샘플 수요와 시연용 비용 모델로 계산한 예시 추정값입니다. 실제 수익을 보장하지 않아요.'
  return '서버에서 제공한 경로와 예상 수익입니다. 수익 데이터의 출처와 예측 정확도는 확인되지 않았으며 실제 운행 결과와 다를 수 있어요.'
}

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
      const option = getDetourOption(request.detour)
      const ratio = option.percent / 100
      const count = option.demoStops
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
