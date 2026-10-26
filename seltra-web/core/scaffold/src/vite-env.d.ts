/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SELTRA_API_URL?: string
  readonly VITE_SELTRA_STORE_SLUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
