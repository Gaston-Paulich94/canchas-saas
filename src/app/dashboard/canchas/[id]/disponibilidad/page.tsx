import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import {
  getCourtAvailability,
  computeSlotsForDate,
} from "@/modules/availability/application/availability-service";
import {
  DAY_LABELS,
  WEEK_ORDER,
} from "@/modules/availability/domain/availability";
import { CourtNotFoundError } from "@/modules/courts/domain/court";
import { previewDateSchema } from "@/modules/availability/domain/schemas";
import { SPORT_LABELS } from "@/modules/courts/domain/court";
import { AddAvailabilityForm } from "@/components/availability/add-availability-form";
import { RemoveAvailabilityButton } from "@/components/availability/remove-availability-button";
import { SlotDurationForm } from "@/components/availability/slot-duration-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "HH:MM:SS" → "HH:MM". */
function hhmm(t: string): string {
  return t.slice(0, 5);
}

function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
}

export default async function DisponibilidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  let view;
  try {
    view = await getCourtAvailability(ctx, id);
  } catch (err) {
    if (err instanceof CourtNotFoundError) notFound();
    throw err;
  }
  const { court, windows } = view;

  // Fecha del preview: la del query si es válida, si no hoy.
  const { fecha } = await searchParams;
  const previewDate =
    fecha && previewDateSchema.safeParse(fecha).success ? fecha : todayStr();
  const slots = await computeSlotsForDate(ctx, court.id, previewDate);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link
          href={`/dashboard/canchas/${court.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver a la cancha
        </Link>
        <h1 className="text-2xl font-semibold">Disponibilidad</h1>
        <p className="text-sm text-muted-foreground">
          {court.name} · {SPORT_LABELS[court.sport]}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Duración del turno</CardTitle>
          <CardDescription>
            Define cada cuántos minutos se genera un turno reservable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlotDurationForm courtId={court.id} current={court.slotDurationMin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horario semanal</CardTitle>
          <CardDescription>
            Cargá las franjas de apertura de cada día. No pueden solaparse.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-2">
            {WEEK_ORDER.map((day) => {
              const dayWindows = windows.filter((w) => w.dayOfWeek === day);
              return (
                <li
                  key={day}
                  className="flex items-start justify-between gap-4 border-b pb-2 last:border-b-0"
                >
                  <span className="w-24 shrink-0 text-sm font-medium">
                    {DAY_LABELS[day]}
                  </span>
                  <div className="flex-1">
                    {dayWindows.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        Cerrado
                      </span>
                    ) : (
                      <ul className="grid gap-1">
                        {dayWindows.map((w) => (
                          <li
                            key={w.id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span>
                              {hhmm(w.openTime)} – {hhmm(w.closeTime)}
                            </span>
                            <RemoveAvailabilityButton
                              courtId={court.id}
                              availabilityId={w.id}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">Agregar franja</p>
            <AddAvailabilityForm courtId={court.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vista previa de turnos</CardTitle>
          <CardDescription>
            Turnos generados para la fecha elegida ({DAY_LABELS[weekdayOf(previewDate)]}).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form method="get" className="flex items-end gap-2">
            <div className="grid gap-1">
              <label htmlFor="fecha" className="text-sm font-medium">
                Fecha
              </label>
              <input
                id="fecha"
                name="fecha"
                type="date"
                defaultValue={previewDate}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              />
            </div>
            <Button type="submit" variant="outline">
              Ver
            </Button>
          </form>

          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay turnos para esta fecha. Cargá una franja para ese día.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <li
                  key={s.start}
                  className="rounded-md border px-2 py-1 text-sm tabular-nums"
                >
                  {s.start}–{s.end}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
