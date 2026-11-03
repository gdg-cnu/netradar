export interface Coordinates {
  lat: number
  lng: number
}
export interface Place extends Coordinates {
  id: string
  name: string
  address: string
}
export type Detour = 'little' | 'normal' | 'much'
// Keep display limits and demo calculation aligned with backend DETOUR_RATIOS.
export const DETOUR_OPTIONS: ReadonlyArray<{
  value: Detour
  label: string
  percent: number
  demoStops: number
}> = [
  { value: 'little', label: '조금', percent: 15, demoStops: 1 },
  { value: 'normal', label: '보통', percent: 30, demoStops: 2 },
  { value: 'much', label: '많이', percent: 50, demoStops: 3 },
]
export function getDetourOption(detour: Detour) {
  return DETOUR_OPTIONS.find((option) => option.value === detour)!
}
/** Backend geometry uses [latitude, longitude], not GeoJSON's reversed order. */
export type RoutePoint = [lat: number, lng: number]
export type RoutePath = RoutePoint[]
export function isRoutePath(value: unknown): value is RoutePath {
  return (
    Array.isArray(value) &&
    (value.length === 0 || value.length >= 2) &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Math.abs(point[0]) <= 90 &&
        Number.isFinite(point[1]) &&
        Math.abs(point[1]) <= 180,
    )
  )
}
export interface RouteMetrics {
  minutes: number
  kilometers: number
  earnings: number
}
export interface RouteStop extends Place {
  waitMinutes: number
  expectedHourlyRate: number
}
export interface RouteRequest {
  origin: Coordinates
  destination: Place
  detour: Detour
  excludeStopIds?: string[]
}
export interface RoutePlan extends RouteRequest {
  id: string
  generatedAt: number
  demo: boolean
  direct: RouteMetrics
  recommended: RouteMetrics
  stops: RouteStop[]
  // Optional for saved legacy/demo plans; an empty path means geometry is unavailable.
  directPath?: RoutePath
  recommendedPath?: RoutePath
}
export type DrivePhase =
  'idle' | 'travelling' | 'waiting' | 'onboard' | 'needs-route' | 'finished'
export interface DriveTotals {
  revenue: number
  cost: number
  extraProfit: number
}
export interface TripEventResponse {
  accepted: boolean
  totals?: DriveTotals
}
export function isDriveTotals(value: unknown): value is DriveTotals {
  if (!value || typeof value !== 'object') return false
  const totals = value as DriveTotals
  return (
    [totals.revenue, totals.cost, totals.extraProfit].every(Number.isFinite) &&
    totals.revenue >= 0 &&
    totals.cost >= 0
  )
}
export function isTripEventResponse(
  value: unknown,
  requireTotals: boolean,
): value is TripEventResponse {
  if (!value || typeof value !== 'object') return false
  const result = value as TripEventResponse
  return (
    result.accepted === true &&
    (requireTotals
      ? isDriveTotals(result.totals)
      : result.totals === undefined || isDriveTotals(result.totals))
  )
}
export interface DriveState {
  version: 1
  phase: DrivePhase
  tripId: string | null
  plan: RoutePlan | null
  startedAt: number | null
  endedAt: number | null
  location: Coordinates | null
  stopIndex: number
  waitUntil: number | null
  onboardAt: number | null
  waitExtensions: number
  visitedStops: number
  passengers: number
  totals: DriveTotals
  revision: number
  lastMessage: string
}
export type DriveAction =
  | { type: 'START'; plan: RoutePlan; tripId: string; now: number }
  | { type: 'ARRIVE'; now: number }
  | { type: 'PICK_UP'; now: number }
  | {
      type: 'DROP_OFF'
      now: number
      fare: number
      location: Coordinates
      totals?: DriveTotals
    }
  | { type: 'SKIP'; now: number }
  | { type: 'EXTEND_WAIT'; now: number }
  | { type: 'RECOMMEND'; plan: RoutePlan; now: number }
  | { type: 'FINISH'; now: number; totals?: DriveTotals }
  | { type: 'RESET' }

