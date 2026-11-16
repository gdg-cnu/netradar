export interface FavoritePlace {
  id: string
  label: string
  address: string
  lat: number
  lng: number
  kind: 'home' | 'lpg' | 'ev' | 'custom'
}

export interface UserProfile {
  name: string
  vehicleType: string
  notifications: boolean
  favorites: FavoritePlace[]
}
