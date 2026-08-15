/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRACKER_PROFILE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
