/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRACKER_PROFILE?: string
  /** `browser` selects the static build's own storage; anything else means the dev server. */
  readonly VITE_TRACKER_BACKEND?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
