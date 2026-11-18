import { getStorageScope } from '../../utils/storage'

export function readSurgeAlertsEnabled(account = getStorageScope()): boolean {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`netradar:v2:${encodeURIComponent(account)}:preferences`) ??
        'null',
    )
    if (
      value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === 2 &&
      'surgeAlerts' in value &&
      typeof value.surgeAlerts === 'boolean'
    )
      return value.surgeAlerts
  } catch {
    /* Corrupt or unavailable preferences use the safe visible-alert default. */
  }
  return true
}

export function saveSurgeAlertsEnabled(
  enabled: boolean,
  account = getStorageScope(),
): boolean {
  try {
    localStorage.setItem(
      `netradar:v2:${encodeURIComponent(account)}:preferences`,
      JSON.stringify({ version: 2, surgeAlerts: enabled }),
    )
    window.dispatchEvent(new Event('netradar:v2-preferences'))
    return true
  } catch {
    window.dispatchEvent(new Event('netradar:storage-error'))
    return false
  }
}
