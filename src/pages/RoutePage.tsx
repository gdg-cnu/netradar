import { useState } from "react"
import Segmented from "../components/common/Segmented"
import RecommendedPlaces from "../components/route/RecommendedPlaces"
import { assetUrl } from "../utils/assets"

export default function RoutePage() {
  const [detour, setDetour] = useState("보통")
  const [destination, setDestination] = useState("")
  const [submitted, setSubmitted] = useState(false)

  return (
    <main className="page-shell route-layout">
      <section className="route-form panel">
        <div className="section-heading">
          <span className="eyebrow">동선 추천</span>
          <h1>어디로 이동하시나요?</h1>
          <p>목적지와 허용 가능한 우회 범위를 알려주세요.</p>
        </div>
        <label className="field">
          <span>출발지</span>
          <input
            aria-label="출발지"
            value="현위치 : 서울특별시 00로 0000"
            readOnly
          />
        </label>
        <label className="field">
          <span>도착지</span>
          <input
            aria-label="도착지"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="도착지 입력"
          />
        </label>
        <div className="quick-destinations">
          <button onClick={() => setDestination("서울 송파구 잠실동")}>
            ⌂ <span>집</span>
          </button>
          <button onClick={() => setDestination("강남복합충전소")}>
            <img src={assetUrl("1b7a9.png")} alt="" /> <span>주유소</span>
          </button>
          <button onClick={() => setDestination("서울 전기차충전소")}>
            ϟ <span>전기차충전소</span>
          </button>
        </div>
        <div className="detour-block">
          <h2>조금 돌아가도 괜찮으세요?</h2>
          <Segmented
            options={["조금", "보통", "많이"]}
            value={detour}
            onChange={setDetour}
          />
          <p>
            ‘{detour}'은 바로 가는 시간보다 최대{" "}
            {detour === "조금" ? "15" : detour === "보통" ? "30" : "45"}% 더
            걸려요
          </p>
        </div>
        <button className="primary-button" onClick={() => setSubmitted(true)}>
          동선 추천
        </button>
      </section>
      <RecommendedPlaces submitted={submitted} onSelect={setDestination} />
    </main>
  )
}
