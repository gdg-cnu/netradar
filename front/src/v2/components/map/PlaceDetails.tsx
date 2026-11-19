import { useId } from 'react'
import { navigateTo } from '../../../utils/navigation'
import { demandPoint, eventTypeLabels, formatKstTime } from '../../services/demand'
import type {
  DemandEvent,
  DemandMetric,
  DemandOffset,
  DemandPlace,
} from '../../types/demand'

export default function PlaceDetails({
  place,
  metric,
  offset,
  events,
}: {
  place: DemandPlace
  metric: DemandMetric
  offset: DemandOffset
  events: DemandEvent[]
}) {
  const chartId = useId()
  const point = demandPoint(place, offset)
  const points = [...place.points].sort((a, b) => a.offset - b.offset)
  const values = points.map((item) =>
    metric === 'surge' ? item.surgeIndex : item.population,
  )
  const max = metric === 'surge' ? 100 : Math.max(1, ...values)
  const coordinates = values.map(
    (value, index) => `${28 + index * 112},${100 - (value / max) * 76}`,
  )
  const value =
    metric === 'surge' ? point.surgeIndex : point.population.toLocaleString('ko-KR')
  return (
    <aside
      id="v2-place-detail"
      className="v2-place-details"
      aria-label="장소 상세 예측"
      aria-describedby="v2-demand-freshness"
    >
      <div className="v2-demand-section-heading">
        <span className="v2-demand-chip">{eventTypeLabels[place.type]}</span>
        <span className="v2-demand-caption">{offset ? `+${offset}분` : '지금'} 예측</span>
      </div>
      <h2>{place.name}</h2>
      <div className="v2-place-main-value">
        <span>{metric === 'surge' ? '수요 지수' : '예상 인구'}</span>
        <strong>
          {value}
          <small>{metric === 'surge' ? ' / 100' : '명'}</small>
        </strong>
        <p>
          {metric === 'surge'
            ? '주변 상황을 합성한 예시 지수'
            : '해당 장소 주변 인구의 예시 추정치'}
        </p>
      </div>
      <section className="v2-place-section">
        <h3>이 장소의 예측 이유</h3>
        {events.length > 0 && (
          <ul className="v2-place-events">
            {events.slice(0, 2).map((event) => (
              <li key={event.id}>
                <span>
                  {eventTypeLabels[event.type]} · {formatKstTime(event.peakAt)}
                </span>
                <strong>{event.title}</strong>
                <small>
                  예상 유출 {event.expectedExits.toLocaleString('ko-KR')}명 ·{' '}
                  {event.source} (목업)
                </small>
              </li>
            ))}
          </ul>
        )}
        <ul className="v2-place-reasons">
          {place.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>
      <section className="v2-place-section v2-place-trend">
        <h3>시점별 {metric === 'surge' ? '수요 지수' : '예상 인구'}</h3>
        <svg viewBox="0 0 280 128" role="img" aria-labelledby={chartId}>
          <title id={chartId}>
            {place.name}{' '}
            {points
              .map(
                (item, index) =>
                  `${item.offset ? `${item.offset}분 후` : '지금'} ${values[index]}${metric === 'surge' ? '점' : '명'}`,
              )
              .join(', ')}
          </title>
          <line x1="28" y1="104" x2="252" y2="104" stroke="#e6e0da" />
          <polyline
            points={coordinates.join(' ')}
            fill="none"
            stroke="#df5b24"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {points.map((item, index) => {
            const [cx, cy] = coordinates[index].split(',').map(Number)
            return (
              <g key={item.offset}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={item.offset === offset ? 6 : 4}
                  fill="#df5b24"
                />
                <text x={cx} y="123" textAnchor="middle">
                  {item.offset ? `+${item.offset}분` : '지금'}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="v2-place-trend-values">
          {points.map((item, index) => (
            <span
              key={item.offset}
              className={item.offset === offset ? 'is-current' : ''}
            >
              {values[index].toLocaleString('ko-KR')}
              {metric === 'population' ? '명' : ''}
            </span>
          ))}
        </div>
      </section>
      <section className="v2-place-section">
        <h3>근처 승차대</h3>
        {place.taxiStands.length ? (
          <ul className="v2-place-taxi">
            {place.taxiStands.map((stand) => (
              <li key={stand.name}>
                <strong>{stand.name}</strong>
                <p>{stand.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="v2-demand-caption">등록된 승차대 정보가 없어요.</p>
        )}
        <p className="v2-demand-caption">위치와 운영 여부는 현장 안내를 확인해 주세요.</p>
      </section>
      <div className="v2-place-actions">
        <button
          className="v2-demand-secondary"
          onClick={() => navigateTo('route', { targetPlaceId: place.id })}
        >
          동선 추천
        </button>
        <button
          className="v2-demand-primary"
          onClick={() => navigateTo('route', { targetPlaceId: place.id, quick: '1' })}
        >
          바로 출발
        </button>
      </div>
      <p className="v2-demand-caption">목업 예측은 실제 수요·수익을 보장하지 않습니다.</p>
    </aside>
  )
}
