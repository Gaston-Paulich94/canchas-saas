/**
 * Fecha/hora de reservas — lógica PURA (testeable sin DB).
 *
 * Los horarios del negocio se interpretan SIEMPRE en la zona horaria de
 * Argentina. AR no tiene horario de verano, así que el offset es fijo (-03:00):
 * podemos construir el timestamptz con offset explícito y el server puede
 * correr en UTC (Vercel) o en cualquier tz sin corrimientos.
 */

export const AR_UTC_OFFSET = "-03:00";
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" + "HH:MM" (hora argentina) → Date (instante UTC). */
export function arDateTimeToUtc(dateStr: string, timeStr: string): Date {
  const d = new Date(`${dateStr}T${timeStr}:00${AR_UTC_OFFSET}`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha/hora inválida: ${dateStr} ${timeStr}`);
  }
  return d;
}

/** Instante UTC → "HH:MM" en hora argentina. */
export function utcToArTime(d: Date): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(11, 16);
}

/** Instante UTC → "YYYY-MM-DD" en hora argentina. */
export function utcToArDate(d: Date): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Límites [desde, hasta) de un día argentino, como instantes UTC. */
export function arDayBounds(dateStr: string): { from: Date; to: Date } {
  const from = arDateTimeToUtc(dateStr, "00:00");
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/** Hoy en Argentina, "YYYY-MM-DD". */
export function todayArDate(): string {
  return utcToArDate(new Date());
}
