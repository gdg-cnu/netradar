import Brand from "../common/Brand"
import { navItems } from "../../data/navigation"
import type { Page } from "../../types/app"
import { assetUrl } from "../../utils/assets"

export default function Navigation({
  page,
  onChange,
}: {
  page: Page
  onChange: (page: Page) => void
}) {
  return (
    <>
      <header className="desktop-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="주요 메뉴">
            {navItems.map((item) => (
              <button
                className={page === item.id ? "active" : ""}
                aria-current={page === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => onChange(item.id)}
              >
                <img src={assetUrl(item.icon)} alt="" />
                {item.label}
              </button>
            ))}
          </nav>
          <button className="profile-pill" onClick={() => onChange("mypage")}>
            이솔민 기사님
          </button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="주요 메뉴">
        {navItems.map((item) => (
          <button
            className={page === item.id ? "active" : ""}
            aria-current={page === item.id ? "page" : undefined}
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
