import { useEffect, useId, useRef, useState } from 'react'
import {
  getPlaceSearchSource,
  placeSearchEmptyMessage,
  placeSearchNotice,
  searchPlaces,
  type Place,
} from '../../services/routes'
import type { FavoritePlace } from '../../types/profile'

export default function FavoriteEditor({
  favorite,
  onSave,
  onClose,
  saving,
}: {
  favorite?: FavoritePlace
  onSave: (favorite: FavoritePlace) => Promise<void>
  onClose: () => void
  saving: boolean
}) {
  const source = getPlaceSearchSource()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const sourceId = useId()
  const [label, setLabel] = useState(favorite?.label ?? '')
  const [kind, setKind] = useState<FavoritePlace['kind']>(favorite?.kind ?? 'custom')
  const [query, setQuery] = useState(favorite?.address ?? '')
  const [selected, setSelected] = useState<Place | null>(
    favorite
      ? {
          id: favorite.id,
          name: favorite.label,
          address: favorite.address,
          lat: favorite.lat,
          lng: favorite.lng,
        }
      : null,
  )
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    return () => {
      request.current?.abort()
      dialog.current?.close()
    }
  }, [])

  async function search() {
    if (query.trim().length < 2) {
      setError('주소나 장소 이름을 두 글자 이상 입력해주세요.')
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setSearched(false)
    try {
      const matches = await searchPlaces(query.trim(), controller.signal)
      if (controller.signal.aborted) return
      setResults(matches)
      setSearched(true)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : '주소를 찾지 못했습니다. 다시 검색해주세요.',
        )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!label.trim() || !selected) {
      setError('장소 이름을 입력하고 검색 결과에서 주소를 선택해주세요.')
      return
    }
    setError('')
    try {
      await onSave({
        id: favorite?.id ?? crypto.randomUUID(),
        label: label.trim(),
        kind,
        address: selected.address,
        lat: selected.lat,
        lng: selected.lng,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '장소를 저장하지 못했습니다.')
    }
  }

  return (
    <dialog
      className="favorite-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onClose()
      }}
    >
      <header>
        <h2 id={titleId}>{favorite ? '즐겨찾기 수정' : '즐겨찾기 추가'}</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="즐겨찾기 편집 닫기"
        >
          ×
        </button>
      </header>
      <form onSubmit={submit}>
        <label>
          장소 이름
          <input
            autoFocus
            value={label}
            maxLength={30}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="예: 집, 자주 가는 충전소"
            required
          />
        </label>
        <label>
          분류
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as FavoritePlace['kind'])}
          >
            <option value="home">집</option>
            <option value="lpg">LPG 충전소</option>
            <option value="ev">전기차 충전소</option>
            <option value="custom">기타 장소</option>
          </select>
        </label>
        <label>
          주소 또는 장소 검색
          <input
            value={query}
            aria-describedby={sourceId}
            onChange={(event) => {
              request.current?.abort()
              setLoading(false)
              setQuery(event.target.value)
              setSelected(null)
              setResults([])
              setSearched(false)
            }}
            placeholder="예: 강남역, 잠실"
          />
        </label>
        <p className="profile-hint" id={sourceId}>
          {placeSearchNotice(source)}
        </p>
        <button
          className="profile-secondary"
          type="button"
          disabled={loading}
          onClick={search}
        >
          {loading ? '검색 중…' : '주소 검색'}
        </button>
        {results.length > 0 && (
          <ul className="favorite-search-results" aria-label="주소 검색 결과">
            {results.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === place.id}
                  onClick={() => {
                    setSelected(place)
                    setQuery(place.address)
                    setResults([])
                  }}
                >
                  <strong>{place.name}</strong>
                  <span>{place.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searched && results.length === 0 && !selected && (
          <p className="profile-hint" role="status">
            {placeSearchEmptyMessage(source)}
          </p>
        )}
        {selected && (
          <p className="favorite-selected" role="status">
            선택한 주소: {selected.address}
          </p>
        )}
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={saving || loading}>
          {saving ? '저장 중…' : '장소 저장'}
        </button>
      </form>
    </dialog>
  )
}
