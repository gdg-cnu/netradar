import { toDateKey } from '../../services/history'

export function monthDates(month: string): Date[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year, monthNumber - 1, 1, 12)
  const last = new Date(year, monthNumber, 0, 12)
  const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7
  return Array.from(
    { length: cells },
    (_, index) => new Date(year, monthNumber - 1, index - first.getDay() + 1, 12),
  )
}

export default function Calendar({
  month,
  selected,
  recordDates,
  onSelect,
  onMonthChange,
}: {
  month: string
  selected: string
  recordDates: Set<string>
  onSelect: (date: string) => void
  onMonthChange: (offset: number) => void
}) {
  const [year, monthNumber] = month.split('-').map(Number)
  return (
    <section className="calendar panel history-calendar" aria-label="운행 기록 달력">
      <div className="history-month-nav">
        <button type="button" onClick={() => onMonthChange(-1)} aria-label="이전 달">
          ‹
        </button>
        <h2>
          {year}년 {monthNumber}월
        </h2>
        <button type="button" onClick={() => onMonthChange(1)} aria-label="다음 달">
          ›
        </button>
      </div>
      <div className="weekdays">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <b key={day}>{day}</b>
        ))}
      </div>
      <div className="calendar-grid">
        {monthDates(month).map((date) => {
          const key = toDateKey(date)
          const muted = !key.startsWith(month)
          const hasRecord = recordDates.has(key)
          return (
            <button
              key={key}
              className={`${selected === key ? 'selected' : ''} ${muted ? 'muted' : ''}`}
              disabled={muted}
              aria-pressed={selected === key}
              aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일${
                hasRecord ? ', 운행기록 있음' : ''
              }`}
              onClick={() => onSelect(key)}
            >
              {date.getDate()}
              {hasRecord && <i aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <p className="history-calendar-legend">
        <span aria-hidden="true" /> 운행 기록이 있는 날
      </p>
    </section>
  )
}
