import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/services/api.ts'
import {
  getProfile,
  getProfileForSettings,
  saveProfile,
} from '../src/services/profile.ts'
import { setStorageScope } from '../src/utils/storage.ts'
import type { UserProfile } from '../src/types/profile.ts'

function setupStorage() {
  const entries = new Map<string, string>()
  const events: string[] = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event.type)
        return true
      },
    },
  })
  return { entries, events }
}

const profile: UserProfile = {
  name: '홍길동',
  vehicleType: '전기',
  notifications: false,
  favorites: [],
}

test('profile GET 404 creates an unsaved empty draft with the authenticated name', async () => {
  const { entries, events } = setupStorage()
  let calls = 0
  const result = await getProfileForSettings('  김기사  ', async () => {
    calls += 1
    throw new ApiError('not found', 404)
  })
  assert.deepEqual(result, {
    kind: 'unregistered',
    draft: { name: '김기사', vehicleType: 'LPG', notifications: true, favorites: [] },
  })
  assert.equal('profile' in result, false)
  assert.equal(calls, 1)
  assert.equal(entries.size, 0, 'loading a new profile must not write any saved profile')
  assert.deepEqual(events, [], 'loading a draft must not publish a profile-saved event')
})

test('only a typed API 404 enables registration; auth, server, network and other failures propagate', async () => {
  const failures = [
    new ApiError('unauthorized', 401),
    new ApiError('forbidden', 403),
    new ApiError('server failed', 500),
    new ApiError('offline', 0),
    new Error('invalid response'),
    new TypeError('fetch failed'),
    { status: 404, message: 'not a response from the API client' },
  ]
  for (const failure of failures) {
    await assert.rejects(
      getProfileForSettings('김기사', async () => {
        throw failure
      }),
      (error) => error === failure,
    )
  }
})

test('a valid saved profile is preserved and malformed success responses are not registration', async () => {
  assert.deepEqual(await getProfileForSettings('인증 이름', async () => profile), {
    kind: 'registered',
    profile,
  })
  const malformed = [
    null,
    {},
    { ...profile, name: '' },
    { ...profile, favorites: [{ id: 'invalid' }] },
  ]
  for (const value of malformed) {
    await assert.rejects(
      getProfileForSettings('김기사', async () => value as UserProfile),
      /프로필 응답 형식/,
    )
  }
})

test('new-account drafts have separate empty favorites and do not borrow previous account data', async () => {
  const missing = async (): Promise<UserProfile> => {
    throw new ApiError('missing', 404)
  }
  const first = await getProfileForSettings(undefined, missing)
  const second = await getProfileForSettings('다른 기사', missing)
  assert.equal(first.kind, 'unregistered')
  assert.equal(second.kind, 'unregistered')
  if (first.kind !== 'unregistered' || second.kind !== 'unregistered') return
  assert.equal(first.draft.name, '')
  assert.equal(second.draft.name, '다른 기사')
  assert.notEqual(first.draft.favorites, second.draft.favorites)
})

test('pending profile reads and writes stay scoped to the account that started them', async () => {
  const { entries, events } = setupStorage()
  const accountA = { ...profile, name: 'A 기사' }
  const accountB = { ...profile, name: 'B 기사' }
  entries.set('netradar:v1:account-a:profile', JSON.stringify(accountA))
  entries.set('netradar:v1:account-b:profile', JSON.stringify(accountB))
  setStorageScope('account-a')
  const pendingRead = getProfile()
  setStorageScope('account-b')
  assert.deepEqual(await pendingRead, accountA)
  setStorageScope('account-a')
  const pendingSave = saveProfile({ ...accountA, vehicleType: 'LPG' })
  setStorageScope('account-b')
  assert.equal((await pendingSave).vehicleType, 'LPG')
  assert.deepEqual(JSON.parse(entries.get('netradar:v1:account-b:profile')!), accountB)
  assert.equal(
    JSON.parse(entries.get('netradar:v1:account-a:profile')!).vehicleType,
    'LPG',
  )
  assert.deepEqual(
    events,
    [],
    'a previous account completion must not refresh the new account UI',
  )
  setStorageScope('demo')
})
