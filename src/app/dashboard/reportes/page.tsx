import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { getReportingOverview } from "@/modules/reporting/application/reporting-service";
import {
  reportRangeSchema,
  firstDayOfMonth,
} from "@/modules/reporting/domain/reporting";
import { todayArDate } from "@/modules/reservations/domain/datetime";
import { formatArs } from "@/modules/payments/domain/payment";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Barra proporcional simple (sin dependencias de gráficos). */
function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Los números del negocio son del dueño.
  if (ctx.role !== ROLES.OWNER) redirect("/dashboard");

  const hoy = todayArDate();
  const { desde, hasta } = await searchParams;
  const parsed = reportRangeSchema.safeParse({
    desde: desde ?? firstDayOfMonth(hoy),
    hasta: hasta ?? hoy,
  });
  // Rango inválido → mes en curso.
  const range = parsed.success
    ? parsed.data
    : { desde: firstDayOfMonth(hoy), hasta: hoy };

  const { revenue, ocupacion, picos, frecuentes } = await getReportingOverview(
    ctx,
    range,
  );

  const maxPico = picos.reduce((max, p) => Math.max(max, p.reservas), 0);
  const totalReservas = revenue.reservasConfirmadas + revenue.reservasCanceladas;
  const tasaCancelacion =
    totalReservas > 0
      ? Math.round((revenue.reservasCanceladas / totalReservas) * 100)
      : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-semibold">Reportes</h1>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <input
            id="desde"
            name="desde"
            type="date"
            defaultValue={range.desde}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <input
            id="hasta"
            name="hasta"
            type="date"
            defaultValue={range.hasta}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          />
        </div>
        <Button type="submit" variant="outline">
          Ver período
        </Button>
      </form>

      {!parsed.success ? (
        <p role="alert" className="text-sm text-destructive">
          {parsed.error.issues[0]?.message ?? "El rango de fechas no es válido."}{" "}
          Mostramos el mes en curso.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Cobrado por Mercado Pago"
          value={formatArs(revenue.cobradoCents)}
          hint={
            revenue.pendientesCents > 0
              ? `${formatArs(revenue.pendientesCents)} pendiente de pago`
              : "Pagos acreditados en el período"
          }
        />
        <Stat
          label="Facturación estimada"
          value={formatArs(revenue.estimadoCents)}
          hint="Todas las reservas confirmadas, cobres por donde cobres"
        />
        <Stat
          label="Reservas confirmadas"
          value={String(revenue.reservasConfirmadas)}
        />
        <Stat
          label="Canceladas"
          value={String(revenue.reservasCanceladas)}
          hint={totalReservas > 0 ? `${tasaCancelacion}% del total` : undefined}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ocupación por cancha</CardTitle>
          <CardDescription>
            Horas reservadas sobre las horas que ofrecés según tu disponibilidad.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ocupacion.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay canchas cargadas.
            </p>
          ) : (
            <ul className="grid gap-4">
              {ocupacion.map((c) => (
                <li key={c.courtId} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{c.courtName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.ocupacionPct === null
                        ? "Sin horarios cargados"
                        : `${c.ocupacionPct}%`}
                    </span>
                  </div>
                  {c.ocupacionPct !== null ? <Bar pct={c.ocupacionPct} /> : null}
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {c.horasReservadas.toFixed(1)} h reservadas
                    {c.horasDisponibles > 0
                      ? ` de ${c.horasDisponibles.toFixed(1)} h`
                      : ""}
                    {" · "}
                    {formatArs(c.ingresoEstimadoCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horarios pico</CardTitle>
          <CardDescription>
            Reservas confirmadas según la hora de inicio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {picos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay reservas en el período.
            </p>
          ) : (
            <ul className="grid gap-2">
              {picos.map((p) => (
                <li key={p.hora} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2">
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {String(p.hora).padStart(2, "0")}:00
                  </span>
                  <Bar pct={maxPico > 0 ? (p.reservas / maxPico) * 100 : 0} />
                  <span className="text-right text-sm tabular-nums">
                    {p.reservas}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes frecuentes</CardTitle>
          <CardDescription>
            Los que más jugaron en el período.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {frecuentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay reservas en el período.
            </p>
          ) : (
            <ul className="grid gap-2">
              {frecuentes.map((c, i) => (
                <li
                  key={c.customerId ?? `sin-cliente-${i}`}
                  className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.nombre}</p>
                    {c.telefono ? (
                      <p className="text-xs text-muted-foreground">
                        {c.telefono}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {c.reservas} reserva{c.reservas === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
