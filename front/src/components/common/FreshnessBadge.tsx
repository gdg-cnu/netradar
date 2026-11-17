import { getFreshnessTimestamp, type FreshnessStatus } from '../../utils/freshness'
import '../../styles/freshness.css'

const labels: Record<FreshnessStatus, string> = {
  fresh: '최근 생성',
  stale: '오래된 예측 · 생성 후 20분 이상',
  unknown: '생성 시각 확인 불가',
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

export default function FreshnessBadge({
  status,
  generatedAt,
  className = '',
}: {
  status: FreshnessStatus
  generatedAt?: string
  className?: string
}) {
  const timestamp = getFreshnessTimestamp(generatedAt)
  const title =
    status === 'unknown' || timestamp === null
      ? '생성 시각이 없거나 유효하지 않거나 현재보다 1분 넘게 앞서 있습니다.'
      : `생성 시각: ${dateFormatter.format(timestamp)}`

  return (
    <span
      className={`freshness-badge freshness-badge--${status} ${className}`.trim()}
      data-freshness={status}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={title}
    >
      <span>{labels[status]}</span>
      {status !== 'unknown' && timestamp !== null && (
        <time dateTime={generatedAt}>생성 {dateFormatter.format(timestamp)} (KST)</time>
      )}
    </span>
  )
}
