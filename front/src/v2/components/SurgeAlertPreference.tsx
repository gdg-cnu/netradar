import { useState } from 'react'
import { useSurgeAlertsEnabled } from '../hooks/useSurgeAlertsEnabled'
import { saveSurgeAlertsEnabled } from '../services/preferences'

export default function SurgeAlertPreference() {
  const enabled = useSurgeAlertsEnabled()
  const [notice, setNotice] = useState('')
  return (
    <div>
      <label className="profile-setting-row">
        <div>
          <strong>지도 급증 알림</strong>
          <p>지도에 예시 급증 알림 카드를 표시합니다. 푸시 알림은 전송하지 않습니다.</p>
        </div>
        <input
          type="checkbox"
          role="switch"
          aria-label="지도 급증 알림"
          checked={enabled}
          onChange={(event) =>
            setNotice(
              saveSurgeAlertsEnabled(event.target.checked)
                ? '급증 알림 설정을 저장했어요.'
                : '저장하지 못했습니다. 다시 시도해 주세요.',
            )
          }
        />
      </label>
      {notice && (
        <p role="status" className="profile-hint">
          {notice}
        </p>
      )}
    </div>
  )
}
