import { z } from "../../shared/openapi/zod.js";

/** Response shapes of /api/v1/me. */

export const MeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.enum(["buyer", "vendor", "admin"]),
    city: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    roleSelected: z.boolean(),
    hasPassword: z.boolean(),
    isSuperAdmin: z.boolean(),
    suspendedAt: z.string().nullable(),
  })
  .openapi("Me");
