import type { DemandPlan } from '../../types/drive'
import { formatKstTime } from '../../services/demand'
import { useFreshness } from '../../../hooks/useFreshness'
import FreshnessBadge from '../../../components/common/FreshnessBadge'

export default function DemandConnection({
  plan,
  currentIndex,
}: {
  plan: DemandPlan
  currentIndex?: number
}) {
  const generatedAt = new Date(plan.generatedAt).toISOString()
  const freshness = useFreshness(generatedAt)
  return (
    <section
      className="v2-connection"
      aria-label="목업 장소 연결도"
      data-freshness={freshness}
    >
      <div className="v2-connection-title">
        <h2>장소 연결도</h2>
        <span>실제 도로 경로 아님</span>
      </div>
      <FreshnessBadge
        status={freshness}
        generatedAt={generatedAt}
        className="v2-connection-freshness"
      />
      <ol className="v2-place-chain">
        <li className="v2-chain-end">
          <span aria-hidden="true">출발</span>
          <div>
            <strong>{plan.origin.name}</strong>
            <small>선택한 출발 위치</small>
          </div>
        </li>
        {plan.stops.map((stop, index) => (
          <li
            key={stop.placeId}
            className={currentIndex === index ? 'is-current' : ''}
            aria-current={currentIndex === index ? 'step' : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            <div>
              <strong>{stop.name}</strong>
              <small>
                이동 {stop.travelMinutes}분 · 출발 후 {stop.arrivalMinutes}분 도착 가정
              </small>
              <small>
                {formatKstTime(plan.generatedAt + stop.arrivalMinutes * 60_000)} KST ·
                시간 모두 목업
              </small>
              <p className="v2-arrival-index">
                {stop.surgeIndexAtArrival === null ? (
                  '도착 시점이 예보 범위(+60분)를 벗어나 지수 없음'
                ) : (
                  <>
                    도착 시점 수요 지수 <b>{stop.surgeIndexAtArrival}</b>
                    <small>0–100 예시 · +{stop.forecastOffset}분 예보 사용</small>
                  </>
                )}
              </p>
              <small>{stop.reason}</small>
            </div>
          </li>
        ))}
        <li className="v2-chain-end">
          <span aria-hidden="true">종점</span>
          <div>
            <strong>{plan.destinationName ?? '목적지 없이 수요 따라 이동'}</strong>
            <small>
              {plan.destinationName
                ? '선택한 목적지 방향 · 실제 도로 연결 미확인'
                : '최대 3개 장소를 확인한 뒤 계속 추천 가능'}
            </small>
          </div>
        </li>
      </ol>
      <p className="v2-footnote">
        연결 순서와 이동 시간은 직선거리 가정의 모의 안내입니다. 도로·교통·실제 우회율은
        반영하지 않습니다.
      </p>
    </section>
  )
}
