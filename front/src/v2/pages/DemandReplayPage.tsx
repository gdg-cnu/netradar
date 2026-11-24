import { useEffect, useId, useState } from 'react'
import { createDemandSnapshot, formatKstTime, kstDateKey } from '../services/demand'
import { readDemandTrips } from '../services/drive'
import type { DemandPlace } from '../types/demand'
import type { DemandTrip } from '../types/drive'
import '../styles/replay.css'

type ReplayPoint = { time: string; forecast: number; observed: number | null }
const formatPeople = (value: number) => `${value.toLocaleString('ko-KR')}명`

function examplePoints(place: DemandPlace): ReplayPoint[] {
  const base = place.points.find((point) => point.offset === 30)?.population
  if (base == null) return []
  const factors = [0.62, 0.8, 1, 1.08, 0.92, 0.75]
  return factors.map((factor, index) => ({
    time: `${16 + Math.floor(index / 2)}:${index % 2 ? '30' : '00'}`,
    forecast: Math.round(base * factor),
    // A missing observation remains null, including in the graph and comparison table.
    observed:
      index === 2
        ? null
        : Math.round(base * factor * [0.94, 1.05, 1, 0.96, 1.07, 0.98][index]),
  }))
}

function PopulationComparison({ place, date }: { place: DemandPlace; date: string }) {
  const titleId = useId()
  const descriptionId = useId()
  const points = examplePoints(place)
  const max =
    Math.ceil(
      Math.max(1, ...points.flatMap((point) => [point.forecast, point.observed ?? 0])) /
        1000,
    ) * 1000
  const x = (index: number) => 62 + index * 88
  const y = (value: number) => 182 - (value / max) * 150
  const observedSegments: string[][] = [[]]
  for (const [index, point] of points.entries()) {
    if (point.observed === null) observedSegments.push([])
    else
      observedSegments[observedSegments.length - 1].push(
        `${x(index)},${y(point.observed)}`,
      )
  }

  return (
    <section
      className="v2-replay-comparison"
      aria-label="예보 인구와 관측 인구 예시 비교"
    >
      <div className="v2-replay-chart-heading">
        <div>
          <span className="v2-replay-label">명시적으로 켠 예시 리플레이</span>
          <h2>{place.name} 인구 비교</h2>
        </div>
        <span>{date} · KST</span>
      </div>
      <p id={descriptionId} className="v2-replay-help">
        예보 인구와 관측 인구는 화면 확인용 예시이며 실제 수집 자료가 아닙니다. 두 값의
        단위는 모두 명입니다. 관측이 없는 시점은 선을 연결하거나 0명으로 표시하지
        않습니다.
      </p>
      <div className="v2-replay-legend" aria-label="그래프 범례">
        <span>
          <i className="v2-replay-forecast-key" />
          예보 인구(예시)
        </span>
        <span>
          <i className="v2-replay-observed-key" />
          관측 인구(예시)
        </span>
      </div>
      <svg
        viewBox="0 0 540 230"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <title id={titleId}>
          {place.name} 예보 인구(예시)와 관측 인구(예시), 단위 명
        </title>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1="62"
              y1={y(max * ratio)}
              x2="502"
              y2={y(max * ratio)}
              className="v2-replay-grid-line"
            />
            <text x="50" y={y(max * ratio) + 4} textAnchor="end">
              {Math.round(max * ratio).toLocaleString('ko-KR')}
            </text>
          </g>
        ))}
        <text x="22" y="16">
          명
        </text>
        <polyline
          className="v2-replay-forecast-line"
          points={points
            .map((point, index) => `${x(index)},${y(point.forecast)}`)
            .join(' ')}
        />
        {observedSegments
          .filter((segment) => segment.length > 1)
          .map((segment) => (
            <polyline
              className="v2-replay-observed-line"
              key={segment[0]}
              points={segment.join(' ')}
            />
          ))}
        {points.map((point, index) => (
          <g key={point.time}>
            <circle
              className="v2-replay-forecast-dot"
              cx={x(index)}
              cy={y(point.forecast)}
              r="4"
            />
            {point.observed !== null && (
              <circle
                className="v2-replay-observed-dot"
                cx={x(index)}
                cy={y(point.observed)}
                r="4"
              />
            )}
            <text x={x(index)} y="207" textAnchor="middle">
              {point.time}
            </text>
          </g>
        ))}
      </svg>
      <p className="v2-replay-missing">17:00 관측 인구(예시): 관측 없음</p>
      <div className="v2-replay-table-wrap">
        <table>
          <caption>인구 비교 예시 상세 · 단위: 명</caption>
          <thead>
            <tr>
              <th scope="col">시각 (KST)</th>
              <th scope="col">예보 인구(예시)</th>
              <th scope="col">관측 인구(예시)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.time}>
                <th scope="row">{point.time}</th>
                <td>{formatPeople(point.forecast)}</td>
                <td>
                  {point.observed === null ? '관측 없음' : formatPeople(point.observed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SavedTrip({ trip }: { trip: DemandTrip }) {
  return (
    <article className="v2-replay-trip">
      <div className="v2-replay-trip-heading">
        <span>저장된 목업 운행</span>
        <time dateTime={new Date(trip.startedAt).toISOString()}>
          {formatKstTime(trip.startedAt)}–{formatKstTime(trip.endedAt)} KST
        </time>
      </div>
      <h3>
        {trip.originName} → {trip.destinationName ?? '목적지 없이 수요 장소 방문'}
      </h3>
      <p>{trip.stopNames.length ? trip.stopNames.join(' · ') : '기록된 경유지 없음'}</p>
      <dl>
        <div>
          <dt>운행 시간</dt>
          <dd>{trip.durationMinutes}분</dd>
        </div>
        <div>
          <dt>탑승 기록</dt>
          <dd>{trip.passengers}명</dd>
        </div>
        <div>
          <dt>입력 요금 합계</dt>
          <dd>
            {trip.fareRecordedCount
              ? `${trip.fare.toLocaleString('ko-KR')}원`
              : '입력 없음'}
          </dd>
        </div>
      </dl>
      {trip.passengers > 0 && (
        <p>
          요금 입력 {trip.fareRecordedCount}건 · 미입력{' '}
          {Math.max(0, trip.passengers - trip.fareRecordedCount)}건
        </p>
      )}
      <p className="v2-replay-help">
        이 브라우저에 저장한 목업 운행입니다. 실제 운행·관측 인구를 수집한 기록이
        아닙니다.
      </p>
    </article>
  )
}

export default function DemandReplayPage() {
  const [snapshot] = useState(() => createDemandSnapshot())
  const [trips, setTrips] = useState<DemandTrip[] | null>(null)
  const [date, setDate] = useState(() => kstDateKey())
  const [placeId, setPlaceId] = useState('all')
  const [showExamples, setShowExamples] = useState(false)
  const today = kstDateKey()
  const selected = snapshot.places.find((place) => place.id === placeId)
  const examplePlace = selected ?? snapshot.places[0]
  const selectedTrips = (trips ?? []).filter(
    (trip) =>
      trip.date === date &&
      (placeId === 'all' || trip.visits.some((visit) => visit.placeId === placeId)),
  )

  useEffect(() => {
    const refresh = () => setTrips(readDemandTrips())
    refresh()
    window.addEventListener('netradar:v2-drive-change', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('netradar:v2-drive-change', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return (
    <main className="v2-page v2-replay-page">
      <header className="v2-replay-heading">
        <div>
          <span className="eyebrow">리플레이</span>
          <h1>예보와 이동을 돌아보세요</h1>
          <p>저장한 목업 운행을 확인하고 인구 비교 예시를 살펴보세요.</p>
        </div>
        <span className="v2-replay-label">프런트엔드 목업</span>
      </header>
      <p className="v2-replay-notice">
        실제 수집 데이터가 연결되지 않았습니다. 예시 리플레이는 버튼을 누른 뒤에만
        표시되며 운행 기록으로 저장되지 않습니다.
      </p>
      <div className="v2-replay-filters">
        <label>
          날짜 (KST)
          <input
            type="date"
            aria-label="리플레이 날짜"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          장소
          <select
            aria-label="리플레이 장소"
            value={placeId}
            onChange={(event) => setPlaceId(event.target.value)}
          >
            <option value="all">전체 장소</option>
            {snapshot.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setShowExamples((value) => !value)}
          disabled={!date || date > today}
        >
          {showExamples ? '예시 리플레이 숨기기' : '예시 리플레이 보기'}
        </button>
      </div>
      {!date && (
        <p role="status" className="v2-replay-empty">
          날짜를 선택해 주세요.
        </p>
      )}
      {date && (
        <section aria-label="저장된 목업 운행 목록" className="v2-replay-saved">
          <div className="v2-replay-section-heading">
            <h2>저장된 목업 운행</h2>
            <span>{selectedTrips.length}건</span>
          </div>
          {trips === null ? (
            <p role="status">저장한 운행을 불러오는 중이에요…</p>
          ) : selectedTrips.length ? (
            <div className="v2-replay-trip-list">
              {selectedTrips.map((trip) => (
                <SavedTrip key={trip.id} trip={trip} />
              ))}
            </div>
          ) : (
            <div className="v2-replay-empty">
              <h3>선택한 날짜·장소의 운행이 없어요</h3>
              <p>목업 운행을 종료하면 여기에 기록됩니다.</p>
            </div>
          )}
        </section>
      )}
      {showExamples && date && date <= today && (
        <>
          {placeId === 'all' && (
            <p className="v2-replay-example-context">
              전체 장소 선택 중에는 {examplePlace.name}의 비교 예시를 표시합니다. 다른
              예시는 장소 선택에서 확인하세요.
            </p>
          )}
          <PopulationComparison place={examplePlace} date={date} />
        </>
      )}
    </main>
  )
}
