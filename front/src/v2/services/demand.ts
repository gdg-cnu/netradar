import { isDemoMode } from '../../services/api'
import type {
  Bounds,
  DemandAlert,
  DemandOffset,
  DemandPlace,
  DemandPoint,
  DemandRange,
  DemandSnapshot,
  EventType,
} from '../types/demand'

export const eventTypeLabels: Record<EventType, string> = {
  airport: '공항',
  concert: '공연',
  train: '열차',
  last_train: '막차',
}
export const MOCK_ORIGIN = { name: '강남역', lat: 37.4979, lng: 127.0276 }
const MINUTE = 60_000
const kstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function kstDateKey(value: number | string | Date = Date.now()): string {
  const parts = kstFormatter.formatToParts(new Date(value))
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function formatKstTime(value: number | string | Date): string {
  return timeFormatter.format(new Date(value))
}
export function rangeColor(range: DemandRange): string {
  return { low: '#fbd4b8', moderate: '#f39b58', high: '#e64b15' }[range]
}
export function demandPoint(place: DemandPlace, offset: DemandOffset): DemandPoint {
  const point = place.points.find((item) => item.offset === offset)
  if (!point) throw new Error('선택한 시점의 예보가 없습니다.')
  return point
}
function mockRange(value: number): DemandRange {
  // Fixture-only display bands, not a confirmed surge threshold or API range contract.
  return value >= 70 ? 'high' : value >= 40 ? 'moderate' : 'low'
}
function makePlace(
  id: string,
  name: string,
  type: EventType,
  lat: number,
  lng: number,
  indices: [number, number, number],
  populations: [number, number, number],
  reason: string,
): DemandPlace {
  return {
    id,
    name,
    type,
    lat,
    lng,
    // Deliberately approximate mock geometry; not an official place boundary.
    polygon: [
      [lng - 0.003, lat - 0.002],
      [lng + 0.002, lat - 0.0025],
      [lng + 0.0035, lat + 0.001],
      [lng + 0.0005, lat + 0.003],
      [lng - 0.0035, lat + 0.001],
      [lng - 0.003, lat - 0.002],
    ],
    points: ([0, 30, 60] as DemandOffset[]).map((offset, index) => ({
      offset,
      surgeIndex: indices[index],
      population: populations[index],
      range: mockRange(indices[index]),
      populationRange: mockRange(populations[index] / 60),
    })),
    reasons: [
      reason,
      '이벤트 이탈 규모와 시간대 가정을 반영한 화면 테스트용 수요 지수입니다.',
    ],
    taxiStands: [
      {
        name: `${name} 인근 승차대 (예시)`,
        description: '위치·운영 여부는 실제 서비스 연결 후 확인이 필요합니다.',
      },
    ],
  }
}

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const rad = Math.PI / 180
  const term =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(term)))
}

export function createDemandAlerts(
  snapshot: DemandSnapshot,
  origin: { lat: number; lng: number } = MOCK_ORIGIN,
): DemandAlert[] {
  const now = Date.parse(snapshot.generatedAt)
  return filterDemandEvents(snapshot, { now })
    .flatMap((event) => {
      // Alert cards cover the current 0/30/60-minute forecast window, not tonight's distant events.
      if (Date.parse(event.peakAt) > now + 60 * MINUTE) return []
      const place = snapshot.places.find((item) => item.id === event.placeId)!
      // Approximate fixture travel time, never a real road routing estimate.
      const travelMinutes = Math.max(5, Math.round(distanceKm(origin, place) * 2.5 + 5))
      const arrival = now + travelMinutes * MINUTE
      if (travelMinutes > 60 || arrival > Date.parse(event.endsAt)) return []
      const offset: DemandOffset = travelMinutes <= 15 ? 0 : travelMinutes <= 45 ? 30 : 60
      return [
        {
          id: `alert-${event.id}`,
          placeId: place.id,
          reason: event.title,
          travelMinutes,
          surgeIndexAtArrival: demandPoint(place, offset).surgeIndex,
          recommendedDepartureAt: new Date(
            Math.max(now, Date.parse(event.peakAt) - travelMinutes * MINUTE),
          ).toISOString(),
          arrivalAt: new Date(arrival).toISOString(),
          peakStart: event.peakAt,
          peakEnd: event.endsAt,
        },
      ]
    })
    .sort(
      (a, b) =>
        b.surgeIndexAtArrival - a.surgeIndexAtArrival ||
        a.travelMinutes - b.travelMinutes,
    )
    .slice(0, 3)
}

