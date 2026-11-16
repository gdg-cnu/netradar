import { lazy, Suspense, useEffect, useState } from 'react'
import Navigation from './components/layout/Navigation'
import { useAppSession } from './hooks/useAppSession'
import { useRoute } from './hooks/useRoute'
import LoginPage from './pages/LoginPage'
import { isDemoMode } from './services/api'
import './styles/app.css'

const MapPage = lazy(() => import('./pages/MapPage'))
const RoutePage = lazy(() => import('./pages/RoutePage'))
const DrivePage = lazy(() => import('./pages/DrivePage'))
const ReplayPage = lazy(() => import('./pages/ReplayPage'))
const MyPage = lazy(() => import('./pages/MyPage'))

export default function App() {
  const { user, ready, error, loginDemo, logout } = useAppSession()
  const { page, navigateTo } = useRoute()
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    const warn = () => setStorageError(true)
    window.addEventListener('netradar:storage-error', warn)
    return () => window.removeEventListener('netradar:storage-error', warn)
  }, [])
  if (!ready)
    return (
      <main className="app-loading" role="status">
        로그인 상태를 확인하고 있어요…
      </main>
    )
  if (!user) return <LoginPage onDemoLogin={loginDemo} error={error} />
  return (
    <div className={`app ${isDemoMode() ? 'demo-app' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        본문으로 이동
      </a>
      <Navigation page={page} onChange={navigateTo} userName={user.name} />
      {isDemoMode() && (
        <div className="demo-banner">데모 모드 · 예시 예측과 운행 데이터입니다.</div>
      )}
      {storageError && (
        <div className="app-alert" role="alert">
          이 브라우저에 저장할 수 없습니다. 새로고침하면 변경 내용이 사라질 수 있습니다.
          <button onClick={() => setStorageError(false)}>닫기</button>
        </div>
      )}
      {error && (
        <div className="app-alert" role="alert">
          {error}
        </div>
      )}
      <div id="main-content" tabIndex={-1} key={user.id}>
        <Suspense
          fallback={
            <div className="app-loading" role="status">
              화면을 불러오고 있어요…
            </div>
          }
        >
          {page === 'map' && <MapPage />}
          {page === 'route' && <RoutePage />}
          {page === 'drive' && <DrivePage />}
          {page === 'replay' && <ReplayPage />}
          {page === 'mypage' && (
            <MyPage
              onLogout={() => {
                void logout()
              }}
              userName={user.name}
            />
          )}
        </Suspense>
      </div>
    </div>
  )
}
