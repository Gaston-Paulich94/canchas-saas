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
import { getReservationPayments } from "@/modules/payments/application/payment-service";
import {
  PAYMENT_STATUS_LABELS,
  formatArs,
  needsRefund,
} from "@/modules/payments/domain/payment";
import { CancelReservationButton } from "@/components/reservations/cancel-reservation-button";
import { RescheduleForm } from "@/components/reservations/reschedule-form";
import {
  CreatePaymentLinkButton,
  CancelPaymentButton,
} from "@/components/payments/payment-actions";
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

  const payments = await getReservationPayments(ctx, reservation.id);
  const activePayment =
    payments.find(
      (p) => p.status === "pendiente" || p.status === "aprobado",
    ) ?? null;
  // Link de Checkout Pro reconstruido desde el id de preferencia (host fijo).
  const checkoutUrl = activePayment?.mpPreferenceId
    ? `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${encodeURIComponent(activePayment.mpPreferenceId)}`
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

      {/* Fuera del bloque de reserva activa: es justo cuando se cancela que
          un pago tardío puede aparecer. */}
      {payments.filter(needsRefund).map((p) => (
        <p
          key={p.id}
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          Se recibió un pago de {formatArs(p.amountCents)}
          {p.mpPaymentId ? ` (Mercado Pago #${p.mpPaymentId})` : ""} por un
          cobro que ya estaba anulado. Hay que devolverlo desde la cuenta de
          Mercado Pago del complejo.
        </p>
      ))}

      {isActive ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cobro</CardTitle>
              <CardDescription>
                El importe se calcula con el precio por hora de la cancha.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {activePayment ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Importe</span>
                    <span className="font-medium tabular-nums">
                      {formatArs(activePayment.amountCents)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Estado</span>
                    <span
                      className={
                        activePayment.status === "aprobado"
                          ? "font-medium"
                          : "font-medium text-muted-foreground"
                      }
                    >
                      {PAYMENT_STATUS_LABELS[activePayment.status]}
                    </span>
                  </div>

                  {activePayment.status === "pendiente" && checkoutUrl ? (
                    <div className="grid gap-2">
                      <a
                        href={checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all rounded-md border p-2 text-xs hover:bg-accent"
                      >
                        {checkoutUrl}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        Pasale este link al cliente para que pague.
                      </p>
                      <CancelPaymentButton
                        reservationId={reservation.id}
                        paymentId={activePayment.id}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <CreatePaymentLinkButton reservationId={reservation.id} />
              )}
            </CardContent>
          </Card>

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
