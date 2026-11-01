import { calendarWeeks, recordDays } from "../../data/mock"

export default function Calendar({
  selected,
  onSelect,
}: {
  selected: number
  onSelect: (day: number) => void
}) {
  return (
    <section className="calendar panel">
      <button className="month-button">
        2026년　10월 <span>▾</span>
      </button>
      <div className="weekdays">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <b key={day}>{day}</b>
        ))}
      </div>
      <div className="calendar-grid">
        {calendarWeeks.flatMap((week, row) =>
          week.map((day, column) => {
            const muted = row === 0 && column < 4
            return (
              <button
                key={`${row}-${day}`}
                className={`${selected === day && !muted ? "selected" : ""} ${
                  muted ? "muted" : ""
                }`}
                disabled={muted}
                aria-pressed={selected === day && !muted}
                aria-label={`2026년 ${muted ? 9 : 10}월 ${day}일`}
                onClick={() => onSelect(day)}
              >
                {day}
                {!muted && recordDays.has(day) && <i />}
              </button>
            )
          }),
        )}
      </div>
    </section>
  )
}
