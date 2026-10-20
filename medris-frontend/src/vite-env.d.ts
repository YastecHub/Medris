/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
  readonly VITE_API_BASE_URL?: string;
  /** The backend's own API (/api/v1) on another origin (e.g. Heroku); empty = same as VITE_API_BASE_URL. */
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_DEV_API_PROXY?: string;
  /** Features served through medris-backend (/api/v1): comma list, "all" or empty. See src/services/backend-features.ts. */
  readonly VITE_BACKEND_FEATURES?: string;
  /** Screens drawn by React: comma list, "all" or empty (= none). See src/bridge/view-registry.ts. */
  readonly VITE_REACT_VIEWS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
