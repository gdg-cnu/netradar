export type Page = "map" | "route" | "replay" | "mypage"

export interface NavigationItem {
  id: Page
  label: string
  icon: string
}

export interface MapMarker {
  name: string
  hourlyRate: string
  className: string
}

export interface RecommendedPlace {
  name: string
  travelMinutes: number
  hourlyRate: string
}

export interface RideRecord {
  name: string
  arrivalSummary: string
  recommendedHourlyRate: string
  actualHourlyRate: string
  extraProfit: string
}

export interface SettingItem {
  icon: string
  title: string
  description: string
}
