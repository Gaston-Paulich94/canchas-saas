import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import {
  getReservation,
  getFreeSlots,
} from "@/modules/reservations/application/reservation-service";
import { getCourts } from "@/modules/courts/application/court-service";
import {
  ReservationNotFoundError,
  RESERVATION_STATUS_LABELS,
} from "@/modules/reservations/domain/reservation";
import {
  utcToArDate,
  utcToArTime,
} from "@/modules/reservations/domain/datetime";
import { previewDateSchema } from "@/modules/availability/domain/schemas";
import { SPORT_LABELS } from "@/modules/courts/domain/court";
import { CancelReservationButton } from "@/components/reservations/cancel-reservation-button";
import { RescheduleForm } from "@/components/reservations/reschedule-form";
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

export default async function ReservaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cancha?: string; fecha?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  let reservation;
  try {
    reservation = await getReservation(ctx, id);
  } catch (err) {
    if (err instanceof ReservationNotFoundError) notFound();
    throw err;
  }

  const courts = (await getCourts(ctx)).filter((c) => c.isActive);
  const court = courts.find((c) => c.id === reservation.courtId) ?? null;
  const reservationDate = utcToArDate(reservation.startsAt);

  // Selección para mover la reserva (query GET); defaults: su cancha y fecha.
  const { cancha, fecha } = await searchParams;
  const targetDate =
    fecha && previewDateSchema.safeParse(fecha).success
      ? fecha
      : reservationDate;
  const targetCourt =
    cancha && UUID_RE.test(cancha)
      ? (courts.find((c) => c.id === cancha) ?? null)
      : court;

  const isActive = reservation.status !== "cancelada";
  const freeSlots =
    isActive && targetCourt
      ? await getFreeSlots(ctx, targetCourt.id, targetDate)
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <header>
        <Link
          href={`/dashboard/reservas?fecha=${reservationDate}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver a reservas
        </Link>
        <h1 className="text-2xl font-semibold">Detalle de reserva</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{reservation.customerName}</CardTitle>
          <CardDescription>
            {court ? `${court.name} · ${SPORT_LABELS[court.sport]}` : "Cancha"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fecha</span>
            <span className="font-medium">{reservationDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Horario</span>
            <span className="font-medium tabular-nums">
              {utcToArTime(reservation.startsAt)}–{utcToArTime(reservation.endsAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estado</span>
            <span
              className={
                isActive ? "font-medium" : "font-medium text-destructive"
              }
            >
              {RESERVATION_STATUS_LABELS[reservation.status]}
            </span>
          </div>
          {reservation.customerPhone ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Teléfono</span>
              <span className="font-medium">{reservation.customerPhone}</span>
            </div>
          ) : null}
          {reservation.notes ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Notas</span>
              <span className="text-right">{reservation.notes}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isActive ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mover la reserva</CardTitle>
              <CardDescription>
                Elegí cancha y fecha, y después el nuevo turno.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form
                method="get"
                className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
              >
                <div className="grid gap-1">
                  <label htmlFor="cancha" className="text-sm font-medium">
                    Cancha
                  </label>
                  <NativeSelect
                    id="cancha"
                    name="cancha"
                    defaultValue={targetCourt?.id ?? ""}
                  >
                    {courts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
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
                    defaultValue={targetDate}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  />
                </div>
                <Button type="submit" variant="outline">
                  Ver turnos
                </Button>
              </form>

              {targetCourt && freeSlots ? (
                <RescheduleForm
                  reservationId={reservation.id}
                  courtId={targetCourt.id}
                  date={targetDate}
                  freeSlots={freeSlots}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zona de peligro</CardTitle>
            </CardHeader>
            <CardContent>
              <CancelReservationButton
                reservationId={reservation.id}
                returnDate={reservationDate}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  );
}
