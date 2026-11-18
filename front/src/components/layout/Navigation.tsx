import Brand from '../common/Brand'
import { navItems } from '../../data/navigation'
import type { Page } from '../../types/app'
import { assetUrl } from '../../utils/assets'
import { isV2Preview } from '../../v2/mode'

export default function Navigation({
  page,
  onChange,
  userName,
}: {
  page: Page
  onChange: (page: Page) => void
  userName: string
}) {
  const items = navItems.map((item) => ({
    ...item,
    label: item.id === 'map' && isV2Preview() ? '수요 지도' : item.label,
  }))
  return (
    <>
      <header className="desktop-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="주요 메뉴">
            {items.map((item) => (
              <button
                className={page === item.id ? 'active' : ''}
                aria-current={page === item.id ? 'page' : undefined}
                key={item.id}
                onClick={() => onChange(item.id)}
              >
                <img src={assetUrl(item.icon)} alt="" />
                {item.label}
              </button>
            ))}
          </nav>
          <button className="profile-pill" onClick={() => onChange('mypage')}>
            {userName}
          </button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="주요 메뉴">
        {items.map((item) => (
          <button
            className={page === item.id ? 'active' : ''}
            aria-current={page === item.id ? 'page' : undefined}
            key={item.id}
            onClick={() => onChange(item.id)}
          >
            <img src={assetUrl(item.icon)} alt="" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}
