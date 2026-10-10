import type { AppConfig } from "@/config/env";
import type { MedrisApi } from "@/services/api/endpoints";

declare global {
  interface Window {
    /** Typed config + API client published by the React root (see src/app/runtime.ts). */
    medris?: Readonly<{ config: AppConfig; api: MedrisApi }>;
  }
}

export {};
