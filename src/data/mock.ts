import type {
  MapMarker,
  RecommendedPlace,
  RideRecord,
  SettingItem,
} from "../types/app"

// Static demonstration data; replace with API responses when the backend is connected.
export const mapMarkers: MapMarker[] = [
  { name: "강남역", hourlyRate: "3.2만 원", className: "pin-one" },
  { name: "교대역", hourlyRate: "2.8만 원", className: "pin-two" },
  { name: "신논현역", hourlyRate: "2.5만 원", className: "pin-three" },
]

export const recommendedPlaces: RecommendedPlace[] = [
  { name: "서울 삼성역", travelMinutes: 8, hourlyRate: "3.1" },
  { name: "서울 강남역", travelMinutes: 12, hourlyRate: "2.8" },
  { name: "서울 신논현역", travelMinutes: 16, hourlyRate: "2.5" },
]

export const calendarWeeks = [
  [27, 28, 29, 30, 1, 2, 3],
  [4, 5, 6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15, 16, 17],
  [18, 19, 20, 21, 22, 23, 24],
  [25, 26, 27, 28, 29, 30, 31],
]

export const recordDays = new Set([2, 3, 5, 6, 7, 13, 14, 17, 18, 22, 23, 24])

export const rideRecords: RideRecord[] = [
  {
    name: "잠실새내역 사거리",
    arrivalSummary: "22:25 도착 · 5분 머무름",
    recommendedHourlyRate: "2.1만 원",
    actualHourlyRate: "2.3만 원",
    extraProfit: "+1.4만 원",
  },
  {
    name: "종합 운동장역",
    arrivalSummary: "22:25 도착 · 5분 머무름",
    recommendedHourlyRate: "2.1만 원",
    actualHourlyRate: "2.3만 원",
    extraProfit: "+1.4만 원",
  },
  {
    name: "탄천교차로",
    arrivalSummary: "23:36 도착 · 3분 머무름",
    recommendedHourlyRate: "2.1만 원",
    actualHourlyRate: "2.3만 원",
    extraProfit: "+1.4만 원",
  },
]

export const settingItems: SettingItem[] = [
  {
    icon: "a4086.svg",
    title: "프로필 수정",
    description: "이름과 차량 정보를 관리해요",
  },
  { icon: "a6bb2.svg", title: "위치 권한", description: "항상 허용" },
  {
    icon: "11898.svg",
    title: "약관 확인",
    description: "서비스 이용약관과 개인정보 처리방침",
  },
  {
    icon: "bfbc9.svg",
    title: "알림 설정",
    description: "경유지 도착과 추천 알림",
  },
]
