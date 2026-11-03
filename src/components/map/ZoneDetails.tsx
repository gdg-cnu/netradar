import { useId } from 'react'
import {
  forecastSourceLabel,
  forecastSourceNotice,
  formatWon,
} from '../../services/forecast'
import { navigateTo } from '../../utils/navigation'
import type {
  ForecastHorizon,
  ForecastMetric,
  RankedForecastZone,
} from '../../types/forecast'

interface ZoneDetailsProps {
  zone: RankedForecastZone
  metric: ForecastMetric
  horizon: ForecastHorizon
}

export default function ZoneDetails({ zone, metric, horizon }: ZoneDetailsProps) {
  const chartId = useId()
  const { current } = zone
  const total = Math.max(current.grossRevenue, 1)
  const points = zone.trend.slice().sort((a, b) => a.minutes - b.minutes)
  const values = points.map((point) =>
    metric === 'hourly' ? point.netHourly : point.passengers,
  )
  const low = Math.min(0, ...values)
  const high = Math.max(1, ...values)
  const coordinates = values.map(
    (value, index) =>
      `${28 + index * 112},${104 - ((value - low) / Math.max(high - low, 1)) * 76}`,
  )

  return (
    <aside
      id="forecast-zone-detail"
      className="forecast-details"
      aria-labelledby="zone-detail-title"
    >
      <div className="forecast-detail-heading">
        <span className="forecast-rank">{zone.rank}위</span>
        <span className="forecast-time-label">
          {horizon === 0 ? '지금' : `${horizon}분 후`} 예상
        </span>
      </div>
      <h2 id="zone-detail-title">{zone.name}</h2>
      <p className="forecast-detail-source" data-provenance={zone.provenance}>
        {forecastSourceLabel(zone.provenance)}
      </p>
      <div className="forecast-main-value">
        <span>{metric === 'hourly' ? '예상 순시급' : '예상 승객 수'}</span>
        <strong>
          {metric === 'hourly' ? formatWon(current.netHourly) : `${current.passengers}명`}
        </strong>
        <small>
          {metric === 'hourly'
            ? '1시간 운행 기준 · 비용 차감 후'
            : '해당 구역의 1시간 수요 기준'}
        </small>
      </div>
      <section className="forecast-reason">
        <h3>이 구역을 추천하는 이유</h3>
        <p>{zone.reason}</p>
      </section>
      <section className="forecast-breakdown">
        <h3>
          예상 수입과 비용 <small>1시간 기준</small>
        </h3>
        <div
          className="forecast-cost-bar"
          role="img"
          aria-label={`매출 ${formatWon(current.grossRevenue)}, 순수입 ${formatWon(current.netHourly)}, 연료비 ${formatWon(current.fuelCost)}, 공차·대기 비용 ${formatWon(current.idleCost)}`}
        >
          <span
            className="cost-net"
            style={{
              width: `${(Math.max(0, current.netHourly) / total) * 100}%`,
            }}
          />
          <span
            className="cost-fuel"
            style={{ width: `${(current.fuelCost / total) * 100}%` }}
          />
          <span
            className="cost-idle"
            style={{ width: `${(current.idleCost / total) * 100}%` }}
          />
        </div>
        <dl>
          <div>
            <dt>예상 매출</dt>
            <dd>{formatWon(current.grossRevenue)}</dd>
          </div>
          <div>
            <dt>
              <i className="cost-fuel" />
              연료비
            </dt>
            <dd>−{formatWon(current.fuelCost)}</dd>
          </div>
          <div>
            <dt>
              <i className="cost-idle" />
              공차·대기 비용
            </dt>
            <dd>−{formatWon(current.idleCost)}</dd>
          </div>
          <div className="net-total">
            <dt>
              <i className="cost-net" />
              예상 순수입
            </dt>
            <dd>{formatWon(current.netHourly)}</dd>
          </div>
        </dl>
      </section>
      <section className="forecast-trend">
        <h3>시간대별 {metric === 'hourly' ? '순시급' : '승객 수'} 흐름</h3>
        <svg viewBox="0 0 280 130" role="img" aria-labelledby={chartId}>
          <title id={chartId}>
            {zone.name} 시간대별 예측:{' '}
            {points
              .map(
                (point, index) =>
                  `${point.minutes === 0 ? '지금' : `${point.minutes}분 후`} ${
                    metric === 'hourly' ? formatWon(values[index]) : `${values[index]}명`
                  }`,
              )
              .join(', ')}
          </title>
          <line x1="28" y1="108" x2="252" y2="108" stroke="#eadfd8" />
          <polyline
            points={coordinates.join(' ')}
            fill="none"
            stroke="#ed642d"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {points.map((point, index) => {
            const [cx, cy] = coordinates[index].split(',').map(Number)
            return (
              <g key={point.minutes}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={point.minutes === horizon ? 6 : 4}
                  fill={point.minutes === horizon ? '#b83e13' : '#ef9d70'}
                />
                <text x={cx} y="125" textAnchor="middle">
                  {point.minutes === 0 ? '지금' : `+${point.minutes}분`}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="forecast-trend-values">
          {points.map((point, index) => (
            <span
              key={point.minutes}
              className={point.minutes === horizon ? 'current' : ''}
            >
              {metric === 'hourly' ? formatWon(values[index]) : `${values[index]}명`}
            </span>
          ))}
        </div>
      </section>
      <button
        className="primary-button"
        onClick={() =>
          navigateTo('route', {
            zone: zone.id,
            destination: zone.name,
            lat: String(zone.lat),
            lng: String(zone.lng),
          })
        }
      >
        이 구역으로 동선 추천 <span aria-hidden="true">→</span>
      </button>
      <p className="forecast-disclaimer">{forecastSourceNotice(zone.provenance)}</p>
    </aside>
  )
}
