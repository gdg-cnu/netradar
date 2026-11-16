let scope = 'demo'

export function setStorageScope(next: string) {
  scope = next
}

export function getStorageScope() {
  return scope
}

function storageKey(key: string, account = scope) {
  return `netradar:v1:${account}:${key}`
}

export function readStored<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => boolean,
  account = scope,
): T {
  try {
    const raw = localStorage.getItem(storageKey(key, account))
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    if (validate && !validate(value)) return fallback
    return value as T
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown, account = scope): void {
  try {
    localStorage.setItem(storageKey(key, account), JSON.stringify(value))
  } catch {
    window.dispatchEvent(new Event('netradar:storage-error'))
  }
}
