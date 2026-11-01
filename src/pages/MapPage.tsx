import { useState } from "react"
import Segmented from "../components/common/Segmented"
import LocationModal from "../components/map/LocationModal"
import MapPin from "../components/map/MapPin"
import { mapMarkers } from "../data/mock"
import { assetUrl } from "../utils/assets"

export default function MapPage() {
  const [metric, setMetric] = useState("시급 보기")
  const [time, setTime] = useState("지금")
  const [showPermission, setShowPermission] = useState(true)
  const [query, setQuery] = useState("")

  return (
    <main className="map-page">
      <section className="map-canvas" aria-label="서울 예상 시급 지도">
        <img
          className="map-image"
          src={assetUrl("5b961.png")}
          alt="서울 강남 지역 지도"
        />
        <div className="map-toolbar">
          <form
            className="map-search"
            onSubmit={(event) => {
              event.preventDefault()
              setShowPermission(false)
            }}
          >
            <img src={assetUrl("2f426.svg")} alt="" />
            <input
              aria-label="장소 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="여기서 검색"
            />
            <button aria-label="검색" type="submit">
              <img src={assetUrl("773cc.svg")} alt="" />
            </button>
          </form>
          <div className="map-filters">
            <Segmented
              options={["시급 보기", "승객 수 보기"]}
              value={metric}
              onChange={setMetric}
            />
            <Segmented
              options={["지금", "+30분", "+60분"]}
              value={time}
              onChange={setTime}
            />
          </div>
        </div>
        {mapMarkers.map((marker) => (
          <MapPin key={marker.name} marker={marker} />
        ))}
        <div className="my-location">내 위치</div>
      </section>
      <aside className="map-insight">
        <span className="eyebrow">실시간 추천</span>
        <h1>
          지금 강남역 방향의
          <br />
          예상 시급이 높아요
        </h1>
        <p>
          현재 위치에서 12분 거리예요. 수요와 교통 상황을 반영한 예상
          금액입니다.
        </p>
        <div className="earning-card">
          <span>예상 시급</span>
          <strong>3.2만 원</strong>
          <small>현재 대비 +8,000원</small>
        </div>
        <button
          className="primary-button"
          onClick={() => setShowPermission(false)}
        >
          이 방향으로 동선 추천
        </button>
      </aside>
      {showPermission && (
        <LocationModal onClose={() => setShowPermission(false)} />
      )}
    </main>
  )
}
