import { navigateTo } from '../../../utils/navigation'
import { formatKstTime } from '../../services/demand'
import type { DemandAlert, DemandPlace } from '../../types/demand'
import { useFreshness } from '../../../hooks/useFreshness'
import DemandDataMetadata, { type DemandMetadata } from './DemandDataMetadata'

export default function SurgeAlerts({
  alerts,
  places,
  onSelect,
  originLabel,
  metadata,
  routeDisabled = false,
}: {
  alerts: DemandAlert[]
  places: DemandPlace[]
  onSelect: (id: string) => void
  originLabel: string
  metadata?: DemandMetadata
  routeDisabled?: boolean
}) {
  const freshness = useFreshness(metadata?.generatedAt)
  return (
    <section
      className="v2-alert-section"
      aria-labelledby="v2-alert-heading"
      data-api-section={metadata ? 'alerts' : undefined}
      data-freshness={metadata ? freshness : undefined}
    >
      <div className="v2-demand-section-heading">
        <div>
          <span className="v2-demand-eyebrow">SURGE WATCH</span>
          <h2 id="v2-alert-heading">지금 주목할 급증 알림</h2>
        </div>
        {!metadata && <span className="v2-demand-chip">시연용 알림</span>}
      </div>
      {metadata && <DemandDataMetadata metadata={metadata} freshness={freshness} />}
      <p className="v2-demand-caption">
        {originLabel} 출발 ·{' '}
        {metadata
          ? '서버가 제공한 출발·도착 시각과 이동 시간입니다. 실시간 교통 상황과 실제 도로 길 안내는 제공하지 않습니다.'
          : '예측 생성 시각 기준, 직선거리로 근사한 이동 시간입니다. 실제 도로·교통·배차 상황을 반영하지 않습니다.'}
      </p>
      {alerts.length ? (
        <div className="v2-alert-grid">
          {alerts.map((alert, index) => {
            const place = places.find((item) => item.id === alert.placeId)
            if (!place && !metadata) return null
            const placeName = place?.name ?? `장소 정보 없음 (${alert.placeId})`
            return (
              <article className="v2-alert-card" key={alert.id}>
                <div className="v2-alert-title">
                  <span className="v2-alert-number">0{index + 1}</span>
                  <button
                    onClick={() => onSelect(alert.placeId)}
                    aria-label={`알림 장소 보기: ${placeName}`}
                  >
                    <h3>{placeName}</h3>
                    <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <p>{alert.reason}</p>
                <dl>
                  <div>
                    <dt>권장 출발</dt>
                    <dd>{formatKstTime(alert.recommendedDepartureAt)}</dd>
                  </div>
                  <div>
                    <dt>도착 시 수요 지수</dt>
                    <dd>
                      {alert.surgeIndexAtArrival}
                      <small> / 100</small>
                    </dd>
                  </div>
                </dl>
                <div className="v2-alert-timing">
                  생성 시각에 출발 시 {formatKstTime(alert.arrivalAt)} 도착 · 약{' '}
                  {alert.travelMinutes}분<br />
                  피크 {formatKstTime(alert.peakStart)}–{formatKstTime(alert.peakEnd)}{' '}
                  (KST)
                </div>
                <button
                  className="v2-demand-primary"
                  aria-label={`바로 출발: ${placeName}`}
                  disabled={routeDisabled}
                  onClick={() =>
                    navigateTo('route', { targetPlaceId: alert.placeId, quick: '1' })
                  }
                >
                  바로 출발 <span aria-hidden="true">→</span>
                </button>
                {routeDisabled && (
                  <p className="v2-demand-caption">서버 동선 연동 준비 중</p>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <p className="v2-demand-empty">
          지금 표시할 급증 알림이 없어요. 새 예측을 불러오거나 장소 목록을 확인해 주세요.
        </p>
      )}
    </section>
  )
}
