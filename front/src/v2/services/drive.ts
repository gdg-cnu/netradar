import { getStorageScope } from '../../utils/storage'
import { createDemandSnapshot, demandPoint, distanceKm, kstDateKey } from './demand'
import type { DemandOffset, DemandPlace, DemandSnapshot } from '../types/demand'
import type {
  DemandDriveAction,
  DemandDriveState,
  DemandOrigin,
  DemandPlan,
  DemandRouteDraft,
  DemandStop,
  DemandTrip,
  DemandVisit,
} from '../types/drive'

export const DEMAND_DRIVE_EVENT = 'netradar:v2-drive-change'
const MINUTE = 60_000
export const DETOUR_MOCK_NOTE =
  '이동 시간과 우회 선택은 시연용입니다. 실제 도로 우회율을 계산하지 않습니다.'
export const defaultDemandDraft = (): DemandRouteDraft => ({
  origin: null,
  destination: null,
  destinationId: null,
  targetPlaceId: null,
  detour: 30,
  plan: null,
})

export function placeOrigin(place: DemandPlace): DemandOrigin {
  return { id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: 'place' }
}

/** Uses a straight-line fixture assumption, never actual road/traffic information. */
export function createDemandPlan(
  draft: Pick<
    DemandRouteDraft,
    'origin' | 'destination' | 'destinationId' | 'targetPlaceId' | 'detour'
  >,
  snapshot: DemandSnapshot = createDemandSnapshot(),
  excludeIds: string[] = [],
): DemandPlan {
  if (!draft.origin || !validOrigin(draft.origin))
    throw new Error('출발지를 선택해 주세요.')
  if (draft.destination !== null && !validOrigin(draft.destination))
    throw new Error('목적지 좌표를 다시 확인해 주세요.')
  if (![15, 30, 50].includes(draft.detour)) throw new Error('우회 범위를 선택해 주세요.')
  const destination =
    draft.destination ?? snapshot.places.find((place) => place.id === draft.destinationId)
  if (draft.destinationId && !destination) throw new Error('목적지를 다시 선택해 주세요.')
  if (draft.targetPlaceId && !snapshot.places.some((p) => p.id === draft.targetPlaceId)) {
    throw new Error('지도에서 선택한 장소가 없습니다. 다른 장소를 선택해 주세요.')
  }
  const stops: DemandStop[] = []
  let from = draft.origin
  let elapsed = 0
  const limit = ({ 15: 1, 30: 2, 50: 3 } as const)[draft.detour]
  const candidates = snapshot.places.filter(
    (place) =>
      !excludeIds.includes(place.id) &&
      (place.id !== draft.origin?.id || place.id === draft.targetPlaceId) &&
      (place.id !== draft.destinationId || place.id === draft.targetPlaceId),
  )
  while (stops.length < limit && candidates.length) {
    const scored = candidates
      .map((place) => {
        const travelMinutes = Math.max(5, Math.round(distanceKm(from, place) * 2.5 + 5))
        const arrivalMinutes = elapsed + travelMinutes
        const forecastOffset: DemandOffset =
          arrivalMinutes <= 15 ? 0 : arrivalMinutes <= 45 ? 30 : 60
        return {
          place,
          travelMinutes,
          arrivalMinutes,
          forecastOffset,
          // A +60 fixture must not be described as a forecast beyond its horizon.
          surgeIndexAtArrival:
            arrivalMinutes > 60 ? null : demandPoint(place, forecastOffset).surgeIndex,
        }
      })
      .sort(
        (a, b) =>
          (b.surgeIndexAtArrival ?? -1) - (a.surgeIndexAtArrival ?? -1) ||
          a.arrivalMinutes - b.arrivalMinutes ||
          a.place.id.localeCompare(b.place.id),
      )
    const choice =
      (stops.length === 0 && draft.targetPlaceId
        ? scored.find((item) => item.place.id === draft.targetPlaceId)
        : undefined) ?? scored[0]
    stops.push({
      placeId: choice.place.id,
      name: choice.place.name,
      lat: choice.place.lat,
      lng: choice.place.lng,
      travelMinutes: choice.travelMinutes,
      arrivalMinutes: choice.arrivalMinutes,
      forecastOffset: choice.forecastOffset,
      surgeIndexAtArrival: choice.surgeIndexAtArrival,
      reason: choice.place.reasons[0],
      waitMinutes: 3,
    })
    candidates.splice(
      candidates.findIndex((place) => place.id === choice.place.id),
      1,
    )
    from = placeOrigin(choice.place)
    elapsed = choice.arrivalMinutes + 3
  }
  if (!stops.length)
    throw new Error('추천할 예시 장소가 없습니다. 출발지나 목적지를 바꿔 주세요.')
  return {
    id: `plan-${crypto.randomUUID()}`,
    source: 'mock',
    generatedAt: Date.parse(snapshot.generatedAt),
    origin: { ...draft.origin },
    destination: destination
      ? {
          id: destination.id,
          name: destination.name,
          lat: destination.lat,
          lng: destination.lng,
          kind: 'place',
        }
      : null,
    destinationId: destination?.id ?? null,
    destinationName: destination?.name ?? null,
    detour: draft.detour,
    stops,
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => number(value) && value >= 0
const timestamp = (value: unknown): value is number =>
  nonnegative(value) && value <= 8_640_000_000_000_000
const integer = (value: unknown): value is number =>
  nonnegative(value) && Number.isInteger(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0
function validOrigin(value: unknown): value is DemandOrigin {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    number(value.lat) &&
    Math.abs(value.lat) <= 90 &&
    number(value.lng) &&
    Math.abs(value.lng) <= 180 &&
    (value.kind === 'place' || value.kind === 'current')
  )
}
function validStop(value: unknown): value is DemandStop {
  return (
    record(value) &&
    text(value.placeId) &&
    text(value.name) &&
    number(value.lat) &&
    Math.abs(value.lat) <= 90 &&
    number(value.lng) &&
    Math.abs(value.lng) <= 180 &&
    nonnegative(value.travelMinutes) &&
    nonnegative(value.arrivalMinutes) &&
    [0, 30, 60].includes(value.forecastOffset as number) &&
    (value.surgeIndexAtArrival === null ||
      (nonnegative(value.surgeIndexAtArrival) && value.surgeIndexAtArrival <= 100)) &&
    typeof value.reason === 'string' &&
    number(value.waitMinutes) &&
    value.waitMinutes > 0
  )
}
export function isDemandPlan(value: unknown): value is DemandPlan {
  return (
    record(value) &&
    text(value.id) &&
    value.source === 'mock' &&
    timestamp(value.generatedAt) &&
    validOrigin(value.origin) &&
    (value.destination === null || validOrigin(value.destination)) &&
    (value.destinationId === null || text(value.destinationId)) &&
    (value.destinationName === null || text(value.destinationName)) &&
    [15, 30, 50].includes(value.detour as number) &&
    Array.isArray(value.stops) &&
    value.stops.length > 0 &&
    value.stops.length <= 3 &&
    value.stops.every(validStop) &&
    new Set(value.stops.map((stop) => stop.placeId)).size === value.stops.length
  )
}
function validDraft(value: unknown): value is DemandRouteDraft {
  return (
    record(value) &&
    (value.origin === null || validOrigin(value.origin)) &&
    (value.destination === null || validOrigin(value.destination)) &&
    (value.destinationId === null || text(value.destinationId)) &&
    (value.targetPlaceId === null || text(value.targetPlaceId)) &&
    [15, 30, 50].includes(value.detour as number) &&
    (value.plan === null || isDemandPlan(value.plan))
  )
}
function validVisit(value: unknown): value is DemandVisit {
  return (
    record(value) &&
    text(value.placeId) &&
    text(value.name) &&
    timestamp(value.arrivedAt) &&
    typeof value.pickedUp === 'boolean' &&
    integer(value.fare) &&
    value.fare <= 1_000_000 &&
    typeof value.fareRecorded === 'boolean' &&
    (value.fareRecorded ? value.pickedUp : value.fare === 0)
  )
}
export function isDemandTrip(value: unknown): value is DemandTrip {
  return (
    record(value) &&
    text(value.id) &&
    value.source === 'mock' &&
    typeof value.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    timestamp(value.startedAt) &&
    timestamp(value.endedAt) &&
    value.endedAt >= value.startedAt &&
    Array.isArray(value.stopNames) &&
    value.stopNames.every(text) &&
    integer(value.passengers) &&
    integer(value.fare) &&
    integer(value.fareRecordedCount) &&
    nonnegative(value.durationMinutes) &&
    text(value.originName) &&
    (value.destinationName === null || text(value.destinationName)) &&
    Array.isArray(value.visits) &&
    value.visits.every(validVisit) &&
    value.passengers === value.visits.filter((visit) => visit.pickedUp).length &&
    value.fare === value.visits.reduce((sum, visit) => sum + visit.fare, 0) &&
    value.fareRecordedCount ===
      value.visits.filter((visit) => visit.fareRecorded).length &&
    value.stopNames.length === value.visits.length &&
    value.stopNames.every(
      (name, index) => name === (value.visits as DemandVisit[])[index].name,
    ) &&
    value.date === kstDateKey(value.endedAt)
  )
}
function validState(value: unknown): value is DemandDriveState {
  if (!record(value) || !isDemandPlan(value.plan)) return false
  return (
    text(value.id) &&
    value.source === 'mock' &&
    integer(value.revision) &&
    ['travelling', 'waiting', 'onboard', 'next', 'finished'].includes(
      value.phase as string,
    ) &&
    timestamp(value.startedAt) &&
    (value.phase === 'finished'
      ? timestamp(value.endedAt) && value.endedAt >= value.startedAt
      : value.endedAt === null) &&
    text(value.initialOriginName) &&
    integer(value.stopIndex) &&
    value.stopIndex < value.plan.stops.length &&
    (value.phase === 'waiting' ? timestamp(value.waitUntil) : value.waitUntil === null) &&
    integer(value.waitExtensions) &&
    value.waitExtensions <= 2 &&
    integer(value.passengers) &&
    integer(value.fare) &&
    Array.isArray(value.visits) &&
    value.visits.every(validVisit) &&
    value.passengers === value.visits.filter((visit) => visit.pickedUp).length &&
    value.fare === value.visits.reduce((sum, visit) => sum + visit.fare, 0) &&
    (!['waiting', 'onboard'].includes(value.phase as string) ||
      (value.visits.length > 0 &&
        value.visits[value.visits.length - 1].placeId ===
          value.plan.stops[value.stopIndex].placeId &&
        value.visits[value.visits.length - 1].pickedUp ===
          (value.phase === 'onboard'))) &&
    validOrigin(value.lastLocation) &&
    typeof value.message === 'string'
  )
}

interface DemandStorage {
  version: 2
  draft: DemandRouteDraft
  drive: DemandDriveState | null
  trips: DemandTrip[]
}
export const demandStorageKey = (account = getStorageScope()) =>
  `netradar:v2:${encodeURIComponent(account)}:demand-drive`
function emptyStorage(): DemandStorage {
  return { version: 2, draft: defaultDemandDraft(), drive: null, trips: [] }
}
function readStorage(account: string): DemandStorage {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(demandStorageKey(account)) ?? 'null',
    )
    if (!record(raw) || raw.version !== 2) return emptyStorage()
    return {
      version: 2,
      draft: validDraft(raw.draft) ? raw.draft : defaultDemandDraft(),
      drive: validState(raw.drive) ? raw.drive : null,
      trips: Array.isArray(raw.trips)
        ? raw.trips
            .filter(isDemandTrip)
            .filter(
              (trip, index, list) =>
                list.findIndex((item) => item.id === trip.id) === index,
            )
        : [],
    }
  } catch {
    return emptyStorage()
  }
}
function saveStorage(value: DemandStorage, account: string) {
  try {
    localStorage.setItem(demandStorageKey(account), JSON.stringify(value))
  } catch {
    throw new Error(
      '이 브라우저에 운행을 저장할 수 없습니다. 저장 공간·사이트 권한을 확인한 후 다시 시도해 주세요.',
    )
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMAND_DRIVE_EVENT))
}
export const readDemandDraft = (account = getStorageScope()) => readStorage(account).draft
export const readDemandDrive = (account = getStorageScope()) => readStorage(account).drive
export const readDemandTrips = (account = getStorageScope()): DemandTrip[] =>
  readStorage(account).trips
