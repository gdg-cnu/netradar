import { Component, Suspense, lazy, type ReactNode } from 'react'
import type { RoutePlan } from '../../types/route'

const RouteComparisonMap = lazy(() => import('./RouteComparisonMap'))
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <p className="route-map-fallback" role="status">
          경로 지도를 불러오지 못했어요. 아래 시간·거리·수익 비교와 경유지 목록은 계속
          확인할 수 있어요.
        </p>
      )
    return this.props.children
  }
}
export default function RouteMapPanel({ plan }: { plan: RoutePlan }) {
  return (
    <MapBoundary key={plan.id}>
      <Suspense
        fallback={
          <p className="route-map-fallback" role="status">
            경로 지도를 준비하는 중이에요.
          </p>
        }
      >
        <RouteComparisonMap plan={plan} />
      </Suspense>
    </MapBoundary>
  )
}
