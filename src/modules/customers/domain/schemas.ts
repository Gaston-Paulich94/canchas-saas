import { z } from "zod";

/**
 * Esquemas Zod de clientes — fuente única para forms y Server Actions.
 * `.strict()`: rechaza campos extra (anti mass assignment; tenantId nunca
 * viaja en el payload).
 */

const name = z
  .string()
  .trim()
  .min(2, "El nombre es muy corto.")
  .max(120, "El nombre es demasiado largo.");

// Mismo criterio laxo que reservas (formatos AR variados); "" → null.
const phone = z
  .string()
  .trim()
  .max(30, "El teléfono es demasiado largo.")
  .regex(/^[+0-9()\-\s]*$/, "El teléfono tiene caracteres inválidos.")
  .optional()
  .transform((v) => (v ? v : null));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email inválido.")
  .max(254)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const notes = z
  .string()
  .trim()
  .max(500, "Las notas son demasiado largas.")
  .optional()
  .transform((v) => (v ? v : null));

export const customerInputSchema = z
  .object({
    name,
    phone,
    email,
    notes,
  })
  .strict();

// Alta y edición comparten forma; el id de la edición va aparte (del servidor).
export const createCustomerSchema = customerInputSchema;
export const updateCustomerSchema = customerInputSchema;

// Búsqueda del listado (query GET).
export const customerSearchSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));

export type CustomerInput = z.infer<typeof customerInputSchema>;
