import { z } from "zod";

/**
 * Esquemas Zod de reservas — fuente única para forms y Server Actions.
 * `.strict()`: rechaza campos extra (anti mass assignment; tenantId y status
 * NUNCA viajan en el payload, los decide el servidor).
 */

const uuid = z.string().uuid("Identificador inválido.");
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (formato HH:MM).");

const customerName = z
  .string()
  .trim()
  .min(2, "El nombre del cliente es muy corto.")
  .max(120, "El nombre del cliente es demasiado largo.");

// Teléfono opcional, laxo a propósito (formatos AR variados); "" → null.
const customerPhone = z
  .string()
  .trim()
  .max(30, "El teléfono es demasiado largo.")
  .regex(/^[+0-9()\-\s]*$/, "El teléfono tiene caracteres inválidos.")
  .optional()
  .transform((v) => (v ? v : null));

const notes = z
  .string()
  .trim()
  .max(500, "Las notas son demasiado largas.")
  .optional()
  .transform((v) => (v ? v : null));

export const createReservationSchema = z
  .object({
    courtId: uuid,
    date: dateStr,
    startTime: timeStr,
    customerName,
    customerPhone,
    notes,
  })
  .strict();

/** Modificar = mover a otro turno (misma u otra cancha). */
export const rescheduleReservationSchema = z
  .object({
    courtId: uuid,
    date: dateStr,
    startTime: timeStr,
  })
  .strict();

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type RescheduleReservationInput = z.infer<
  typeof rescheduleReservationSchema
>;
