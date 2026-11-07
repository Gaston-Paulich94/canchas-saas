import { z } from "zod";

/**
 * Fechas de calendario "YYYY-MM-DD" que EXISTEN.
 *
 * El regex solo no alcanza: "2026-13-01" pasaba y después rompía con un 500, y
 * "2026-02-31" es peor, porque JavaScript la corre en silencio al 3 de marzo
 * (un pedido armado a mano reservaba otro día sin avisar). Se valida que la
 * fecha vuelva igual después de pasar por Date.UTC.
 */

const FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!FORMAT.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const back = new Date(Date.UTC(y, m - 1, d));
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d
  );
}

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Fecha inválida.");