export function saveDemandDraft(draft: DemandRouteDraft, account = getStorageScope()) {
  if (!validDraft(draft)) throw new Error('동선 선택을 다시 확인해 주세요.')
  saveStorage({ ...readStorage(account), draft }, account)
}

export function startDemandDrive(
  plan: DemandPlan,
  account = getStorageScope(),
  now = Date.now(),
): DemandDriveState {
  if (!isDemandPlan(plan)) throw new Error('목업 동선을 다시 추천받아 주세요.')
  const stored = readStorage(account)
  if (stored.drive && stored.drive.phase !== 'finished') return stored.drive
  const drive: DemandDriveState = {
    id: `v2-trip-${crypto.randomUUID()}`,
    source: 'mock',
    revision: 0,
    phase: 'travelling',
    startedAt: now,
    endedAt: null,
    initialOriginName: plan.origin.name,
    plan,
    stopIndex: 0,
    waitUntil: null,
    waitExtensions: 0,
    passengers: 0,
    fare: 0,
    visits: [],
    lastLocation: plan.origin,
    message: '목업 이동을 시작했어요. 실제 길 안내가 아닙니다.',
  }
  saveStorage({ ...stored, drive }, account)
  return drive
}

/** Pure transition: every mutation requires the latest revision at the storage boundary. */
export function transitionDemandDrive(
  state: DemandDriveState,
  action: DemandDriveAction,
  now = Date.now(),
): DemandDriveState {
  if (state.phase === 'finished') return state
  const next: DemandDriveState = {
    ...state,
    revision: state.revision + 1,
    visits: state.visits.map((visit) => ({ ...visit })),
  }
  const stop = state.plan.stops[state.stopIndex]
  const reject = () => {
    throw new Error('운행 상태가 바뀌었어요. 현재 화면에서 다시 선택해 주세요.')
  }
  switch (action.type) {
    case 'arrive':
      if (state.phase !== 'travelling') return reject()
      next.phase = 'waiting'
      next.waitUntil = now + stop.waitMinutes * MINUTE
      next.waitExtensions = 0
      next.lastLocation = {
        id: stop.placeId,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        kind: 'place',
      }
      next.visits.push({
        placeId: stop.placeId,
        name: stop.name,
        arrivedAt: now,
        pickedUp: false,
        fare: 0,
        fareRecorded: false,
      })
      next.message = `${stop.name} 도착을 기록했어요. ${stop.waitMinutes}분 대기를 시작합니다.`
      break
    case 'extend':
      if (state.phase !== 'waiting' || state.waitExtensions >= 2) return reject()
      next.waitUntil = Math.max(now, state.waitUntil ?? now) + 2 * MINUTE
      next.waitExtensions += 1
      next.message = `대기 시간을 2분 연장했어요. (${next.waitExtensions}/2)`
      break
    case 'pickup':
      if (state.phase !== 'waiting' || !next.visits.length) return reject()
      next.phase = 'onboard'
      next.waitUntil = null
      next.passengers += 1
      next.visits[next.visits.length - 1].pickedUp = true
      next.message = '목업 승객 탑승을 기록했어요. 하차 후 종료할 수 있습니다.'
      break
    case 'skip':
      if (state.phase !== 'waiting' && state.phase !== 'travelling') return reject()
      next.waitUntil = null
      next.waitExtensions = 0
      if (state.stopIndex + 1 < state.plan.stops.length) {
        next.stopIndex += 1
        next.phase = 'travelling'
        next.message = `${state.plan.stops[next.stopIndex].name}(으)로 목업 이동합니다.`
      } else {
        next.phase = 'next'
        next.message =
          '추천 장소를 모두 확인했어요. 다시 추천받거나 운행을 종료해 주세요.'
      }
      break
    case 'dropoff':
      if (state.phase !== 'onboard' || !next.visits.length) return reject()
      if (
        action.fare !== null &&
        (!Number.isInteger(action.fare) || action.fare < 0 || action.fare > 1_000_000)
      )
        throw new Error('요금은 0~1,000,000원 사이의 정수로 입력해 주세요.')
      if (!validOrigin(action.location))
        throw new Error('하차 예시 장소를 선택해 주세요.')
      next.phase = 'next'
      next.fare += action.fare ?? 0
      next.visits[next.visits.length - 1].fare = action.fare ?? 0
      next.visits[next.visits.length - 1].fareRecorded = action.fare !== null
      next.lastLocation = { ...action.location }
      next.message = `${action.location.name}에서 목업 하차를 기록했어요.${action.fare === null ? ' 요금은 입력하지 않았습니다.' : ''}`
      break
    case 'reroute':
      if (state.phase !== 'next') return reject()
      if (!isDemandPlan(action.plan)) throw new Error('추천 동선을 다시 확인해 주세요.')
      next.plan = action.plan
      next.stopIndex = 0
      next.waitExtensions = 0
      next.waitUntil = null
      next.phase = 'travelling'
      next.message = '마지막으로 기록한 예시 위치에서 수요 지수로 다시 추천했어요.'
      break
    case 'finish':
      if (state.phase === 'onboard')
        throw new Error('승객 하차를 기록한 후 운행을 종료할 수 있어요.')
      next.phase = 'finished'
      next.waitUntil = null
      next.endedAt = Math.max(now, state.startedAt)
      next.message = '목업 운행 기록을 이 브라우저에 저장했어요.'
      break
  }
  return next
}

