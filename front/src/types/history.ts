export interface TripRecord {
  id: string
  date: string
  startedAt: number
  endedAt: number
  destination: string
  stops: number
  passengers: number
  revenue: number
  cost: number
  extraProfit: number
  demo?: boolean
}
