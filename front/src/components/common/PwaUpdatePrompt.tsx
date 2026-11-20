import { useRegisterSW } from 'virtual:pwa-register/react'

// 새 버전이 준비되면 사용자가 원할 때 새로고침하도록 안내합니다.
// (운행 중 강제 새로고침을 막기 위해 자동 적용하지 않습니다.)
export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="pwa-update" role="status" aria-live="polite">
      <span>새 버전이 준비됐어요.</span>
      <div className="pwa-update-actions">
        <button type="button" onClick={() => setNeedRefresh(false)}>
          나중에
        </button>
        <button
          type="button"
          className="pwa-update-primary"
          onClick={() => void updateServiceWorker(true)}
        >
          새로고침
        </button>
      </div>
    </div>
  )
}
