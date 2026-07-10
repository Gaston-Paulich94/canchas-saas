import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { getDaySchedule } from "@/modules/reservations/application/reservation-service";
import {
  todayArDate,
  utcToArTime,
} from "@/modules/reservations/domain/datetime";
import { RESERVATION_STATUS_LABELS } from "@/modules/reservations/domain/reservation";
import { previewDateSchema } from "@/modules/availability/domain/schemas";
import { SPORT_LABELS } from "@/modules/courts/domain/court";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { fecha } = await searchParams;
  const date =
    fecha && previewDateSchema.safeParse(fecha).success ? fecha : todayArDate();

  const { courts, reservations } = await getDaySchedule(ctx, date);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Volver al panel
          </Link>
          <h1 className="text-2xl font-semibold">Reservas</h1>
        </div>
        <Link
          href={`/dashboard/reservas/nueva?fecha=${date}`}
          className={buttonVariants()}
        >
          Nueva reserva
        </Link>
      </header>

      <form method="get" className="flex items-end gap-2">
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
          Ver agenda
        </Button>
      </form>

      {courts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Todavía no tenés canchas</CardTitle>
            <CardDescription>
              Cargá una cancha y su disponibilidad para empezar a reservar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/canchas/nueva" className={buttonVariants()}>
              Crear cancha
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {courts.map((court) => {
            const rows = reservations.filter((r) => r.courtId === court.id);
            return (
              <Card key={court.id}>
                <CardHeader>
                  <CardTitle className="text-base">{court.name}</CardTitle>
                  <CardDescription>{SPORT_LABELS[court.sport]}</CardDescription>
                </CardHeader>
                <CardContent>
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin reservas para esta fecha.
                    </p>
                  ) : (
                    <ul className="grid gap-2">
                      {rows.map((r) => (
                        <li key={r.id}>
                          <Link
                            href={`/dashboard/reservas/${r.id}`}
                            className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm transition-colors hover:bg-accent"
                          >
                            <span className="tabular-nums font-medium">
                              {utcToArTime(r.startsAt)}–{utcToArTime(r.endsAt)}
                            </span>
                            <span className="flex-1 truncate">
                              {r.customerName}
                            </span>
                            <span
                              className={
                                r.status === "cancelada"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }
                            >
                              {RESERVATION_STATUS_LABELS[r.status]}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