export function createDemandSnapshot(now = Date.now()): DemandSnapshot {
  const places = [
    makePlace(
      'incheon-t1',
      '인천공항 T1',
      'airport',
      37.4486,
      126.4512,
      [54, 91, 72],
      [2400, 4800, 3200],
      'T1 입국 1,800명 예상 (예시)',
    ),
    makePlace(
      'gimpo',
      '김포공항',
      'airport',
      37.558,
      126.802,
      [43, 76, 59],
      [1800, 3200, 2200],
      '국내선 도착편 승객 이동 집중 (예시)',
    ),
    makePlace(
      'olympic-hall',
      '올림픽공원 공연장',
      'concert',
      37.5164,
      127.1275,
      [36, 63, 95],
      [5200, 5600, 3100],
      '공연 종료 후 관객 2,400명 이동 예상 (예시)',
    ),
    makePlace(
      'seoul-station',
      '서울역',
      'train',
      37.5547,
      126.9706,
      [81, 68, 52],
      [4300, 3600, 2700],
      '열차 도착 3편 · 하차 인원 900명 예상 (예시)',
    ),
    makePlace(
      'hongdae',
      '홍대입구역',
      'last_train',
      37.5572,
      126.9245,
      [49, 70, 87],
      [6600, 7200, 5800],
      '막차 이후 체류 인구 이동 가능성 (예시)',
    ),
    makePlace(
      'gangnam',
      '강남역',
      'last_train',
      37.4979,
      127.0276,
      [62, 79, 74],
      [8800, 9100, 7600],
      '막차 이후 상업 지역 이탈 집중 가정 (예시)',
    ),
  ]
  const day = kstDateKey(now)
  const snapshot: DemandSnapshot = {
    source: 'mock',
    generatedAt: new Date(now).toISOString(),
    places,
    alerts: [],
    events: places.map((place, index) => {
      const peak =
        place.type === 'last_train'
          ? Date.parse(`${day}T23:${index === 4 ? '35' : '45'}:00+09:00`)
          : now + [45, 30, 60, 15][index] * MINUTE
      return {
        id: `${day}-${place.id}`,
        placeId: place.id,
        type: place.type,
        title: place.reasons[0],
        peakAt: new Date(peak).toISOString(),
        endsAt: new Date(
          peak + (place.type === 'train' ? 20 : 30) * MINUTE,
        ).toISOString(),
        expectedExits: [1800, 900, 2400, 900, 1200, 1600][index],
        source: '화면 테스트용 목업 · 실제 수집 데이터 아님',
      }
    }),
  }
  snapshot.alerts = createDemandAlerts(snapshot)
  return snapshot
}

export function filterDemandEvents(
  snapshot: DemandSnapshot,
  {
    type = 'all',
    now = Date.now(),
    bounds,
  }: { type?: EventType | 'all'; now?: number; bounds?: Bounds } = {},
) {
  const today = kstDateKey(now)
  return snapshot.events
    .filter((event) => {
      const place = snapshot.places.find((item) => item.id === event.placeId)
      return (
        place &&
        (type === 'all' || event.type === type) &&
        kstDateKey(event.peakAt) === today &&
        Date.parse(event.endsAt) >= now &&
        (!bounds ||
          (place.lng >= bounds.west &&
            place.lng <= bounds.east &&
            place.lat >= bounds.south &&
            place.lat <= bounds.north))
      )
    })
    .sort((a, b) => Date.parse(a.peakAt) - Date.parse(b.peakAt))
}

export async function getDemandSnapshot({
  signal,
  origin,
}: {
  signal?: AbortSignal
  origin?: { lat: number; lng: number }
} = {}): Promise<DemandSnapshot> {
  if (!isDemoMode())
    throw new Error(
      '수요 예보 API는 아직 연결되지 않았습니다. 목업은 데모 모드에서만 사용할 수 있습니다.',
    )
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Request aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, 150)
    signal?.addEventListener('abort', abort, { once: true })
  })
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
  const snapshot = createDemandSnapshot()
  snapshot.alerts = createDemandAlerts(snapshot, origin)
  return snapshot
}
