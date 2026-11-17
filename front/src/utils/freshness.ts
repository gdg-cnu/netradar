export type FreshnessStatus = 'fresh' | 'stale' | 'unknown'

export const FRESHNESS_THRESHOLD_MS = 20 * 60 * 1000
// Allow at most one minute of clock skew; larger future dates cannot imply freshness.
export const ALLOWED_FUTURE_SKEW_MS = 60 * 1000

/** Require an explicit timezone so freshness never depends on the device timezone. */
export function getFreshnessTimestamp(generatedAt: string | undefined): number | null {
  if (typeof generatedAt !== 'string') return null
  const match = generatedAt.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i,
  )
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  )
    return null
  const timestamp = Date.parse(generatedAt)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function getFreshness(
  generatedAt: string | undefined,
  now = Date.now(),
): FreshnessStatus {
  const timestamp = getFreshnessTimestamp(generatedAt)
  if (
    timestamp === null ||
    !Number.isFinite(now) ||
    timestamp - now > ALLOWED_FUTURE_SKEW_MS
  )
    return 'unknown'
  return now - timestamp >= FRESHNESS_THRESHOLD_MS ? 'stale' : 'fresh'
}

/** The next status boundary, allowing a single timeout instead of polling. */
export function getFreshnessNextUpdateAt(
  generatedAt: string | undefined,
  now = Date.now(),
): number | null {
  const timestamp = getFreshnessTimestamp(generatedAt)
  if (timestamp === null || !Number.isFinite(now)) return null
  if (timestamp - now > ALLOWED_FUTURE_SKEW_MS) return timestamp - ALLOWED_FUTURE_SKEW_MS
  const staleAt = timestamp + FRESHNESS_THRESHOLD_MS
  return staleAt > now ? staleAt : null
}
