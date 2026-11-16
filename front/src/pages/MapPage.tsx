import { useMemo, useState } from 'react'
import ForecastMap from '../components/map/ForecastMap'
import ZoneDetails from '../components/map/ZoneDetails'
import { useForecast } from '../hooks/useForecast'
import { useLocation } from '../hooks/useLocation'
import { isDemoMode } from '../services/api'
import {
  forecastSourceLabel,
  forecastSourceNotice,
  formatWon,
  rankForecastZones,
} from '../services/forecast'
import type { ForecastHorizon, ForecastMetric } from '../types/forecast'
import '../styles/map.css'

const metricOptions: {
  id: ForecastMetric
  label: string
}[] = [
  { id: 'hourly', label: '시급 보기' },
  { id: 'passengers', label: '승객 수 보기' },
]
const timeOptions: {
  value: ForecastHorizon
  label: string
}[] = [
  { value: 0, label: '지금' },
  { value: 30, label: '+30분' },
  { value: 60, label: '+60분' },
]

export default function MapPage() {
  const [metric, setMetric] = useState<ForecastMetric>('hourly')
  const [horizon, setHorizon] = useState<ForecastHorizon>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const { data, loading, error, retry } = useForecast(metric, horizon)
  const { position, status, error: locationError, requestLocation } = useLocation()
  const localDemo = isDemoMode()
  const provenance = data?.provenance ?? (localDemo ? 'local-demo' : 'server-unspecified')
  const zones = useMemo(
    () => rankForecastZones(data?.zones ?? [], metric, horizon),
    [data, metric, horizon],
  )
  const selected = zones.find((zone) => zone.id === selectedId) ?? zones[0]
  const searchTerm = query.trim().replace(/\s/g, '').toLocaleLowerCase('ko-KR')
  const visibleZones = zones.filter((zone) =>
    zone.name.replace(/\s/g, '').toLocaleLowerCase('ko-KR').includes(searchTerm),
  )
  const top = zones[0]

  return (
    <main className="forecast-page">
      <header className="forecast-page-heading">
        <div>
          <span className="eyebrow">시급 지도</span>
          <h1>어디에서 운행하면 좋을까요?</h1>
          <p>구역별 예상 수입과 수요를 비교해 보세요.</p>
        </div>
        <span
          className={`forecast-source-badge ${provenance.includes('demo') || provenance === 'mixed' ? 'demo' : ''}`}
          data-provenance={provenance}
        >
          {data || localDemo ? forecastSourceLabel(provenance) : '서버 데이터 연결'}
        </span>
      </header>
      {data && (
        <p className="forecast-source-notice" role="status" data-provenance={provenance}>
          {forecastSourceNotice(provenance)}
        </p>
      )}
      <div className="forecast-layout">
        <section className="forecast-explorer" aria-label="지역별 예측 탐색">
          <div className="forecast-toolbar">
            <form
              className="forecast-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                if (visibleZones[0]) {
                  setSelectedId(visibleZones[0].id)
                  setSearchNotice(`${visibleZones[0].name} 예측을 선택했습니다.`)
                } else setSearchNotice('일치하는 예측 구역이 없습니다.')
              }}
            >
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="예측 지역 검색"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSearchNotice('')
                }}
                placeholder="예측 지역 검색 · 강남역, 삼성역…"
              />
              {query && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => {
                    setQuery('')
                    setSearchNotice('')
                  }}
                >
                  ×
                </button>
              )}
              <button type="submit">검색</button>
            </form>
            <div className="forecast-filter-row">
              <div className="forecast-segmented" role="group" aria-label="예측 지표">
                {metricOptions.map((option) => (
                  <button
                    key={option.id}
                    aria-pressed={metric === option.id}
                    onClick={() => {
                      setMetric(option.id)
                      setSelectedId(null)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="forecast-segmented" role="group" aria-label="예측 시간">
                {timeOptions.map((option) => (
                  <button
                    key={option.value}
                    aria-pressed={horizon === option.value}
                    onClick={() => {
                      setHorizon(option.value)
                      setSelectedId(null)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                className="forecast-location-button"
                onClick={() => {
                  void requestLocation()
                }}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? '확인 중…' : '◎ 내 위치'}
              </button>
            </div>
            {locationError && (
              <p className="forecast-inline-message" role="status">
                {locationError} 지역 목록은 계속 이용할 수 있어요.
              </p>
            )}
            {searchNotice && (
              <p className="forecast-inline-message" role="status">
                {searchNotice}
              </p>
            )}
          </div>
          <ForecastMap
            zones={zones}
            metric={metric}
            selectedId={selected?.id}
            onSelect={setSelectedId}
            position={position}
          />
          {top && (
            <button className="forecast-top-pick" onClick={() => setSelectedId(top.id)}>
              <span className="forecast-top-medal">1</span>
              <span>
                <strong>추천 1위 · {top.name}</strong>
                <small>
                  {horizon === 0 ? '지금' : `${horizon}분 후`}{' '}
                  {metric === 'hourly' ? '예상 순시급' : '예상 승객 수'}
                </small>
              </span>
              <b>
                {metric === 'hourly'
                  ? formatWon(top.current.netHourly)
                  : `${top.current.passengers}명`}
              </b>
              <span aria-hidden="true">›</span>
            </button>
          )}
          <section
            className="forecast-zone-list"
            aria-labelledby="forecast-zone-list-title"
            aria-busy={loading}
          >
            <div className="forecast-list-heading">
              <h2 id="forecast-zone-list-title">
                구역별 예상 {metric === 'hourly' ? '순시급' : '승객 수'}
              </h2>
              <span>{visibleZones.length}개 구역</span>
            </div>
            <p className="forecast-list-help">
              목록에서 구역을 선택하면 상세 예측을 확인할 수 있어요.
            </p>
            {loading && (
              <p className="forecast-empty" role="status">
                예측을 불러오는 중이에요…
              </p>
            )}
            {error && (
              <div className="forecast-empty" role="alert">
                <p>{error}</p>
                <button onClick={retry}>다시 불러오기</button>
              </div>
            )}
            {!loading && !error && visibleZones.length === 0 && (
              <p className="forecast-empty" role="status">
                {query
                  ? '일치하는 예측 구역이 없어요. 다른 지역 이름을 입력해 주세요.'
                  : '현재 표시할 예측 구역이 없어요.'}
              </p>
            )}
            <ol>
              {visibleZones.map((zone) => (
                <li key={zone.id}>
                  <button
                    aria-pressed={selected?.id === zone.id}
                    aria-controls="forecast-zone-detail"
                    onClick={() => setSelectedId(zone.id)}
                  >
                    <span className="forecast-list-rank">{zone.rank}</span>
                    <span className="forecast-list-name">
                      <strong>{zone.name}</strong>
                      <span
                        className="forecast-zone-source"
                        data-provenance={zone.provenance}
                      >
                        {forecastSourceLabel(zone.provenance)}
                      </span>
                      <small>
                        {metric === 'hourly'
                          ? `예상 승객 ${zone.current.passengers}명/시간`
                          : `예상 순시급 ${formatWon(zone.current.netHourly)}`}
                      </small>
                    </span>
                    <b>
                      {metric === 'hourly'
                        ? formatWon(zone.current.netHourly)
                        : `${zone.current.passengers}명`}
                    </b>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ol>
            {data && (
              <p className="forecast-data-note">
                {localDemo
                  ? `${zones.length}개 구역 · 로컬 시연용 예측`
                  : `${zones.length}개 구역 · 서버 응답 시각 ${new Date(data.generatedAt).toLocaleString('ko-KR')}`}
                {provenance === 'mixed' && (
                  <span className="forecast-source-counts">
                    {Array.from(new Set(zones.map((zone) => zone.provenance)))
                      .map(
                        (source) =>
                          `${forecastSourceLabel(source)} ${zones.filter((zone) => zone.provenance === source).length}개`,
                      )
                      .join(' / ')}
                  </span>
                )}
              </p>
            )}
          </section>
        </section>
        {selected ? (
          <ZoneDetails zone={selected} metric={metric} horizon={horizon} />
        ) : (
          <aside className="forecast-details forecast-details-empty">
            <h2>지역별 예측 상세</h2>
            <p>{loading ? '잠시만 기다려 주세요.' : '표시할 예측 데이터가 없습니다.'}</p>
          </aside>
        )}
      </div>
    </main>
  )
}
