import FreshnessBadge from '../../../components/common/FreshnessBadge'
import type { FreshnessStatus } from '../../../utils/freshness'
import type { DemandSource } from '../../types/demand'

export interface DemandMetadata {
  source: DemandSource
  generatedAt: string
}
export const serverSourceLabel = (source: DemandSource) =>
  source === 'mock' ? '서버 예시 데이터' : '서버 모델 예측'

export default function DemandDataMetadata({
  metadata,
  freshness,
}: {
  metadata: DemandMetadata
  freshness: FreshnessStatus
}) {
  return (
    <div className="v2-server-metadata">
      <span className="v2-demand-chip" data-source={metadata.source}>
        {serverSourceLabel(metadata.source)}
      </span>
      <FreshnessBadge status={freshness} generatedAt={metadata.generatedAt} />
    </div>
  )
}
