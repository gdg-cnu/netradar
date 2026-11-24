import { isDemoMode } from '../services/api'

// V2 routing/trips/replay remain local previews until their server APIs are ready.
export const isV2Preview = () =>
  isDemoMode() && import.meta.env?.VITE_DEMO_VERSION !== 'v1'

// Opt in to public V2 read APIs without changing authentication or trip storage.
export const isV2ServerData = () =>
  isV2Preview() && import.meta.env?.VITE_V2_DATA_SOURCE === 'api'
