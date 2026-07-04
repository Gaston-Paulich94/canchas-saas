import type { Slot } from "@/modules/availability/domain/availability";

/**
 * Generación de slots — lógica PURA (sin DB, sin HTTP), fácilmente testeable.
 *
 * Los tiempos se manejan como minutos desde medianoche. Acepta "HH:MM" y
 * "HH:MM:SS" (Postgres devuelve el segundo formato para columnas `time`).
 */

export function parseTimeToMinutes(t: string): number {
  const parts = t.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  if (
    !Number.isInteger(h) ||
    !Number.isInteger(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    throw new Error(`Hora inválida: ${t}`);
  }
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Slots de UNA ventana [open, close): arranca en open y avanza de a
 * `durationMin`. Solo incluye el slot si entra COMPLETO antes de close (no se
 * generan turnos parciales). Devuelve [] si la duración es <= 0 o no entra
 * ninguno.
 */
export function generateWindowSlots(
  openTime: string,
  closeTime: string,
  durationMin: number,
): Slot[] {
  if (!Number.isInteger(durationMin) || durationMin <= 0) return [];
  const open = parseTimeToMinutes(openTime);
  const close = parseTimeToMinutes(closeTime);
  const slots: Slot[] = [];
  for (let start = open; start + durationMin <= close; start += durationMin) {
    slots.push({
      start: minutesToTime(start),
      end: minutesToTime(start + durationMin),
    });
  }
  return slots;
}

/**
 * Slots de un día a partir de sus ventanas (ya se asume que no se solapan: lo
 * garantiza el EXCLUDE constraint). Ordena por hora de inicio.
 */
export function generateDaySlots(
  windows: ReadonlyArray<{ openTime: string; closeTime: string }>,
  durationMin: number,
): Slot[] {
  const all = windows.flatMap((w) =>
    generateWindowSlots(w.openTime, w.closeTime, durationMin),
  );
  return all.sort((a, b) => a.start.localeCompare(b.start));
}
