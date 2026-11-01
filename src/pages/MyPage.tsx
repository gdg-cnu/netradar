import { useState } from "react"
import { settingItems } from "../data/mock"
import { assetUrl } from "../utils/assets"

export default function MyPage({ onLogout }: { onLogout: () => void }) {
  const [notice, setNotice] = useState("")
  return (
    <main className="page-shell mypage-layout">
      <section className="profile-column">
        <div className="profile-card">
          <div className="avatar">
            <img src={assetUrl("0d2ea.svg")} alt="" />
          </div>
          <div>
            <h1>이솔민</h1>
            <p>오늘도 안전 운전하세요.</p>
          </div>
        </div>
        <div className="panel list-panel">
          <h2>즐겨찾기</h2>
          <button onClick={() => setNotice("집 주소를 선택했어요.")}>
            <img src={assetUrl("b6707.svg")} alt="" />
            <span>
              <strong>집</strong>
              <small>서울 송파구 잠실동</small>
            </span>
            <b>›</b>
          </button>
          <button onClick={() => setNotice("LPG 충전소를 선택했어요.")}>
            <img src={assetUrl("aefc9.svg")} alt="" />
            <span>
              <strong>LPG 충전소</strong>
              <small>강남복합충전소</small>
            </span>
            <b>›</b>
          </button>
          <button
            className="add-place"
            onClick={() => setNotice("새 장소를 추가할 수 있어요.")}
          >
            + 장소 추가
          </button>
        </div>
      </section>
      <section className="panel list-panel settings-panel">
        <h2>계정 및 앱 설정</h2>
        {settingItems.map(({ icon, title, description }) => (
          <button
            key={title}
            onClick={() => setNotice(`${title} 메뉴를 선택했어요.`)}
          >
            <img src={assetUrl(icon)} alt="" />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <b>›</b>
          </button>
        ))}
        <button onClick={onLogout}>
          <img src={assetUrl("e5416.svg")} alt="" />
          <span>
            <strong>로그아웃</strong>
          </span>
          <b>›</b>
        </button>
      </section>
      {notice && (
        <button className="toast" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}
    </main>
  )
}
