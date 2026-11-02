import { useEffect, useRef, useState } from 'react'
import { useRoute } from '../hooks/useRoute'
import { useLocation } from '../hooks/useLocation'
import { useDrive } from '../hooks/useDrive'
import { getProfile } from '../services/profile'
import { isDemoMode } from '../services/api'
import { recommendRoute, searchPlaces } from '../services/routes'
import { navigateTo } from '../utils/navigation'
import { readStored, writeStored } from '../utils/storage'
import { isPlace, isRoutePlan, validCoordinates } from '../types/route'
import type { Detour, Place, RoutePlan } from '../types/route'
import RouteResults from '../components/route/RouteResults'
import PlaceSearch from '../components/route/PlaceSearch'
import '../styles/route.css'

interface RouteDraft {
  destination: Place | null
  detour: Detour
  plan: RoutePlan | null
}
interface Favorite {
  id: string
  label: string
  address: string
  lat: number
  lng: number
  kind: string
}
const detours: { value: Detour; label: string; percent: number }[] = [
  { value: 'little', label: '조금', percent: 15 },
  { value: 'normal', label: '보통', percent: 30 },
  { value: 'much', label: '많이', percent: 45 },
]
function validDraft(value: unknown): value is RouteDraft {
  if (!value || typeof value !== 'object') return false
  const v = value as RouteDraft
  return (
    (v.destination === null || isPlace(v.destination)) &&
    ['little', 'normal', 'much'].includes(v.detour) &&
    (v.plan === null || isRoutePlan(v.plan))
  )
}
const initialDraft = (): RouteDraft =>
  readStored(
    'route-draft',
    { destination: null, detour: 'normal', plan: null },
    validDraft,
  )
