import { eventTypeLabels, formatKstTime } from '../../services/demand'
import type { DemandEvent, DemandPlace, EventType } from '../../types/demand'

const types: (EventType | 'all')[] = ['all', 'airport', 'concert', 'train', 'last_train']

export default function EventTimeline({
  events,
  places,
  type,
  onTypeChange,
  onSelect,
}: {
  events: DemandEvent[]
  places: DemandPlace[]
  type: EventType | 'all'
  onTypeChange: (type: EventType | 'all') => void
  onSelect: (id: string) => void
}) {
  return (
    <section className="v2-event-section" aria-labelledby="v2-events-heading">
      <div className="v2-demand-section-heading">
        <div>
          <span className="v2-demand-eyebrow">TODAY'S TIMELINE</span>
          <h2 id="v2-events-heading">오늘 남은 이벤트</h2>
        </div>
        <span className="v2-demand-caption">한국 표준시 (KST)</span>
      </div>
      <div
        className="v2-demand-segmented v2-event-filters"
        role="group"
        aria-label="이벤트 유형"
      >
        {types.map((item) => (
          <button
            key={item}
            aria-pressed={type === item}
            onClick={() => onTypeChange(item)}
          >
            {item === 'all' ? '전체' : eventTypeLabels[item]}
          </button>
        ))}
      </div>
      <p className="v2-demand-caption">
        이벤트 종료 전까지 표시합니다. 일정과 유출 인원은 화면 확인용 예시입니다.
      </p>
      {events.length ? (
        <ol className="v2-event-list">
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.peakAt}>{formatKstTime(event.peakAt)}</time>
              <button
                onClick={() => onSelect(event.placeId)}
                aria-label={`이벤트 장소 보기: ${event.title}`}
              >
                <span className="v2-event-kind">{eventTypeLabels[event.type]}</span>
                <strong>{event.title}</strong>
                <span>
                  {places.find((place) => place.id === event.placeId)?.name ??
                    '장소 정보 없음'}{' '}
                  · 예상 유출 {event.expectedExits.toLocaleString('ko-KR')}명
                </span>
                <small>{event.source} · 목업</small>
              </button>
              <span aria-hidden="true">↗</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="v2-demand-empty">선택한 유형에 오늘 남은 이벤트가 없어요.</p>
      )}
    </section>
  )
}
