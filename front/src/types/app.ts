export type Page = 'map' | 'route' | 'drive' | 'replay' | 'mypage'

export interface NavigationItem {
  id: Page
  label: string
  icon: string
}
