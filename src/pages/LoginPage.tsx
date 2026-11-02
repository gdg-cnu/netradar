import { useState } from 'react'
import Brand from '../components/common/Brand'
import TermsDialog from '../components/common/TermsDialog'
import { isDemoMode } from '../services/api'
import { signInWithKakao, supabase } from '../services/auth'
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const termsUrl = import.meta.env.VITE_TERMS_URL
  const privacyUrl = import.meta.env.VITE_PRIVACY_URL
  const legalLinksReady = Boolean(
    termsUrl?.startsWith('https://') && privacyUrl?.startsWith('https://'),
  )
  async function kakaoLogin() {
    if (!agreed || pending) return
    if (!legalLinksReady) {
      setError('정식 서비스 약관 연결이 준비 중입니다. 현재는 데모로 확인해 주세요.')
      return
    }
    setPending(true)
    setError('')
    try {
      await signInWithKakao()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '로그인하지 못했습니다. 다시 시도해 주세요.',
      )
      setPending(false)
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
          disabled={!agreed || pending || !supabase || !legalLinksReady}
          onClick={kakaoLogin}
        >
          <img src={assetUrl('ac89b.png')} alt="" />
          {pending ? '카카오로 이동 중…' : '카카오톡 로그인'}
        </button>
        {isDemoMode() && (
          <button
            className="primary-button demo-login"
            disabled={!agreed || pending}
            onClick={onDemoLogin}
          >
            데모로 둘러보기
          </button>
        )}
        {(!supabase || !legalLinksReady) && (
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
