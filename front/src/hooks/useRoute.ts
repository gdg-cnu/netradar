import { useEffect, useState } from 'react'
import { getRoute, navigateTo } from '../utils/navigation'

export function useRoute() {
  const [route, setRoute] = useState(getRoute)
  useEffect(() => {
    const update = () => {
      setRoute(getRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return { ...route, navigateTo }
}
