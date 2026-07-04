import { z } from "zod";

/**
 * Esquemas Zod de disponibilidad — fuente única para form y Server Action.
 * `.strict()` para cortar mass assignment (tenantId/courtId nunca del payload).
 */

// "HH:MM" 24h.
const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (formato HH:MM).");

export const createAvailabilitySchema = z
  .object({
    dayOfWeek: z
      .number({ message: "Día inválido." })
      .int()
      .min(0, "Día inválido.")
      .max(6, "Día inválido."),
    openTime: timeStr,
    closeTime: timeStr,
  })
  .strict()
  .refine((v) => v.closeTime > v.openTime, {
    message: "La hora de cierre debe ser posterior a la de apertura.",
    path: ["closeTime"],
  });

export const slotDurationSchema = z
  .object({
    slotDurationMin: z
      .number({ message: "Duración inválida." })
      .int("La duración debe ser un número entero de minutos.")
      .min(15, "La duración mínima es 15 minutos.")
      .max(1440, "La duración máxima es 24 horas."),
  })
  .strict();

// Fecha "YYYY-MM-DD" para el preview de slots.
export const previewDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type SlotDurationInput = z.infer<typeof slotDurationSchema>;
