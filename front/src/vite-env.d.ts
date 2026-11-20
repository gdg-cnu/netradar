/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'demo' | 'live'
  readonly VITE_DEMO_VERSION?: 'v1' | 'v2'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_PLACE_SEARCH_SOURCE?: 'sample' | 'unknown'
  readonly VITE_ROUTE_ESTIMATE_SOURCE?: 'sample' | 'unknown'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_TERMS_URL?: string
  readonly VITE_PRIVACY_URL?: string
}
