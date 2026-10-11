import type { AppConfig } from "@/config/env";
import type { MedrisApi } from "@/services/api/endpoints";
import type { V1Api } from "@/services/api/v1-endpoints";

declare global {
  interface Window {
    /** Typed config + API client published by the React root (see src/app/runtime.ts). */
    medris?: Readonly<{ config: AppConfig; api: MedrisApi; v1: V1Api }>;
  }
}

export {};
