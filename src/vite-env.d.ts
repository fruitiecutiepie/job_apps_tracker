/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRACKER_PROFILE?: string
  /** `browser` selects the static build's own storage; anything else means the dev server. */
  readonly VITE_TRACKER_BACKEND?: string
  /** Where usage counts are posted. Set only by the Cloudflare build; absent, none are sent. */
  readonly VITE_USAGE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
