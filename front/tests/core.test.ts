import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRoute, navigateTo } from '../src/utils/navigation.ts'
import { readStored, setStorageScope, writeStored } from '../src/utils/storage.ts'

test('hash routing preserves destination params and rejects unknown routes', () => {
  const location = { hash: '#/route?destination=%EA%B0%95%EB%82%A8&lat=37.5' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })
  assert.deepEqual(getRoute(), {
    page: 'route',
    params: { destination: '강남', lat: '37.5' },
  })
  navigateTo('drive')
  assert.equal(location.hash, '/drive')
  location.hash = '#/unknown'
  assert.equal(getRoute().page, 'map')
})

test('storage isolates accounts and recovers malformed or invalid values', () => {
  const entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    },
  })
  setStorageScope('demo')
  writeStored('profile', { name: '데모' })
  setStorageScope('user-a')
  assert.deepEqual(readStored('profile', {}), {})
  writeStored('profile', { name: 'A' })
  setStorageScope('demo')
  assert.deepEqual(readStored('profile', {}), { name: '데모' })
  entries.set('netradar:v1:demo:profile', '{broken')
  assert.equal(readStored('profile', 'fallback'), 'fallback')
  entries.set('netradar:v1:demo:profile', 'null')
  assert.equal(
    readStored('profile', 'fallback', (value) => typeof value === 'string'),
    'fallback',
  )
})
