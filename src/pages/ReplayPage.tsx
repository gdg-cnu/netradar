import { useEffect, useMemo, useState } from 'react'
import Calendar from '../components/replay/Calendar'
import RideCard from '../components/replay/RideCard'
import { exampleTrips, getTrips, toDateKey } from '../services/history'
import { isDemoMode } from '../services/api'
import type { TripRecord } from '../types/history'
import { navigateTo } from '../utils/navigation'
import '../styles/replay.css'

export default function ReplayPage() {
  const today = toDateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [showExamples, setShowExamples] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setTrips([])
    getTrips(month)
      .then((records) => {
        if (active) setTrips(records)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '운행기록을 불러오지 못했습니다.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [month, reload])

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1)
    window.addEventListener('netradar:trips-changed', refresh)
    return () => window.removeEventListener('netradar:trips-changed', refresh)
  }, [])

  const examples = useMemo(
    () => (showExamples ? exampleTrips(`${month}-02`) : []),
    [showExamples, month],
  )
  const records = showExamples ? examples : trips
  const selectedTrips = records.filter((record) => record.date === selectedDate)
  const recordDates = new Set(records.map((record) => record.date))
  const total = selectedTrips.reduce((sum, record) => sum + record.extraProfit, 0)
  const [year, monthNumber, day] = selectedDate.split('-').map(Number)

  function changeMonth(offset: number) {
    const [year, monthNumber] = month.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + offset, 1, 12)
    const nextDate = toDateKey(next)
    setMonth(nextDate.slice(0, 7))
    setSelectedDate(nextDate)
  }

  return (
    <main className="page-shell history-page">
      <header className="history-heading">
        <div>
          <span className="eyebrow">리플레이</span>
          <h1>나의 운행 기록</h1>
          <p>날짜를 선택해 완료한 운행과 수익을 확인하세요.</p>
        </div>
        {isDemoMode() && (
          <button
            className="history-example-button"
            aria-pressed={showExamples}
            onClick={() => {
              setShowExamples((value) => !value)
              if (!showExamples) setSelectedDate(`${month}-02`)
            }}
          >
            {showExamples ? '예시 기록 숨기기' : '예시 기록 보기'}
          </button>
        )}
      </header>
      {isDemoMode() && (
        <p className="history-demo-note">
          {showExamples
            ? '예시 기록 보기 · 저장된 운행과 합산하지 않습니다.'
            : '데모 운행 기록은 이 브라우저에 저장됩니다.'}
        </p>
      )}
      <div className="history-layout">
        <Calendar
          month={month}
          selected={selectedDate}
          recordDates={recordDates}
          onSelect={setSelectedDate}
          onMonthChange={changeMonth}
        />
        <section className="history-records" aria-label="선택한 날짜의 운행 기록">
          <div className="record-summary">
            <span>
              {year}년 {monthNumber}월 {day}일 운행기록
            </span>
            <h2>
              {selectedTrips.length > 0 ? (
                <>
                  총 추가 수익은 <em>{total.toLocaleString('ko-KR')}원</em>
                  이에요.
                </>
              ) : (
                '아직 저장된 운행이 없어요'
              )}
            </h2>
            {selectedTrips.length > 0 && (
              <p>
                운행 {selectedTrips.length}건 · 승객{' '}
                {selectedTrips.reduce((sum, record) => sum + record.passengers, 0)}명
              </p>
            )}
          </div>
          {loading ? (
            <p role="status">운행기록을 불러오는 중…</p>
          ) : error ? (
            <div className="history-error" role="alert">
              <p>{error}</p>
              <button onClick={() => setReload((value) => value + 1)}>
                다시 불러오기
              </button>
            </div>
          ) : selectedTrips.length > 0 ? (
            <div className="history-ride-grid">
              {selectedTrips.map((ride) => (
                <RideCard key={ride.id} ride={ride} />
              ))}
            </div>
          ) : (
            <div className="history-empty">
              <p>동선 안내를 마치면 운행 요약이 이곳에 저장됩니다.</p>
              <button onClick={() => navigateTo('route')}>동선 추천 시작하기</button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
