import Navigation from "./components/layout/Navigation"
import { useAppSession } from "./hooks/useAppSession"
import LoginPage from "./pages/LoginPage"
import MapPage from "./pages/MapPage"
import MyPage from "./pages/MyPage"
import ReplayPage from "./pages/ReplayPage"
import RoutePage from "./pages/RoutePage"

export default function App() {
  const { loggedIn, page, setPage, login, logout } = useAppSession()

  if (!loggedIn) return <LoginPage onLogin={login} />

  return (
    <div className="app">
      <Navigation page={page} onChange={setPage} />
      {page === "map" && <MapPage />}
      {page === "route" && <RoutePage />}
      {page === "replay" && <ReplayPage />}
      {page === "mypage" && <MyPage onLogout={logout} />}
    </div>
  )
}
