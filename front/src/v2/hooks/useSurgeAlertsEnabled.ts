import { useEffect, useState } from 'react'
import { readSurgeAlertsEnabled } from '../services/preferences'

export function useSurgeAlertsEnabled() {
  const [enabled, setEnabled] = useState(() => readSurgeAlertsEnabled())
  useEffect(() => {
    const update = () => setEnabled(readSurgeAlertsEnabled())
    window.addEventListener('netradar:v2-preferences', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('netradar:v2-preferences', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return enabled
}
