import type { TripRecord } from '../../types/history'

const currency = (value: number) => `${value.toLocaleString('ko-KR')}원`
const time = (value: number) =>
  new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export default function RideCard({ ride }: { ride: TripRecord }) {
  const minutes = Math.max(1, Math.round((ride.endedAt - ride.startedAt) / 60000))
  return (
    <article className="history-ride-card">
      <header>
        <h3>{ride.destination}</h3>
        <span>{ride.demo ? '데모 기록' : '운행 완료'}</span>
      </header>
      <p>
        {time(ride.startedAt)} ~ {time(ride.endedAt)} · {minutes}분 · 경유지 {ride.stops}
        곳 · 승객 {ride.passengers}명
      </p>
      <dl>
        <div>
          <dt>운행 수입</dt>
          <dd>{currency(ride.revenue)}</dd>
        </div>
        <div>
          <dt>운행 비용</dt>
          <dd>{currency(ride.cost)}</dd>
        </div>
        <div>
          <dt>순수익</dt>
          <dd>{currency(ride.revenue - ride.cost)}</dd>
        </div>
        <div className="history-profit">
          <dt>추천 추가 수익</dt>
          <dd>
            {ride.extraProfit > 0 ? '+' : ''}
            {currency(ride.extraProfit)}
          </dd>
        </div>
      </dl>
    </article>
  )
}
