import type { DemandOffset } from './demand'

/** Frontend mock state only; this is not an API contract. */
export type DemandDetour = 15 | 30 | 50
export interface DemandOrigin {
  id: string
  name: string
  lat: number
  lng: number
  kind: 'place' | 'current'
}
export interface DemandStop {
  placeId: string
  name: string
  lat: number
  lng: number
  travelMinutes: number
  arrivalMinutes: number
  forecastOffset: DemandOffset
  surgeIndexAtArrival: number | null
  reason: string
  waitMinutes: number
}
export interface DemandPlan {
  id: string
  source: 'mock'
  generatedAt: number
  origin: DemandOrigin
  destination: DemandOrigin | null
  destinationId: string | null
  destinationName: string | null
  detour: DemandDetour
  stops: DemandStop[]
}
export interface DemandRouteDraft {
  origin: DemandOrigin | null
  destination: DemandOrigin | null
  destinationId: string | null
  targetPlaceId: string | null
  detour: DemandDetour
  plan: DemandPlan | null
}
export interface DemandVisit {
  placeId: string
  name: string
  arrivedAt: number
  pickedUp: boolean
  fare: number
  fareRecorded: boolean
}
export interface DemandTrip {
  id: string
  source: 'mock'
  date: string
  startedAt: number
  endedAt: number
  stopNames: string[]
  passengers: number
  fare: number
  fareRecordedCount: number
  durationMinutes: number
  originName: string
  destinationName: string | null
  visits: DemandVisit[]
}
export type DemandDrivePhase = 'travelling' | 'waiting' | 'onboard' | 'next' | 'finished'
export interface DemandDriveState {
  id: string
  source: 'mock'
  revision: number
  phase: DemandDrivePhase
  startedAt: number
  endedAt: number | null
  initialOriginName: string
  plan: DemandPlan
  stopIndex: number
  waitUntil: number | null
  waitExtensions: number
  passengers: number
  fare: number
  visits: DemandVisit[]
  lastLocation: DemandOrigin
  message: string
}
export type DemandDriveAction =
  | { type: 'arrive' }
  | { type: 'extend' }
  | { type: 'pickup' }
  | { type: 'skip' }
  | { type: 'dropoff'; fare: number | null; location: DemandOrigin }
  | { type: 'reroute'; plan: DemandPlan }
  | { type: 'finish' }