export const emptyDrive: DriveState = {
  version: 1,
  phase: 'idle',
  tripId: null,
  plan: null,
  startedAt: null,
  endedAt: null,
  location: null,
  stopIndex: 0,
  waitUntil: null,
  onboardAt: null,
  waitExtensions: 0,
  visitedStops: 0,
  passengers: 0,
  totals: { revenue: 0, cost: 0, extraProfit: 0 },
  revision: 0,
  lastMessage: '',
}
export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false
  const p = value as Coordinates
  return (
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lng) <= 180
  )
}
export function isPlace(value: unknown): value is Place {
  if (!validCoordinates(value)) return false
  const p = value as Place
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    typeof p.address === 'string'
  )
}
function isMetrics(value: unknown): value is RouteMetrics {
  if (!value || typeof value !== 'object') return false
  const m = value as RouteMetrics
  return [m.minutes, m.kilometers, m.earnings].every((n) => Number.isFinite(n) && n >= 0)
}
export function isRoutePlan(value: unknown): value is RoutePlan {
  if (!value || typeof value !== 'object') return false
  const p = value as RoutePlan
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    Number.isFinite(p.generatedAt) &&
    typeof p.demo === 'boolean' &&
    validCoordinates(p.origin) &&
    isPlace(p.destination) &&
    ['little', 'normal', 'much'].includes(p.detour) &&
    (p.excludeStopIds === undefined ||
      (Array.isArray(p.excludeStopIds) &&
        p.excludeStopIds.every((id) => typeof id === 'string'))) &&
    (p.directPath === undefined || isRoutePath(p.directPath)) &&
    (p.recommendedPath === undefined || isRoutePath(p.recommendedPath)) &&
    isMetrics(p.direct) &&
    isMetrics(p.recommended) &&
    Array.isArray(p.stops) &&
    p.stops.every(
      (s) =>
        isPlace(s) &&
        Number.isFinite(s.waitMinutes) &&
        s.waitMinutes > 0 &&
        Number.isFinite(s.expectedHourlyRate) &&
        s.expectedHourlyRate >= 0,
    ) &&
    new Set(p.stops.map((s) => s.id)).size === p.stops.length
  )
}
export function isDriveState(value: unknown): value is DriveState {
  if (!value || typeof value !== 'object') return false
  const s = value as DriveState
  if (
    s.version !== 1 ||
    !['idle', 'travelling', 'waiting', 'onboard', 'needs-route', 'finished'].includes(
      s.phase,
    )
  )
    return false
  if (
    ![s.stopIndex, s.waitExtensions, s.visitedStops, s.passengers, s.revision].every(
      (n) => Number.isInteger(n) && n >= 0,
    )
  )
    return false
  if (
    !isDriveTotals(s.totals) ||
    s.waitExtensions > 2 ||
    typeof s.lastMessage !== 'string'
  )
    return false
  if (s.phase === 'idle') return s.plan === null && s.tripId === null
  return (
    typeof s.tripId === 'string' &&
    s.tripId.length > 0 &&
    isRoutePlan(s.plan) &&
    Number.isFinite(s.startedAt) &&
    validCoordinates(s.location) &&
    s.stopIndex < s.plan.stops.length &&
    (s.phase !== 'waiting' || Number.isFinite(s.waitUntil)) &&
    (s.phase !== 'onboard' || Number.isFinite(s.onboardAt)) &&
    (s.phase !== 'finished' || (Number.isFinite(s.endedAt) && s.endedAt! >= s.startedAt!))
  )
}
/** Pure state transitions. Invalid/repeated events leave the state unchanged. */
export function driveReducer(state: DriveState, action: DriveAction): DriveState {
  if ('now' in action && (!Number.isFinite(action.now) || action.now < 0)) return state
  if ('totals' in action && action.totals !== undefined && !isDriveTotals(action.totals))
    return state
  if (action.type === 'RESET')
    return state.phase === 'finished' ? { ...emptyDrive } : state
  if (action.type === 'START') {
    if (
      !['idle', 'finished'].includes(state.phase) ||
      !action.tripId ||
      !isRoutePlan(action.plan) ||
      action.plan.stops.length === 0
    )
      return state
    return {
      ...emptyDrive,
      phase: 'travelling',
      tripId: action.tripId,
      plan: action.plan,
      startedAt: action.now,
      location: action.plan.origin,
      revision: 1,
      lastMessage: '첫 경유지로 이동을 시작했어요.',
    }
  }
  if (!state.plan || state.phase === 'idle' || state.phase === 'finished') return state
  const next = { ...state, revision: state.revision + 1 }
  switch (action.type) {
    case 'ARRIVE': {
      if (state.phase !== 'travelling') return state
      const stop = state.plan.stops[state.stopIndex]
      return {
        ...next,
        phase: 'waiting',
        location: { lat: stop.lat, lng: stop.lng },
        waitUntil: action.now + stop.waitMinutes * 60_000,
        waitExtensions: 0,
        visitedStops: state.visitedStops + 1,
        lastMessage: '경유지에 도착했어요. 안전한 곳에서 대기해 주세요.',
      }
    }
    case 'PICK_UP':
      if (state.phase !== 'waiting') return state
      return {
        ...next,
        phase: 'onboard',
        waitUntil: null,
        onboardAt: action.now,
        passengers: state.passengers + 1,
        lastMessage: '승객이 탑승했어요. 안전 운전하세요.',
      }
    case 'DROP_OFF': {
      if (
        state.phase !== 'onboard' ||
        !Number.isFinite(action.fare) ||
        action.fare < 0 ||
        !validCoordinates(action.location)
      )
        return state
      const totals = action.totals ?? {
        ...state.totals,
        revenue: state.totals.revenue + action.fare,
        cost: state.totals.cost + (state.plan.demo ? 1500 : 0),
        extraProfit:
          state.totals.extraProfit +
          (state.plan.demo ? Math.round(action.fare * 0.12) : 0),
      }
      return {
        ...next,
        phase: 'needs-route',
        location: action.location,
        onboardAt: null,
        totals,
        lastMessage: '하차를 기록했어요. 현재 위치에서 동선을 다시 추천받으세요.',
      }
    }
    case 'SKIP':
      if (state.phase !== 'travelling' && state.phase !== 'waiting') return state
      return {
        ...next,
        phase: 'needs-route',
        waitUntil: null,
        lastMessage: '이번 경유지를 건너뛰었어요. 새로운 동선을 선택해 주세요.',
      }
    case 'EXTEND_WAIT':
      if (state.phase !== 'waiting' || state.waitExtensions >= 2) return state
      return {
        ...next,
        waitUntil: Math.max(action.now, state.waitUntil ?? action.now) + 120_000,
        waitExtensions: state.waitExtensions + 1,
        lastMessage: '대기 시간을 2분 연장했어요.',
      }
    case 'RECOMMEND':
      if (
        state.phase !== 'needs-route' ||
        !isRoutePlan(action.plan) ||
        action.plan.stops.length === 0 ||
        action.plan.demo !== state.plan.demo
      )
        return state
      return {
        ...next,
        phase: 'travelling',
        plan: action.plan,
        stopIndex: 0,
        waitUntil: null,
        waitExtensions: 0,
        lastMessage: '새 경유지로 이동을 시작했어요.',
      }
    case 'FINISH':
      // A passenger must be dropped off before ending a drive.
      if (state.phase === 'onboard') return state
      return {
        ...next,
        phase: 'finished',
        endedAt: action.now,
        waitUntil: null,
        totals: action.totals ?? state.totals,
        lastMessage: '운행을 마쳤어요. 운행 기록에 저장했어요.',
      }
    default:
      return state
  }
}
