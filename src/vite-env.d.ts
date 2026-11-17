/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

/** Dev-only variables from `.env`. Read them only under `import.meta.env.DEV`. See `.env.example`. */
interface ImportMetaEnv {
  readonly VITE_DEV_HA_URL?: string;
  readonly VITE_DEV_HA_TOKEN?: string;
}
