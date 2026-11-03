import { useEffect, useId, useRef, useState } from 'react'
import Brand from '../components/common/Brand'
import TermsDialog from '../components/common/TermsDialog'
import { isDemoMode } from '../services/api'
import {
  signInWithEmail,
  signInWithKakao,
  signUpWithEmail,
  supabase,
} from '../services/auth'
import { emailAuthErrorMessage, validateEmailAuth } from '../utils/authForm'
import type { AuthFieldErrors, EmailAuthFields, EmailAuthMode } from '../utils/authForm'
import { assetUrl } from '../utils/assets'

export default function LoginPage({
  onDemoLogin,
  error: sessionError = '',
}: {
  onDemoLogin: () => void
  error?: string
}) {
  const [agreed, setAgreed] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [pending, setPending] = useState<'kakao' | EmailAuthMode | null>(null)
  const [mode, setMode] = useState<EmailAuthMode>('signin')
  const [fields, setFields] = useState<EmailAuthFields>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestInFlight = useRef(false)
  const mounted = useRef(true)
  const formId = useId()
  const termsUrl = import.meta.env.VITE_TERMS_URL
  const privacyUrl = import.meta.env.VITE_PRIVACY_URL
  const legalLinksReady = Boolean(
    termsUrl?.startsWith('https://') && privacyUrl?.startsWith('https://'),
  )
  const authReady = Boolean(supabase && legalLinksReady)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function changeField(field: keyof EmailAuthFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({
      ...current,
      [field]: undefined,
      ...(field === 'password' ? { confirmPassword: undefined } : {}),
    }))
    setError('')
    setNotice('')
  }

  function changeMode(next: EmailAuthMode) {
    if (requestInFlight.current) return
    setMode(next)
    setFields((current) => ({ ...current, password: '', confirmPassword: '' }))
    setFieldErrors({})
    setError('')
    setNotice('')
  }

  async function kakaoLogin() {
    if (!agreed || !authReady || requestInFlight.current) return
    requestInFlight.current = true
    setPending('kakao')
    setError('')
    setNotice('')
    try {
      await signInWithKakao()
    } catch (cause) {
      requestInFlight.current = false
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : '로그인하지 못했습니다. 다시 시도해 주세요.',
        )
        setPending(null)
      }
    }
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agreed || !authReady || requestInFlight.current) return
    const validation = validateEmailAuth(mode, fields)
    setFieldErrors(validation)
    setError('')
    setNotice('')
    const invalidField = Object.keys(validation)[0]
    if (invalidField) {
      document.getElementById(`${formId}-${invalidField}`)?.focus()
      return
    }
    requestInFlight.current = true
    setPending(mode)
    try {
      if (mode === 'signin') await signInWithEmail(fields.email, fields.password)
      else {
        const result = await signUpWithEmail(fields.name, fields.email, fields.password)
        if (mounted.current && result.requiresEmailConfirmation) {
          setFields((current) => ({ ...current, password: '', confirmPassword: '' }))
          setNotice(
            '가입 요청을 접수했습니다. 이메일로 받은 확인 링크를 누른 뒤 로그인해 주세요. 메일이 없다면 스팸함을 확인하거나 기존 계정으로 로그인해 주세요.',
          )
        }
      }
    } catch (cause) {
      if (mounted.current) setError(emailAuthErrorMessage(cause))
    } finally {
      requestInFlight.current = false
      if (mounted.current) setPending(null)
    }
  }

  return (
    <main className="login-page">
      <div className="login-visual">
        <div className="road road-one" />
        <div className="road road-two" />
        <div className="login-brand">
          <Brand />
          <p>
            동선은 줄이고, 시급은 높이고
            <br />
            택시 기사님을 위한 시급 동선 추천 서비스
          </p>
        </div>
      </div>
      <section className="login-panel">
        <span className="eyebrow">NETRADAR</span>
        <h1>
          기사님의 오늘 운행을
          <br />더 똑똑하게 시작하세요
        </h1>
        <p>예상 시급 지도와 맞춤 동선을 한곳에서 확인하세요.</p>
        <label className="consent-field">
          <input
            type="checkbox"
            checked={agreed}
            disabled={Boolean(pending)}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            {legalLinksReady
              ? '서비스 이용약관과 개인정보 처리방침에 동의합니다.'
              : '데모 이용 및 기기 저장 안내를 확인했습니다.'}
          </span>
        </label>
        <div className="terms-links">
          {legalLinksReady ? (
            <>
              <a href={termsUrl} target="_blank" rel="noreferrer">
                서비스 이용약관
              </a>
              <a href={privacyUrl} target="_blank" rel="noreferrer">
                개인정보 처리방침
              </a>
            </>
          ) : (
            <button type="button" onClick={() => setShowTerms(true)}>
              이용 및 저장 안내 보기
            </button>
          )}
        </div>
        <button
          className="kakao-button"
          disabled={!agreed || Boolean(pending) || !authReady}
          onClick={kakaoLogin}
        >
          <img src={assetUrl('ac89b.png')} alt="" />
          {pending === 'kakao' ? '카카오로 이동 중…' : '카카오톡 로그인'}
        </button>
        <div className="auth-divider">
          <span>또는 이메일로 시작하기</span>
        </div>
        <section className="email-auth" aria-labelledby={`${formId}-heading`}>
          <div
            className="auth-mode-options"
            role="group"
            aria-label="이메일 계정 이용 방식"
          >
            <button
              type="button"
              aria-pressed={mode === 'signin'}
              disabled={Boolean(pending)}
              onClick={() => changeMode('signin')}
            >
              이메일 로그인
            </button>
            <button
              type="button"
              aria-pressed={mode === 'signup'}
              disabled={Boolean(pending)}
              onClick={() => changeMode('signup')}
            >
              회원가입
            </button>
          </div>
          <h2 id={`${formId}-heading`} className="auth-form-heading">
            {mode === 'signin'
              ? '이메일로 로그인하세요'
              : '이메일로 계정을 만들어 주세요'}
          </h2>
          <form
            className="email-auth-form"
            onSubmit={submitEmail}
            noValidate
            aria-busy={Boolean(pending)}
          >
            {mode === 'signup' && (
              <div className="auth-field">
                <label htmlFor={`${formId}-name`}>이름</label>
                <input
                  id={`${formId}-name`}
                  autoComplete="name"
                  value={fields.name}
                  maxLength={30}
                  required
                  disabled={!authReady || Boolean(pending)}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? `${formId}-name-error` : undefined}
                  onChange={(event) => changeField('name', event.target.value)}
                />
                {fieldErrors.name && (
                  <p className="auth-field-error" id={`${formId}-name-error`}>
                    {fieldErrors.name}
                  </p>
                )}
              </div>
            )}
            <div className="auth-field">
              <label htmlFor={`${formId}-email`}>이메일</label>
              <input
                id={`${formId}-email`}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={fields.email}
                maxLength={254}
                required
                disabled={!authReady || Boolean(pending)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? `${formId}-email-error` : undefined}
                onChange={(event) => changeField('email', event.target.value)}
                placeholder="name@example.com"
              />
              {fieldErrors.email && (
                <p className="auth-field-error" id={`${formId}-email-error`}>
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <div className="auth-field">
              <label htmlFor={`${formId}-password`}>비밀번호</label>
              <input
                id={`${formId}-password`}
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={fields.password}
                required
                disabled={!authReady || Boolean(pending)}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  fieldErrors.password
                    ? `${formId}-password-error`
                    : mode === 'signup'
                      ? `${formId}-password-hint`
                      : undefined
                }
                onChange={(event) => changeField('password', event.target.value)}
              />
              {fieldErrors.password ? (
                <p className="auth-field-error" id={`${formId}-password-error`}>
                  {fieldErrors.password}
                </p>
              ) : (
                mode === 'signup' && (
                  <p className="auth-field-hint" id={`${formId}-password-hint`}>
                    8자 이상 입력해 주세요.
                  </p>
                )
              )}
            </div>
            {mode === 'signup' && (
              <div className="auth-field">
                <label htmlFor={`${formId}-confirmPassword`}>비밀번호 확인</label>
                <input
                  id={`${formId}-confirmPassword`}
                  type="password"
                  autoComplete="new-password"
                  value={fields.confirmPassword}
                  required
                  disabled={!authReady || Boolean(pending)}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  aria-describedby={
                    fieldErrors.confirmPassword
                      ? `${formId}-confirmation-error`
                      : undefined
                  }
                  onChange={(event) => changeField('confirmPassword', event.target.value)}
                />
                {fieldErrors.confirmPassword && (
                  <p className="auth-field-error" id={`${formId}-confirmation-error`}>
                    {fieldErrors.confirmPassword}
                  </p>
                )}
              </div>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={!agreed || !authReady || Boolean(pending)}
            >
              {pending === 'signin'
                ? '로그인 중…'
                : pending === 'signup'
                  ? '가입 요청 중…'
                  : mode === 'signin'
                    ? '이메일로 로그인'
                    : '회원가입하기'}
            </button>
          </form>
          {notice && (
            <div className="auth-notice" role="status">
              <p>{notice}</p>
              <button type="button" onClick={() => changeMode('signin')}>
                이메일 로그인으로 이동
              </button>
            </div>
          )}
        </section>
        {isDemoMode() && (
          <button
            className="primary-button demo-login"
            disabled={!agreed || Boolean(pending)}
            onClick={onDemoLogin}
          >
            데모로 둘러보기
          </button>
        )}
        {!authReady && (
          <p className="login-hint">
            정식 로그인은 준비 중입니다.
            {isDemoMode()
              ? ' 데모에서 전체 운행 흐름을 확인할 수 있어요.'
              : ' 서비스 운영자에게 문의해 주세요.'}
          </p>
        )}
        {(error || sessionError) && (
          <p className="form-error" role="alert">
            {error || sessionError}
          </p>
        )}
      </section>
      {showTerms && <TermsDialog onClose={() => setShowTerms(false)} />}
    </main>
  )
}
