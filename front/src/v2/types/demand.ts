/** Shared view models. Server transport contracts are in serverDemand.ts. */
export type DemandOffset = 0 | 30 | 60
export type DemandMetric = 'surge' | 'population'
export type EventType = 'airport' | 'concert' | 'train' | 'last_train'
export type DemandPlaceType = EventType | 'seoul_rtd' | 'venue'
export type DemandSource = 'mock' | 'model'
export type DemandRange = 'low' | 'moderate' | 'high'
/** GeoJSON order [longitude, latitude]; mock polygons are closed exterior rings. */
export type PolygonCoordinate = [number, number]
export type Bounds = { west: number; south: number; east: number; north: number }
export interface DemandPoint {
  offset: DemandOffset
  surgeIndex: number
  population: number | null
  range: DemandRange
  populationRange: DemandRange | null
}
export interface DemandPlace {
  id: string
  name: string
  type: DemandPlaceType
  lat: number
  lng: number
  polygon: PolygonCoordinate[]
  points: DemandPoint[]
  reasons: string[]
  taxiStands: { name: string; description: string }[]
}
export interface DemandEvent {
  id: string
  placeId: string
  type: EventType
  title: string
  peakAt: string
  endsAt: string
  expectedExits: number | null
  source: string
}
export interface DemandAlert {
  id: string
  placeId: string
  reason: string
  recommendedDepartureAt: string
  arrivalAt: string
  peakStart: string
  peakEnd: string
  travelMinutes: number
  surgeIndexAtArrival: number
}
export interface DemandSnapshot {
  source: DemandSource
  generatedAt: string
  places: DemandPlace[]
  events: DemandEvent[]
  alerts: DemandAlert[]
}
