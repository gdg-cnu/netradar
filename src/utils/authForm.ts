export type EmailAuthMode = 'signin' | 'signup'
export interface EmailAuthFields {
  name: string
  email: string
  password: string
  confirmPassword: string
}
export type AuthFieldErrors = Partial<Record<keyof EmailAuthFields, string>>

export function validateEmailAuth(
  mode: EmailAuthMode,
  fields: EmailAuthFields,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {}
  const email = fields.email.trim()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = '올바른 이메일 주소를 입력해 주세요.'
  if (!fields.password) errors.password = '비밀번호를 입력해 주세요.'
  if (mode === 'signup') {
    if (!fields.name.trim() || fields.name.trim().length > 30)
      errors.name = '이름을 1~30자로 입력해 주세요.'
    if (fields.password.length < 8 || !fields.password.trim())
      errors.password = '비밀번호를 8자 이상 입력해 주세요.'
    if (fields.password !== fields.confirmPassword)
      errors.confirmPassword = '비밀번호가 일치하지 않습니다.'
  }
  return errors
}

export function emailAuthErrorMessage(error: unknown): string {
  const details =
    error && typeof error === 'object'
      ? (error as { code?: string; status?: number; name?: string })
      : {}
  switch (details.code) {
    case 'invalid_credentials':
      return '이메일 또는 비밀번호를 확인해 주세요.'
    case 'email_not_confirmed':
      return '이메일 확인이 필요합니다. 받은 메일의 확인 링크를 누른 뒤 다시 로그인해 주세요.'
    case 'user_already_exists':
    case 'email_exists':
      return '이미 가입된 이메일입니다. 이메일 로그인을 이용해 주세요.'
    case 'weak_password':
      return '비밀번호가 보안 기준에 맞지 않습니다. 더 길고 추측하기 어려운 비밀번호를 입력해 주세요.'
    case 'email_address_invalid':
      return '올바른 이메일 주소를 입력해 주세요.'
    case 'signup_disabled':
      return '현재 회원가입이 일시 중단되었습니다. 잠시 후 다시 시도해 주세요.'
    case 'email_provider_disabled':
    case 'provider_disabled':
      return '이메일 로그인이 아직 준비되지 않았습니다. 서비스 운영자에게 문의해 주세요.'
    case 'email_address_not_authorized':
      return '이 이메일로 확인 메일을 보낼 수 없습니다. 서비스 운영자에게 문의해 주세요.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return '요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.'
  }
  if (details.status === 429)
    return '요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.'
  if (details.name === 'AuthRetryableFetchError' || error instanceof TypeError)
    return '인증 서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'
  return '인증 요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.'
}
