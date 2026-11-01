import type { RideRecord } from "../../types/app"

export default function RideCard({ ride }: { ride: RideRecord }) {
  return (
    <article className="ride-card">
      <header>
        <strong>{ride.name}</strong>
        <span>손님 탑승</span>
      </header>
      <p>{ride.arrivalSummary}</p>
      <div>
        <dl>
          <dt>추천 시급</dt>
          <dd>{ride.recommendedHourlyRate}</dd>
        </dl>
        <dl>
          <dt>실제 시급</dt>
          <dd>{ride.actualHourlyRate}</dd>
        </dl>
        <dl className="profit">
          <dt>추가 수익</dt>
          <dd>{ride.extraProfit}</dd>
        </dl>
      </div>
    </article>
  )
}
