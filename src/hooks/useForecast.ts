import { useEffect, useState } from 'react'
import { getForecast } from '../services/forecast'
import type { ForecastHorizon, ForecastMetric, ForecastResponse } from '../types/forecast'

export function useForecast(metric: ForecastMetric, horizon: ForecastHorizon) {
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setData(null)
    getForecast(metric, horizon, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : '예측을 불러오지 못했습니다.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [metric, horizon, attempt])

  return { data, loading, error, retry: () => setAttempt((value) => value + 1) }
}
