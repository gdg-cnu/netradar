import type { RoutePlan } from '../../types/route'
import { routeEstimateNotice } from '../../services/routes'
import RouteMapPanel from './RouteMapPanel'

interface Props {
  plan: RoutePlan
  pending: boolean
  starting: boolean
  error: string
  onStart: () => void
  onRetry: () => void
  onEdit: () => void
}
const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`
export default function RouteResults({
  plan,
  pending,
  starting,
  error,
  onStart,
  onRetry,
  onEdit,
}: Props) {
  return (
    <section className="route-results" aria-labelledby="route-results-title">
      <div className="nr-route-heading">
        <span className="eyebrow">
          {plan.demo ? '예시 동선 · 데모' : '동선 추천 결과'}
        </span>
        <h1 id="route-results-title">
          {plan.destination.name}까지
          <br />
          수익을 더하는 동선
        </h1>
        <p>{routeEstimateNotice(plan.demo)}</p>
      </div>
      <RouteMapPanel plan={plan} />
      <div className="route-comparison" aria-label="직행과 추천 동선 비교">
        <div>
          <h2>바로 가는 동선</h2>
          <dl>
            <dt>이동 시간</dt>
            <dd>{plan.direct.minutes}분</dd>
            <dt>이동 거리</dt>
            <dd>{plan.direct.kilometers}km</dd>
            <dt>예상 수익</dt>
            <dd>{won(plan.direct.earnings)}</dd>
          </dl>
        </div>
        <div className="is-recommended">
          <h2>추천 동선</h2>
          <dl>
            <dt>이동 시간</dt>
            <dd>{plan.recommended.minutes}분</dd>
            <dt>이동 거리</dt>
            <dd>{plan.recommended.kilometers}km</dd>
            <dt>예상 수익</dt>
            <dd>{won(plan.recommended.earnings)}</dd>
          </dl>
        </div>
      </div>
      <p className="route-benefit">
        예상 수익 차이{' '}
        <strong>
          {plan.recommended.earnings - plan.direct.earnings >= 0 ? '+' : ''}
          {won(plan.recommended.earnings - plan.direct.earnings)}
        </strong>
      </p>
      {plan.stops.length === 0 ? (
        <div className="nr-route-empty">
          <h2>추천할 경유지가 없어요</h2>
          <p>목적지나 우회 범위를 바꾸거나 잠시 후 다시 추천받아 주세요.</p>
        </div>
      ) : (
        <ol className="route-stop-list">
          {plan.stops.map((stop, index) => (
            <li key={stop.id}>
              <span className="route-stop-number">{index + 1}</span>
              <div>
                <h2>{stop.name}</h2>
                <p>{stop.address}</p>
                <small>
                  대기 {stop.waitMinutes}분 · 예상 시급 {won(stop.expectedHourlyRate)}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p className="nr-route-error" role="alert">
          {error}
        </p>
      )}
      <div className="route-result-actions">
        <button
          type="button"
          className="primary-button"
          disabled={pending || starting || plan.stops.length === 0}
          onClick={onStart}
        >
          {starting
            ? '운행 시작 중…'
            : plan.demo
              ? '이 동선으로 데모 운행 시작'
              : '이 동선으로 운행 시작'}
        </button>
        <button
          type="button"
          className="nr-secondary-button"
          disabled={pending || starting}
          onClick={onRetry}
        >
          {pending ? '새 동선 찾는 중…' : '다시 추천받기'}
        </button>
        <button
          type="button"
          className="nr-text-button"
          disabled={pending || starting}
          onClick={onEdit}
        >
          목적지·우회 범위 변경
        </button>
      </div>
    </section>
  )
}
