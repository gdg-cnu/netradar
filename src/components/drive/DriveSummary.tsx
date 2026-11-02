import type { DriveState } from '../../types/route'

export default function DriveSummary({
  state,
  onNewRoute,
  onHistory,
}: {
  state: DriveState
  onNewRoute: () => void
  onHistory: () => void
}) {
  const duration = Math.max(
    1,
    Math.round(
      ((state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now())) / 60_000,
    ),
  )
  const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
  return (
    <section className="drive-summary panel" aria-labelledby="drive-summary-title">
      <span className="eyebrow">운행 완료{state.plan?.demo ? ' · 데모 기록' : ''}</span>
      <h1 id="drive-summary-title">오늘도 안전 운전하셨어요</h1>
      <p>
        {state.plan?.destination.name} 방향으로 {duration}분 운행했어요.
      </p>
      <dl className="drive-summary-grid">
        <div>
          <dt>방문 경유지</dt>
          <dd>{state.visitedStops}곳</dd>
        </div>
        <div>
          <dt>탑승 횟수</dt>
          <dd>{state.passengers}회</dd>
        </div>
        <div>
          <dt>운송 수입</dt>
          <dd>{won(state.totals.revenue)}</dd>
        </div>
        <div>
          <dt>운행 비용{state.plan?.demo ? ' (예시)' : ''}</dt>
          <dd>{won(state.totals.cost)}</dd>
        </div>
        <div>
          <dt>순수익</dt>
          <dd>{won(state.totals.revenue - state.totals.cost)}</dd>
        </div>
        <div>
          <dt>추가 수익{state.plan?.demo ? ' (예시)' : ''}</dt>
          <dd>{won(state.totals.extraProfit)}</dd>
        </div>
      </dl>
      <p className="drive-summary-note">
        {state.plan?.demo
          ? '데모 기록으로 저장했어요. 비용은 탑승당 1,500원, 추가 수익은 입력 요금의 12%로 가정한 예시이며 실제 수익이 아닙니다.'
          : '저장된 운행 기록에서 서버가 계산한 수익과 비용을 확인할 수 있어요.'}
      </p>
      <div className="drive-actions">
        <button className="primary-button" onClick={onHistory}>
          운행 기록 보기
        </button>
        <button className="nr-secondary-button" onClick={onNewRoute}>
          새 동선 추천받기
        </button>
      </div>
    </section>
  )
}
