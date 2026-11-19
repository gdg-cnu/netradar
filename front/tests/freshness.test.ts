import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_FUTURE_SKEW_MS,
  FRESHNESS_THRESHOLD_MS,
  getFreshness,
  getFreshnessNextUpdateAt,
  getFreshnessTimestamp,
} from '../src/utils/freshness.ts'

const generatedAt = '2026-11-17T09:00:00+09:00'
const generatedMs = Date.parse(generatedAt)

test('data becomes stale at exactly 20 minutes, independently of the timezone offset', () => {
  assert.equal(getFreshness(generatedAt, generatedMs), 'fresh')
  assert.equal(
    getFreshness(generatedAt, generatedMs + FRESHNESS_THRESHOLD_MS - 1),
    'fresh',
  )
  assert.equal(getFreshness(generatedAt, generatedMs + FRESHNESS_THRESHOLD_MS), 'stale')
  assert.equal(
    getFreshness('2026-11-17T00:00:00Z', generatedMs + FRESHNESS_THRESHOLD_MS),
    'stale',
  )
  assert.equal(getFreshness(generatedAt, generatedMs + 24 * 60 * 60 * 1000), 'stale')
})

test('missing, ambiguous and impossible timestamps never appear fresh', () => {
  for (const input of [
    undefined,
    '',
    'not-a-date',
    '2026-11-17',
    '2026-11-17T09:00:00',
    '2026-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-11-17T24:00:00Z',
    '2026-11-17T00:00:00+24:00',
  ]) {
    assert.equal(getFreshness(input, generatedMs), 'unknown', String(input))
    assert.equal(getFreshnessNextUpdateAt(input, generatedMs), null, String(input))
  }
  assert.equal(getFreshness(generatedAt, Number.NaN), 'unknown')
  assert.equal(getFreshnessNextUpdateAt(generatedAt, Number.POSITIVE_INFINITY), null)
})

test('ISO timestamps accept leap days and server fractional seconds with explicit timezone', () => {
  assert.equal(
    getFreshnessTimestamp('2024-02-29T00:00:00.123456+00:00'),
    Date.parse('2024-02-29T00:00:00.123Z'),
  )
  assert.equal(getFreshnessTimestamp('2026-11-17T00:00:00.000Z'), generatedMs)
})

test('future clock skew is tolerated only up to 60 seconds and cannot extend the age limit', () => {
  assert.equal(getFreshness(generatedAt, generatedMs - ALLOWED_FUTURE_SKEW_MS), 'fresh')
  assert.equal(
    getFreshness(generatedAt, generatedMs - ALLOWED_FUTURE_SKEW_MS - 1),
    'unknown',
  )
  assert.equal(
    getFreshnessNextUpdateAt(generatedAt, generatedMs - ALLOWED_FUTURE_SKEW_MS),
    generatedMs + FRESHNESS_THRESHOLD_MS,
  )
})

test('the next update points to the single future status boundary, then stops scheduling', () => {
  const futureCheckAt = getFreshnessNextUpdateAt(
    generatedAt,
    generatedMs - ALLOWED_FUTURE_SKEW_MS - 1,
  )
  assert.equal(futureCheckAt, generatedMs - ALLOWED_FUTURE_SKEW_MS)
  assert.equal(getFreshness(generatedAt, futureCheckAt!), 'fresh')
  const staleAt = getFreshnessNextUpdateAt(generatedAt, generatedMs)
  assert.equal(staleAt, generatedMs + FRESHNESS_THRESHOLD_MS)
  assert.equal(getFreshness(generatedAt, staleAt!), 'stale')
  assert.equal(getFreshnessNextUpdateAt(generatedAt, staleAt!), null)
})
