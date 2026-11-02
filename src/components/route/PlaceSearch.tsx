import { useEffect, useState } from 'react'
import { searchPlaces } from '../../services/routes'
import type { Place } from '../../types/route'

export default function PlaceSearch({
  label,
  onSelect,
  disabled = false,
}: {
  label: string
  onSelect: (place: Place) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setResults([])
    if (query.trim().length < 2) {
      setPending(false)
      setError('')
      return
    }
    const controller = new AbortController()
    setPending(true)
    setError('')
    const timer = window.setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setResults(results)
        })
        .catch((caught) => {
          if (!controller.signal.aborted)
            setError(caught instanceof Error ? caught.message : '검색하지 못했어요.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false)
        })
    }, 300)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, attempt])
  return (
    <div className="route-place-picker">
      <label className="field">
        <span>{label}</span>
        <input
          aria-label={label}
          value={query}
          disabled={disabled}
          autoComplete="off"
          placeholder="장소 이름을 2글자 이상 입력"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div aria-live="polite">
        {pending ? (
          <p>검색 중…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button className="nr-text-button" onClick={() => setAttempt((n) => n + 1)}>
              다시 시도
            </button>
          </div>
        ) : query.trim().length >= 2 && results.length === 0 ? (
          <p>검색 결과가 없어요. 다른 검색어를 입력해 주세요.</p>
        ) : null}
      </div>
      {results.length > 0 && (
        <ul className="route-search-results">
          {results.map((place) => (
            <li key={place.id}>
              <button disabled={disabled} onClick={() => onSelect(place)}>
                <strong>{place.name}</strong>
                <span>{place.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
