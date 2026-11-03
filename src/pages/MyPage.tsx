import { useEffect, useRef, useState } from 'react'
import FavoriteEditor from '../components/profile/FavoriteEditor'
import TermsDialog from '../components/common/TermsDialog'
import { useLocation } from '../hooks/useLocation'
import { getProfileForSettings, saveProfile } from '../services/profile'
import { isDemoMode } from '../services/api'
import type { FavoritePlace, UserProfile } from '../types/profile'
import { navigateTo } from '../utils/navigation'
import { assetUrl } from '../utils/assets'
import { getStorageScope } from '../utils/storage'
import '../styles/profile.css'

const permissionLabels: Record<string, string> = {
  idle: '아직 요청하지 않았어요',
  loading: '위치 확인 중',
  granted: '위치 사용 가능',
  denied: '위치 권한이 거절되었어요',
  unavailable: '현재 위치를 확인할 수 없어요',
}

export default function MyPage({
  onLogout,
  userName,
}: {
  onLogout: () => void
  userName?: string
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [registration, setRegistration] = useState<UserProfile | null>(null)
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState('LPG')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<FavoritePlace | 'new' | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  const [reload, setReload] = useState(0)
  const mutation = useRef(false)
  const mounted = useRef(true)
  const location = useLocation()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const account = getStorageScope()
    const current = () => active && account === getStorageScope()
    setLoading(true)
    setProfile(null)
    setRegistration(null)
    setNotice('')
    setEditing(null)
    setError('')
    getProfileForSettings(userName)
      .then((result) => {
        if (!current()) return
        const value = result.kind === 'registered' ? result.profile : result.draft
        if (result.kind === 'registered') setProfile(result.profile)
        else setRegistration(result.draft)
        setName(value.name)
        setVehicleType(value.vehicleType)
      })
      .catch((cause) => {
        if (current())
          setError(
            cause instanceof Error ? cause.message : '프로필을 불러오지 못했습니다.',
          )
      })
      .finally(() => {
        if (current()) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload, userName])

  async function persist(next: UserProfile, message: string): Promise<boolean> {
    if (mutation.current) return false
    const account = getStorageScope()
    const current = () => mounted.current && account === getStorageScope()
    mutation.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveProfile(next)
      if (!current()) return false
      setProfile(saved)
      setRegistration(null)
      setName(saved.name)
      setVehicleType(saved.vehicleType)
      setNotice(message)
      return true
    } catch (cause) {
      if (!current()) return false
      const message =
        cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해주세요.'
      setError(message)
      throw new Error(message)
    } finally {
      mutation.current = false
      if (current()) setSaving(false)
    }
  }

  async function saveFavorite(favorite: FavoritePlace) {
    if (!profile) return
    const found = profile.favorites.some((item) => item.id === favorite.id)
    const saved = await persist(
      {
        ...profile,
        favorites: found
          ? profile.favorites.map((item) => (item.id === favorite.id ? favorite : item))
          : [...profile.favorites, favorite],
      },
      '즐겨찾기를 저장했어요.',
    )
    if (saved) setEditing(null)
  }

  const formProfile = profile ?? registration

  return (
    <main className="page-shell profile-page">
      <div className="profile-page-heading">
        <span className="eyebrow">마이페이지</span>
        <h1>나의 운행 설정</h1>
        {isDemoMode() && (
          <p className="profile-hint">데모 프로필과 설정은 이 브라우저에 저장됩니다.</p>
        )}
      </div>
      {error && (
        <div className="profile-error" role="alert">
          {error}
          {!profile && !registration && (
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              다시 불러오기
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="profile-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">프로필을 불러오는 중…</p>
      ) : (
        formProfile && (
          <div className={profile ? 'profile-grid' : 'profile-registration'}>
            <section className="profile-panel panel">
              {registration ? (
                <div className="profile-registration-heading">
                  <h2>프로필을 처음 등록해 주세요</h2>
                  <p>
                    아직 저장된 프로필이 없습니다. 이름과 차종을 확인한 뒤 등록해 주세요.
                    저장 후 즐겨찾기와 앱 설정을 사용할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="profile-identity">
                  <div className="avatar">
                    <img src={assetUrl('0d2ea.svg')} alt="" />
                  </div>
                  <div>
                    <h2>{formProfile.name || userName} 기사님</h2>
                    <p>오늘도 안전 운전하세요.</p>
                  </div>
                </div>
              )}
              <form
                className="profile-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!name.trim()) {
                    setError('이름을 입력해주세요.')
                    return
                  }
                  void persist(
                    { ...formProfile, name: name.trim(), vehicleType },
                    registration ? '프로필을 등록했어요.' : '프로필을 저장했어요.',
                  ).catch(() => {})
                }}
              >
                <label>
                  이름
                  <input
                    value={name}
                    disabled={saving}
                    maxLength={30}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  차종
                  <select
                    value={vehicleType}
                    disabled={saving}
                    onChange={(event) => setVehicleType(event.target.value)}
                  >
                    <option>LPG</option>
                    <option>전기</option>
                    <option>휘발유</option>
                    <option>경유</option>
                    <option>하이브리드</option>
                  </select>
                </label>
                <button className="primary-button" disabled={saving}>
                  {saving ? '저장 중…' : registration ? '프로필 등록' : '프로필 저장'}
                </button>
              </form>
              {profile && (
                <button
                  className="profile-history-link"
                  onClick={() => navigateTo('replay')}
                >
                  운행 기록 확인 <span aria-hidden="true">→</span>
                </button>
              )}
            </section>
            {profile && (
              <>
                <section className="profile-panel panel">
                  <div className="profile-section-heading">
                    <h2>즐겨찾기</h2>
                    <button
                      className="profile-text-button"
                      onClick={() => setEditing('new')}
                      disabled={saving}
                    >
                      + 장소 추가
                    </button>
                  </div>
                  {profile.favorites.length === 0 ? (
                    <p className="profile-empty">
                      저장한 장소가 없습니다. 자주 가는 목적지를 추가해보세요.
                    </p>
                  ) : (
                    <ul className="favorite-list">
                      {profile.favorites.map((favorite) => (
                        <li key={favorite.id}>
                          <button
                            className="favorite-destination"
                            onClick={() =>
                              navigateTo('route', {
                                destination: favorite.label,
                                lat: String(favorite.lat),
                                lng: String(favorite.lng),
                              })
                            }
                          >
                            <strong>{favorite.label}</strong>
                            <span>{favorite.address}</span>
                          </button>
                          <div className="favorite-actions">
                            <button
                              onClick={() => setEditing(favorite)}
                              disabled={saving}
                              aria-label={`${favorite.label} 수정`}
                            >
                              수정
                            </button>
                            <button
                              onClick={() =>
                                void persist(
                                  {
                                    ...profile,
                                    favorites: profile.favorites.filter(
                                      (item) => item.id !== favorite.id,
                                    ),
                                  },
                                  '즐겨찾기를 삭제했어요.',
                                ).catch(() => {})
                              }
                              disabled={saving}
                              aria-label={`${favorite.label} 삭제`}
                            >
                              삭제
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="profile-panel panel profile-settings">
                  <h2>앱 설정</h2>
                  <div className="profile-setting-row">
                    <div>
                      <strong>위치 권한</strong>
                      <p>{permissionLabels[location.status] ?? location.status}</p>
                      {location.error && (
                        <p className="profile-error">{location.error}</p>
                      )}
                    </div>
                    <button
                      className="profile-secondary"
                      onClick={location.requestLocation}
                      disabled={location.status === 'loading'}
                    >
                      위치 확인
                    </button>
                  </div>
                  <label className="profile-setting-row">
                    <div>
                      <strong>앱 내 알림</strong>
                      <p>경유지와 추천 안내 표시 설정</p>
                    </div>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={profile.notifications}
                      disabled={saving}
                      onChange={(event) =>
                        void persist(
                          { ...profile, notifications: event.target.checked },
                          '알림 설정을 저장했어요.',
                        ).catch(() => {})
                      }
                    />
                  </label>
                  <button
                    className="profile-setting-link"
                    onClick={() => setShowTerms(true)}
                  >
                    서비스 이용·개인정보 안내 <span aria-hidden="true">›</span>
                  </button>
                  <button
                    className="profile-setting-link profile-logout"
                    onClick={onLogout}
                    disabled={saving}
                  >
                    로그아웃 <span aria-hidden="true">›</span>
                  </button>
                </section>
              </>
            )}
          </div>
        )
      )}
      {!profile && !loading && (
        <button
          className="profile-initial-logout profile-secondary"
          onClick={onLogout}
          disabled={saving}
        >
          로그아웃
        </button>
      )}
      {editing && (
        <FavoriteEditor
          favorite={editing === 'new' ? undefined : editing}
          onSave={saveFavorite}
          onClose={() => setEditing(null)}
          saving={saving}
        />
      )}
      {showTerms && <TermsDialog onClose={() => setShowTerms(false)} />}
    </main>
  )
}
