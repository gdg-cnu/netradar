import type { MapMarker } from "../../types/app"

export default function MapPin({ marker }: { marker: MapMarker }) {
  return (
    <div className={`map-pin ${marker.className}`}>
      <strong>{marker.hourlyRate}</strong>
      <span>{marker.name}</span>
    </div>
  )
}
