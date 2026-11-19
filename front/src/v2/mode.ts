import { isDemoMode } from '../services/api'

// Retain the existing live API client until the backend v2 contract is agreed.
export const isV2Preview = () =>
  isDemoMode() && import.meta.env?.VITE_DEMO_VERSION !== 'v1'
