import { useState } from "react"
import Calendar from "../components/replay/Calendar"
import RideCard from "../components/replay/RideCard"
import { rideRecords } from "../data/mock"

export default function ReplayPage() {
  const [selectedDay, setSelectedDay] = useState(24)
  return (
    <main className="page-shell replay-layout">
      <Calendar selected={selectedDay} onSelect={setSelectedDay} />
      <section className="records">
        <div className="record-summary">
          <span>2026년 10월 {selectedDay}일 운행기록</span>
          <h1>
            총 추가 수익은 <em>4.2만 원</em>이에요.
          </h1>
          <p>추천 동선과 실제 운행 결과를 비교해 저장했어요.</p>
        </div>
        <div className="ride-grid">
          {rideRecords.map((ride) => (
            <RideCard key={ride.name} ride={ride} />
          ))}
        </div>
      </section>
    </main>
  )
}
