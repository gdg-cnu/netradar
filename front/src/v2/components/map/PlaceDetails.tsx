import { useId } from 'react'
import { navigateTo } from '../../../utils/navigation'
import { useFreshness } from '../../../hooks/useFreshness'
import { demandPoint, eventTypeLabels, formatKstTime } from '../../services/demand'
import type {
  DemandEvent,
  DemandMetric,
  DemandOffset,
  DemandPlace,
} from '../../types/demand'
import DemandDataMetadata, { type DemandMetadata } from './DemandDataMetadata'

export default function PlaceDetails({
  place,
  metric,
  offset,
  events,
  metadata,
  routeDisabled = false,
}: {
  place: DemandPlace
  metric: DemandMetric
  offset: DemandOffset
  events: DemandEvent[]
  metadata?: DemandMetadata
  routeDisabled?: boolean
}) {
  const chartId = useId()
  const freshness = useFreshness(metadata?.generatedAt)
  const point = demandPoint(place, offset)
  const points = [...place.points].sort((a, b) => a.offset - b.offset)
  const values = points.map((item) =>
    metric === 'surge' ? item.surgeIndex : item.population,
  )
  const max =
    metric === 'surge'
      ? 100
      : Math.max(1, ...values.filter((value): value is number => value !== null))
  const coordinates = values.map((value, index) =>
    value === null ? null : { x: 28 + index * 112, y: 100 - (value / max) * 76 },
  )
  const segments: string[][] = []
  coordinates.forEach((coordinate, index) => {
    if (!coordinate) return
    if (index === 0 || coordinates[index - 1] === null) segments.push([])
    segments[segments.length - 1].push(`${coordinate.x},${coordinate.y}`)
  })
  const missing = metric === 'population' && point.population === null
  const value =
    metric === 'surge' ? point.surgeIndex : point.population?.toLocaleString('ko-KR')
  return (
    <aside
      id="v2-place-detail"
      className="v2-place-details"
      aria-label="장소 상세 예측"
      aria-describedby={metadata ? undefined : 'v2-demand-freshness'}
      data-api-section={metadata ? 'detail' : undefined}
      data-freshness={metadata ? freshness : undefined}
    >
      <div className="v2-demand-section-heading">
        <span className="v2-demand-chip">{eventTypeLabels[place.type]}</span>
        <span className="v2-demand-caption">{offset ? `+${offset}분` : '지금'} 예측</span>
      </div>
      <h2>{place.name}</h2>
      {metadata && <DemandDataMetadata metadata={metadata} freshness={freshness} />}
      <div className="v2-place-main-value" data-missing={missing}>
        <span>{metric === 'surge' ? '수요 지수' : '예상 인구'}</span>
        <strong>
          {missing ? (
            '인구 데이터 없음'
          ) : (
            <>
              {value}
              <small>{metric === 'surge' ? ' / 100' : '명'}</small>
            </>
          )}
        </strong>
        <p>
          {missing
            ? '이 장소의 인구 데이터가 제공되지 않았습니다.'
            : metadata
              ? metadata.source === 'mock'
                ? '서버에서 제공한 시연용 예시 값'
                : '서버가 모델 예측으로 표시한 값'
              : metric === 'surge'
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
                  {event.expectedExits === null
                    ? '유출 인원 데이터 없음'
                    : `예상 유출 ${event.expectedExits.toLocaleString('ko-KR')}명`}{' '}
                  · {event.source}
                  {metadata ? '' : ' (목업)'}
                </small>
              </li>
            ))}
          </ul>
        )}
        {place.reasons.length ? (
          <ul className="v2-place-reasons">
            {place.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="v2-demand-caption">제공된 예측 이유가 없어요.</p>
        )}
      </section>
      <section className="v2-place-section v2-place-trend">
        <h3>시점별 {metric === 'surge' ? '수요 지수' : '예상 인구'}</h3>
        {values.every((item) => item === null) && (
          <p className="v2-demand-caption">모든 시점의 인구 데이터가 없습니다.</p>
        )}
        <svg
          className="v2-place-chart"
          viewBox="0 0 280 128"
          role="img"
          aria-labelledby={chartId}
        >
          <title id={chartId}>
            {place.name}{' '}
            {points
              .map(
                (item, index) =>
                  `${item.offset ? `${item.offset}분 후` : '지금'} ${values[index] === null ? '데이터 없음' : `${values[index]}${metric === 'surge' ? '점' : '명'}`}`,
              )
              .join(', ')}
          </title>
          <line x1="28" y1="104" x2="252" y2="104" stroke="#e6e0da" />
          {segments
            .filter((segment) => segment.length > 1)
            .map((segment, index) => (
              <polyline
                key={index}
                points={segment.join(' ')}
                fill="none"
                stroke="#df5b24"
                strokeWidth="3"
                strokeLinejoin="round"
              />
            ))}
          {points.map((item, index) => {
            const coordinate = coordinates[index]
            return (
              <g key={item.offset}>
                {coordinate && (
                  <circle
                    cx={coordinate.x}
                    cy={coordinate.y}
                    r={item.offset === offset ? 6 : 4}
                    fill="#df5b24"
                  />
                )}
                <text x={28 + index * 112} y="123" textAnchor="middle">
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
              data-missing={values[index] === null}
            >
              {values[index] === null
                ? '데이터 없음'
                : `${values[index].toLocaleString('ko-KR')}${metric === 'population' ? '명' : ''}`}
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
          disabled={routeDisabled}
          onClick={() => navigateTo('route', { targetPlaceId: place.id })}
        >
          동선 추천
        </button>
        <button
          className="v2-demand-primary"
          disabled={routeDisabled}
          onClick={() => navigateTo('route', { targetPlaceId: place.id, quick: '1' })}
        >
          바로 출발
        </button>
      </div>
      <p className="v2-demand-caption">
        {routeDisabled
          ? '서버 동선 연동 준비 중'
          : '목업 예측은 실제 수요·수익을 보장하지 않습니다.'}
      </p>
    </aside>
  )
}
