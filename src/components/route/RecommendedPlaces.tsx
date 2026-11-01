import { recommendedPlaces } from "../../data/mock"

interface RecommendedPlacesProps {
  submitted: boolean
  onSelect: (destination: string) => void
}

export default function RecommendedPlaces({
  submitted,
  onSelect,
}: RecommendedPlacesProps) {
  return (
    <section className="recommendations">
      <div className="section-heading">
        <span className="eyebrow">추천 경유지</span>
        <h2>
          {submitted ? "최적의 동선을 찾았어요" : "이 지역을 자주 추천해요"}
        </h2>
      </div>
      <div className="place-list">
        {recommendedPlaces.map((place, index) => (
          <button
            key={place.name}
            className="place-card"
            onClick={() => onSelect(place.name)}
          >
            <span className="place-number">{index + 1}</span>
            <span>
              <strong>{place.name}</strong>
              <small>
                {place.travelMinutes}분 이동 · 예상 시급 {place.hourlyRate}만 원
              </small>
            </span>
            <span className="chevron">›</span>
          </button>
        ))}
      </div>
    </section>
  )
}
