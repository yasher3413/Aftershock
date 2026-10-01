interface ImportMetaEnv {
  /** Live socket URL when the api runs on another host (Vercel deployments). */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