export default function RoutePage() {
  const { params } = useRoute()
  const location = useLocation()
  const drive = useDrive()
  const [draft, setDraft] = useState<RouteDraft>(initialDraft)
  const [manualOrigin, setManualOrigin] = useState<Place | null>(() =>
    readStored<Place | null>('route-origin', null, (v) => v === null || isPlace(v)),
  )
  const [showOriginSearch, setShowOriginSearch] = useState(false)
  const [query, setQuery] = useState(() => initialDraft().destination?.name ?? '')
  const [matches, setMatches] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchVersion, setSearchVersion] = useState(0)
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [favoritesError, setFavoritesError] = useState('')
  const [loadingFavorites, setLoadingFavorites] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  const demo = isDemoMode()
  const incomingName = params.destination || params.zone
  const incomingLat = params.lat
  const incomingLng = params.lng
  const showingResults = params.view === 'results'
  const activeDrive = !['idle', 'finished'].includes(drive.state.phase)

  function updateDraft(next: RouteDraft) {
    setDraft(next)
    writeStored('route-draft', next)
  }
  function selectPlace(place: Place) {
    setQuery(place.name)
    setMatches([])
    setSearchError('')
    setError('')
    updateDraft({ ...draft, destination: place, plan: null })
  }
  useEffect(() => {
    if (!incomingName || incomingLat === undefined || incomingLng === undefined) return
    const point = { lat: Number(incomingLat), lng: Number(incomingLng) }
    if (!validCoordinates(point)) return
    const place: Place = {
      ...point,
      id: `map-${point.lat}-${point.lng}`,
      name: incomingName,
      address: '지도에서 선택한 위치',
    }
    setQuery(place.name)
    setDraft((previous) => {
      const next = { ...previous, destination: place, plan: null }
      writeStored('route-draft', next)
      return next
    })
  }, [incomingName, incomingLat, incomingLng])
  useEffect(() => {
    let active = true
    getProfile()
      .then((profile) => {
        if (active) setFavorites(profile.favorites)
      })
      .catch((caught) => {
        if (active)
          setFavoritesError(
            caught instanceof Error ? caught.message : '즐겨찾기를 불러오지 못했어요.',
          )
      })
      .finally(() => {
        if (active) setLoadingFavorites(false)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestRef.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (query.trim().length < 2 || query === draft.destination?.name) {
      setSearching(false)
      setMatches([])
      return
    }
    const controller = new AbortController()
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setMatches(results)
        })
        .catch((caught) => {
          if (!controller.signal.aborted)
            setSearchError(
              caught instanceof Error ? caught.message : '장소 검색에 실패했어요.',
            )
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 300)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, draft.destination?.name, searchVersion])

  async function recommend() {
    if (lock.current) return
    if (!draft.destination) {
      setError('검색 결과에서 도착지를 선택해 주세요.')
      return
    }
    const origin =
      manualOrigin ?? location.position ?? (showingResults ? draft.plan?.origin : null)
    if (!origin) {
      setError(
        '출발 위치가 필요해요. 현재 위치를 확인하거나 출발지를 직접 선택해 주세요.',
      )
      return
    }
    lock.current = true
    setPending(true)
    setError('')
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const plan = await recommendRoute(
        { origin, destination: draft.destination, detour: draft.detour },
        controller.signal,
      )
      if (controller.signal.aborted) return
      updateDraft({ ...draft, plan })
      navigateTo('route', { view: 'results' })
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : '동선을 찾지 못했어요. 다시 시도해 주세요.',
        )
    } finally {
      lock.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }
  async function startDrive() {
    if (!draft.plan) return
    if (activeDrive) {
      navigateTo('drive')
      return
    }
    if ((await drive.start(draft.plan)) && mounted.current) navigateTo('drive')
  }
  function quickDestination(kind: 'home' | 'lpg' | 'ev') {
    const favorite = favorites.find((place) => place.kind === kind)
    if (favorite) {
      selectPlace({ ...favorite, name: favorite.label })
      return
    }
    if (kind === 'home') {
      setError('저장된 집이 없어요. 마이페이지에서 집을 추가해 주세요.')
      return
    }
    setQuery(kind === 'lpg' ? 'LPG 충전소' : '전기차 충전소')
    updateDraft({ ...draft, destination: null, plan: null })
  }

  return (
    <main className="page-shell nr-route-page">
      {activeDrive && (
        <div className="route-active-banner">
          <p>진행 중인 운행이 있어요. 종료한 후 새 운행을 시작할 수 있어요.</p>
          <button className="nr-secondary-button" onClick={() => navigateTo('drive')}>
            진행 중인 운행으로
          </button>
        </div>
      )}
      {showingResults && draft.plan ? (
        <RouteResults
          plan={draft.plan}
          pending={pending}
          starting={drive.pending}
          error={error || drive.error}
          onStart={startDrive}
          onRetry={recommend}
          onEdit={() => navigateTo('route')}
        />
      ) : (
        <section className="nr-route-form panel">
          <div className="nr-route-heading">
            <span className="eyebrow">동선 추천{demo ? ' · 데모' : ''}</span>
            <h1>어디로 이동하시나요?</h1>
            <p>목적지와 허용 가능한 우회 범위를 알려주세요.</p>
          </div>
          {demo && (
            <p className="nr-demo-note">
              예시 장소와 수요로 동작하는 데모입니다. 실제 길 안내가 아닙니다.
            </p>
          )}
          <div className="route-origin">
            <div>
              <strong>출발지</strong>
              <p>
                {manualOrigin
                  ? manualOrigin.name
                  : location.position
                    ? `현재 위치 ${location.position.lat.toFixed(4)}, ${location.position.lng.toFixed(4)}`
                    : '현재 위치를 확인해 주세요'}
              </p>
            </div>
            <button
              type="button"
              className="nr-secondary-button"
              disabled={location.status === 'loading' || pending}
              onClick={() => {
                setManualOrigin(null)
                writeStored('route-origin', null)
                location.requestLocation()
              }}
            >
              {location.status === 'loading' ? '확인 중…' : '위치 확인'}
            </button>
          </div>
          <button
            className="nr-text-button"
            disabled={pending}
            onClick={() => setShowOriginSearch((v) => !v)}
          >
            {showOriginSearch ? '출발지 검색 닫기' : '출발지 직접 선택'}
          </button>
          {showOriginSearch && (
            <PlaceSearch
              label="출발지 검색"
              disabled={pending}
              onSelect={(place) => {
                setManualOrigin(place)
                writeStored('route-origin', place)
                setShowOriginSearch(false)
                setError('')
                updateDraft({ ...draft, plan: null })
              }}
            />
          )}
          {location.error && !manualOrigin && (
            <p className="nr-route-error" role="alert">
              {location.error}
            </p>
          )}
          <label className="field route-destination">
            <span>도착지</span>
            <input
              aria-label="도착지 검색"
              autoComplete="off"
              value={query}
              disabled={pending}
              placeholder="장소 또는 주소를 2글자 이상 입력"
              onChange={(event) => {
                setQuery(event.target.value)
                setMatches([])
                setError('')
                updateDraft({ ...draft, destination: null, plan: null })
              }}
            />
          </label>
          {draft.destination && (
            <p className="route-selected-place">✓ {draft.destination.address}</p>
          )}
          <div className="route-search-state" aria-live="polite">
            {searching && <p>장소를 찾는 중…</p>}
            {searchError && (
              <div role="alert">
                <p>{searchError}</p>
                <button
                  className="nr-text-button"
                  onClick={() => setSearchVersion((v) => v + 1)}
                >
                  검색 다시 시도
                </button>
              </div>
            )}
            {!searching &&
              !searchError &&
              query.trim().length >= 2 &&
              !draft.destination &&
              matches.length === 0 && (
                <p>
                  검색 결과가 없어요.
                  {demo
                    ? ' 데모에서는 강남역, 삼성역, 잠실역 등을 검색해 보세요.'
                    : ' 다른 장소나 주소를 입력해 주세요.'}
                </p>
              )}
          </div>
          {matches.length > 0 && !draft.destination && (
            <ul className="route-search-results" aria-label="장소 검색 결과">
              {matches.map((place) => (
                <li key={place.id}>
                  <button onClick={() => selectPlace(place)}>
                    <strong>{place.name}</strong>
                    <span>{place.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="quick-destinations">
            <button
              disabled={pending || loadingFavorites}
              onClick={() => quickDestination('home')}
            >
              ⌂ 집
            </button>
            <button
              disabled={pending || loadingFavorites}
              onClick={() => quickDestination('lpg')}
            >
              LPG 충전소
            </button>
            <button
              disabled={pending || loadingFavorites}
              onClick={() => quickDestination('ev')}
            >
              ϟ 전기차 충전소
            </button>
          </div>
          {favoritesError && (
            <p className="nr-route-error">
              {favoritesError} 장소 검색은 계속 사용할 수 있어요.
            </p>
          )}
          {error.includes('저장된 집') && (
            <button className="nr-text-button" onClick={() => navigateTo('mypage')}>
              즐겨찾기 설정으로
            </button>
          )}
          <fieldset className="route-detour">
            <legend>조금 돌아가도 괜찮으세요?</legend>
            <div className="segmented">
              {detours.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={pending}
                  aria-pressed={draft.detour === option.value}
                  className={draft.detour === option.value ? 'selected' : ''}
                  onClick={() =>
                    updateDraft({ ...draft, detour: option.value, plan: null })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p>
              직행 시간보다 최대{' '}
              {detours.find((option) => option.value === draft.detour)?.percent}% 더
              걸리는 범위에서 찾아요.
            </p>
          </fieldset>
          {error && (
            <p className="nr-route-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            disabled={pending || activeDrive}
            onClick={recommend}
          >
            {pending ? '수요와 동선을 확인하는 중…' : '동선 추천받기'}
          </button>
          {showingResults && !draft.plan && (
            <p className="nr-route-error">
              저장된 추천 결과가 없어요. 새 동선을 추천받아 주세요.
            </p>
          )}
        </section>
      )}
    </main>
  )
}
