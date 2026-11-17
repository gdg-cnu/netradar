import { useEffect, useState } from 'react'
import {
  getFreshness,
  getFreshnessNextUpdateAt,
  type FreshnessStatus,
} from '../utils/freshness'

const MAX_TIMEOUT_MS = 2_147_483_647

export function useFreshness(generatedAt: string | undefined): FreshnessStatus {
  const [snapshot, setSnapshot] = useState(() => ({
    generatedAt,
    status: getFreshness(generatedAt),
  }))

  useEffect(() => {
    let timeout: number | undefined
    const update = () => {
      window.clearTimeout(timeout)
      const now = Date.now()
      const status = getFreshness(generatedAt, now)
      setSnapshot((previous) =>
        previous.generatedAt === generatedAt && previous.status === status
          ? previous
          : { generatedAt, status },
      )
      const nextUpdateAt = getFreshnessNextUpdateAt(generatedAt, now)
      if (nextUpdateAt !== null && document.visibilityState !== 'hidden') {
        timeout = window.setTimeout(
          update,
          Math.min(MAX_TIMEOUT_MS, Math.max(1, nextUpdateAt - now)),
        )
      }
    }

    update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [generatedAt])

  // A replacement response must not render with the preceding response's status.
  return snapshot.generatedAt === generatedAt
    ? snapshot.status
    : getFreshness(generatedAt)
}
