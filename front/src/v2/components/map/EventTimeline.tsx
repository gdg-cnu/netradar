import { eventTypeLabels, formatEventSize, formatKstTime } from '../../services/demand'
import type { DemandEvent, DemandPlace, EventType } from '../../types/demand'
import { useFreshness } from '../../../hooks/useFreshness'
import DemandDataMetadata, { type DemandMetadata } from './DemandDataMetadata'

const types: (EventType | 'all')[] = ['all', 'airport', 'concert', 'last_train']

export default function EventTimeline({
  events,
  places,
  type,
  onTypeChange,
  onSelect,
  metadata,
  server = false,
  loading = false,
  error = '',
  onRetry,
}: {
  events: DemandEvent[]
  places: DemandPlace[]
  type: EventType | 'all'
  onTypeChange: (type: EventType | 'all') => void
  onSelect: (id: string) => void
  metadata?: DemandMetadata
  server?: boolean
  loading?: boolean
  error?: string
  onRetry?: () => void
}) {
  const freshness = useFreshness(metadata?.generatedAt)
  return (
    <section
      className="v2-event-section"
      aria-labelledby="v2-events-heading"
      data-api-section={server || metadata ? 'events' : undefined}
      data-freshness={server || metadata ? freshness : undefined}
      aria-busy={loading}
    >
      <div className="v2-demand-section-heading">
        <div>
          <span className="v2-demand-eyebrow">TODAY'S TIMELINE</span>
          <h2 id="v2-events-heading">오늘 남은 이벤트</h2>
        </div>
        <span className="v2-demand-caption">한국 표준시 (KST)</span>
      </div>
      {metadata && <DemandDataMetadata metadata={metadata} freshness={freshness} />}
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
        {server || metadata
          ? '서버가 제공한 오늘 남은 이벤트입니다. 인원은 입국 인원·공연 규모 등 이벤트 기준이며 택시 탑승 인원이 아닙니다.'
          : '이벤트 종료 전까지 표시합니다. 일정과 입국 인원·공연 규모는 화면 확인용 예시입니다.'}
      </p>
      {loading ? (
        <p className="v2-demand-empty" role="status">
          이벤트를 불러오는 중이에요…
        </p>
      ) : error ? (
        <div className="v2-demand-error" role="alert">
          <p>{error}</p>
          {onRetry && (
            <button aria-label="이벤트 다시 시도" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      ) : events.length ? (
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
                  · {formatEventSize(event)}
                </span>
                <small>
                  {event.source}
                  {metadata ? '' : ' · 목업'}
                </small>
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
