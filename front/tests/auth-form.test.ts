import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailAuthErrorMessage, validateEmailAuth } from '../src/utils/authForm.ts'
import type { EmailAuthFields } from '../src/utils/authForm.ts'

const valid: EmailAuthFields = {
  name: '김기사',
  email: 'driver@example.com',
  password: 'long-password-123',
  confirmPassword: 'long-password-123',
}

test('email sign-in accepts existing shorter passwords and does not require signup-only fields', () => {
  assert.deepEqual(
    validateEmailAuth('signin', {
      ...valid,
      name: '',
      password: 'old123',
      confirmPassword: '',
    }),
    {},
  )
})

test('signup rejects missing name, malformed email, weak length and confirmation mismatch', () => {
  assert.deepEqual(
    Object.keys(
      validateEmailAuth('signup', {
        name: ' ',
        email: 'missing-domain',
        password: 'short',
        confirmPassword: 'other',
      }),
    ).sort(),
    ['confirmPassword', 'email', 'name', 'password'],
  )
  assert.ok(
    validateEmailAuth('signup', {
      ...valid,
      password: '        ',
      confirmPassword: '        ',
    }).password,
  )
  assert.ok(validateEmailAuth('signup', { ...valid, name: '가'.repeat(31) }).name)
})

test('validation accepts a trimmed email but never changes password or confirmation values', () => {
  const fields = {
    ...valid,
    email: '  driver@example.com  ',
    password: '  long-password  ',
    confirmPassword: '  long-password  ',
  }
  const snapshot = structuredClone(fields)
  assert.deepEqual(validateEmailAuth('signup', fields), {})
  assert.deepEqual(fields, snapshot)
  assert.ok(
    validateEmailAuth('signup', { ...fields, confirmPassword: 'long-password' })
      .confirmPassword,
  )
})

test('auth errors distinguish actionable confirmation, credentials, rate and network failures', () => {
  assert.match(emailAuthErrorMessage({ code: 'email_not_confirmed' }), /이메일 확인/)
  assert.match(
    emailAuthErrorMessage({ code: 'invalid_credentials' }),
    /이메일 또는 비밀번호/,
  )
  assert.match(emailAuthErrorMessage({ code: 'weak_password' }), /보안 기준/)
  assert.match(emailAuthErrorMessage({ status: 429 }), /잠시 기다린/)
  assert.match(emailAuthErrorMessage(new TypeError('Failed to fetch')), /네트워크/)
  assert.match(
    emailAuthErrorMessage({ code: 'email_provider_disabled' }),
    /아직 준비되지/,
  )
})

test('unknown provider errors do not expose raw backend messages in the login UI', () => {
  assert.equal(
    emailAuthErrorMessage(new Error('private provider diagnostic')),
    '인증 요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.',
  )
})
