import { useEffect, useRef } from 'react'

export default function TermsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const termsUrl = import.meta.env.VITE_TERMS_URL
  const privacyUrl = import.meta.env.VITE_PRIVACY_URL
  const hasPolicies =
    termsUrl?.startsWith('https://') && privacyUrl?.startsWith('https://')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="terms-dialog"
      onCancel={onClose}
      aria-labelledby="terms-title"
    >
      <h2 id="terms-title">서비스 이용 및 저장 안내</h2>
      <p>
        넷레이더는 운행을 준비할 때 주변 수요와 동선을 비교하는 서비스입니다. 운전 중에는
        화면을 조작하지 말고 안전한 곳에서 이용해 주세요.
      </p>
      <h3>데모 데이터</h3>
      <p>
        데모의 시급·승객 수·경로·수익은 예시 값입니다. 실제 수익이나 실시간 교통 정보를
        보장하지 않습니다.
      </p>
      <h3>이 기기에 저장되는 정보</h3>
      <p>
        데모 프로필, 즐겨찾기, 알림 설정, 운행 상태와 완료 기록은 이 브라우저에
        저장됩니다. 공용 기기에서는 브라우저의 사이트 데이터를 지워 주세요. 실제 위치는
        버튼을 눌러 허용한 경우 화면 표시와 요청에 사용합니다.
      </p>
      <h3>정식 서비스 약관</h3>
      {hasPolicies ? (
        <p>
          <a href={termsUrl} target="_blank" rel="noreferrer">
            서비스 이용약관
          </a>{' '}
          ·{' '}
          <a href={privacyUrl} target="_blank" rel="noreferrer">
            개인정보 처리방침
          </a>
        </p>
      ) : (
        <p>
          정식 서비스 이용약관과 개인정보 처리방침은 운영 주체의 확정본 연결이 필요합니다.
          이 안내는 데모 이용 범위를 설명합니다.
        </p>
      )}
      <button className="primary-button" onClick={onClose}>
        확인
      </button>
    </dialog>
  )
}
