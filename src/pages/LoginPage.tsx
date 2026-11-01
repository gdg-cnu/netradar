import Brand from "../components/common/Brand"
import { assetUrl } from "../utils/assets"

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
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
        <p>예상 시급 지도와 맞춤 동선 추천을 한곳에서 확인하세요.</p>
        <button className="kakao-button" onClick={onLogin}>
          <img src={assetUrl("ac89b.png")} alt="" /> 카카오톡 로그인
        </button>
        <small>
          로그인 시 개인정보처리방침과 서비스 이용약관에 동의한 것으로
          간주합니다.
        </small>
      </section>
    </main>
  )
}
