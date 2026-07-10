import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { getCourts } from "@/modules/courts/application/court-service";
import { getFreeSlots } from "@/modules/reservations/application/reservation-service";
import { todayArDate } from "@/modules/reservations/domain/datetime";
import { previewDateSchema } from "@/modules/availability/domain/schemas";
import { SPORT_LABELS } from "@/modules/courts/domain/court";
import { CreateReservationForm } from "@/components/reservations/create-reservation-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NuevaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ cancha?: string; fecha?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { cancha, fecha } = await searchParams;
  const date =
    fecha && previewDateSchema.safeParse(fecha).success ? fecha : todayArDate();

  const courts = (await getCourts(ctx)).filter((c) => c.isActive);
  // La cancha del query se valida por forma (UUID) Y contra las del tenant.
  const selected =
    cancha && UUID_RE.test(cancha)
      ? (courts.find((c) => c.id === cancha) ?? null)
      : null;

  const freeSlots = selected
    ? await getFreeSlots(ctx, selected.id, date)
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <header>
        <Link
          href={`/dashboard/reservas?fecha=${date}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver a reservas
        </Link>
        <h1 className="text-2xl font-semibold">Nueva reserva</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Cancha y fecha</CardTitle>
        </CardHeader>
        <CardContent>
          {courts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay canchas activas. Cargá una cancha primero.
            </p>
          ) : (
            <form method="get" className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="grid gap-1">
                <label htmlFor="cancha" className="text-sm font-medium">
                  Cancha
                </label>
                <NativeSelect
                  id="cancha"
                  name="cancha"
                  required
                  defaultValue={selected?.id ?? ""}
                >
                  <option value="" disabled>
                    Elegí una cancha…
                  </option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({SPORT_LABELS[c.sport]})
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <label htmlFor="fecha" className="text-sm font-medium">
                  Fecha
                </label>
                <input
                  id="fecha"
                  name="fecha"
                  type="date"
                  defaultValue={date}
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                />
              </div>
              <Button type="submit" variant="outline">
                Ver turnos
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {selected && freeSlots ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Turno y cliente</CardTitle>
            <CardDescription>
              {selected.name} · {date}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateReservationForm
              courtId={selected.id}
              date={date}
              freeSlots={freeSlots}
            />
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
