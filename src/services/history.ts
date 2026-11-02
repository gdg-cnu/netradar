import { apiRequest } from './api'
import { readStored, writeStored } from '../utils/storage'
import type { TripRecord } from '../types/history'

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isTripRecord(value: unknown): value is TripRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as TripRecord
  return (
    typeof record.id === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
    typeof record.destination === 'string' &&
    Number.isFinite(record.startedAt) &&
    Number.isFinite(record.endedAt) &&
    record.endedAt >= record.startedAt &&
    [record.stops, record.passengers, record.revenue, record.cost].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) &&
    Number.isFinite(record.extraProfit)
  )
}

function readTrips(account?: string): TripRecord[] {
  const value = readStored<unknown>('trips', [], undefined, account)
  return Array.isArray(value) ? value.filter(isTripRecord) : []
}

/** Idempotent local history cache; live mode reads authoritative server records. */
export function saveTrip(record: TripRecord, account?: string): void {
  if (!isTripRecord(record)) throw new Error('저장할 운행기록을 확인해주세요.')
  const records = readTrips(account).filter((item) => item.id !== record.id)
  writeStored('trips', [record, ...records].slice(0, 500), account)
  window.dispatchEvent(new Event('netradar:trips-changed'))
}

export async function getTrips(month: string): Promise<TripRecord[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('조회할 월을 확인해주세요.')
  const records = await apiRequest<TripRecord[]>(
    `/me/trips?month=${encodeURIComponent(month)}`,
    {},
    () => readTrips().filter((record) => record.date.startsWith(`${month}-`)),
  )
  if (!Array.isArray(records) || !records.every(isTripRecord))
    throw new Error('운행기록 응답 형식을 확인할 수 없습니다.')
  return records
    .filter((record) => record.date.startsWith(`${month}-`))
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** Explicitly requested examples are never persisted or mixed into real history. */
export function exampleTrips(date: string): TripRecord[] {
  const start = new Date(`${date}T09:00:00`).getTime()
  return [
    {
      id: `example-${date}-1`,
      date,
      startedAt: start,
      endedAt: start + 45 * 60_000,
      destination: '강남역',
      stops: 2,
      passengers: 1,
      revenue: 24500,
      cost: 3800,
      extraProfit: 4200,
      demo: true,
    },
    {
      id: `example-${date}-2`,
      date,
      startedAt: start + 60 * 60_000,
      endedAt: start + 98 * 60_000,
      destination: '잠실역',
      stops: 1,
      passengers: 1,
      revenue: 19200,
      cost: 3100,
      extraProfit: 2800,
      demo: true,
    },
  ]
}
