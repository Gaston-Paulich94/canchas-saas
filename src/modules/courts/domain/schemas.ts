import { z } from "zod";
import { COURT_SPORTS } from "@/modules/courts/domain/court";

/**
 * Esquemas Zod del módulo canchas — fuente única para el form (react-hook-form)
 * y la Server Action.
 *
 * `.strict()`: rechaza campos extra en vez de descartarlos en silencio (corta
 * mass assignment; ej. que el cliente intente colar `tenantId` o `id`). El
 * tenant SIEMPRE lo decide el servidor, nunca viaja en el payload.
 */

const name = z
  .string()
  .trim()
  .min(2, "El nombre es muy corto.")
  .max(120, "El nombre es demasiado largo.");

const sport = z.enum(COURT_SPORTS, {
  message: "Elegí un deporte válido.",
});

// Opcional: "" del form se normaliza a null (columna nullable).
const surface = z
  .string()
  .trim()
  .max(120, "La superficie es demasiado larga.")
  .optional()
  .transform((v) => (v ? v : null));

const indoor = z.boolean();
const isActive = z.boolean();

// Precio de referencia por hora en pesos ARS (entero, no negativo). Opcional.
const pricePerHour = z
  .number({ message: "El precio debe ser un número." })
  .int("El precio debe ser un número entero.")
  .min(0, "El precio no puede ser negativo.")
  .max(100_000_000, "El precio es demasiado alto.")
  .nullable()
  .optional()
  .transform((v) => (v == null ? null : v));

export const courtInputSchema = z
  .object({
    name,
    sport,
    surface,
    indoor,
    isActive,
    pricePerHour,
  })
  .strict();

// Alta y edición comparten la misma forma (el id de la edición va aparte, del
// servidor, nunca del payload).
export const createCourtSchema = courtInputSchema;
export const updateCourtSchema = courtInputSchema;

export type CourtInput = z.infer<typeof courtInputSchema>;
