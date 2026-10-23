/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BIRDBRAIN_BASE?: string;
  readonly VITE_MATRIX_HOMESERVER?: string;
  readonly VITE_COLLAB_URL?: string;
  readonly VITE_EDITION?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The group's own pack (`src/demo/packs/<edition>.json`), put in by vite.config.ts
 *  for that edition's build only; null everywhere else. */
declare const __PACK__: unknown;