export function demandTripFromState(state: DemandDriveState): DemandTrip {
  if (state.phase !== 'finished' || state.endedAt === null)
    throw new Error('아직 종료되지 않은 운행입니다.')
  return {
    id: state.id,
    source: 'mock',
    date: kstDateKey(state.endedAt),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    stopNames: state.visits.map((visit) => visit.name),
    passengers: state.passengers,
    fare: state.fare,
    fareRecordedCount: state.visits.filter((visit) => visit.fareRecorded).length,
    durationMinutes: Math.max(0, Math.round((state.endedAt - state.startedAt) / MINUTE)),
    originName: state.initialOriginName,
    destinationName: state.plan.destinationName,
    visits: state.visits.map((visit) => ({ ...visit })),
  }
}

export function applyDemandDriveAction(
  id: string,
  revision: number,
  action: DemandDriveAction,
  account = getStorageScope(),
  now = Date.now(),
): DemandDriveState {
  const stored = readStorage(account)
  const current = stored.drive
  if (!current || current.id !== id)
    throw new Error('진행 중인 운행을 다시 확인해 주세요.')
  // Stale buttons, repeated clicks, and a second finish never replay an event.
  if (current.revision !== revision || current.phase === 'finished') return current
  const drive = transitionDemandDrive(current, action, now)
  const trips =
    drive.phase === 'finished' && !stored.trips.some((trip) => trip.id === drive.id)
      ? [demandTripFromState(drive), ...stored.trips]
      : stored.trips
  // One document makes finishing and writing its history one storage operation.
  saveStorage({ ...stored, drive, trips }, account)
  return drive
}

export function demandWaitSeconds(state: DemandDriveState, now = Date.now()) {
  return Math.max(0, Math.ceil(((state.waitUntil ?? now) - now) / 1000))
}
