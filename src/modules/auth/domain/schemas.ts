import { z } from "zod";

/**
 * Esquemas Zod del módulo auth — fuente única de verdad para forms y actions.
 *
 * `.strict()` en todos: rechazan campos extra en lugar de descartarlos en
 * silencio. Esto corta mass assignment (ej. que el cliente intente colar un
 * `role` o un `tenantId`). El rol y el tenant SIEMPRE los decide el servidor.
 */

const email = z.string().trim().toLowerCase().email("Email inválido.").max(254);

// Política de contraseña alineada con better-auth (mín. 12, máx. 128).
const password = z
  .string()
  .min(12, "La contraseña debe tener al menos 12 caracteres.")
  .max(128, "La contraseña es demasiado larga.");

export const registerOwnerSchema = z
  .object({
    complejoName: z
      .string()
      .trim()
      .min(2, "El nombre del complejo es muy corto.")
      .max(120),
    ownerName: z
      .string()
      .trim()
      .min(2, "Tu nombre es muy corto.")
      .max(120),
    email,
    password,
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, "Ingresá tu contraseña.").max(128),
  })
  .strict();

export type RegisterOwnerInput = z.infer<typeof registerOwnerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
