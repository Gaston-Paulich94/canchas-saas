import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { findTenantById } from "@/modules/tenants/infrastructure/tenant.repository";
import { logoutAction } from "@/app/actions/auth";
import { ROLES } from "@/modules/auth/domain/roles";
import { getDashboardOverview } from "@/modules/dashboard/application/dashboard-service";
import {
  todayArDate,
  utcToArTime,
} from "@/modules/reservations/domain/datetime";
import { formatArs } from "@/modules/payments/domain/payment";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  staff: "Staff",
  cliente: "Cliente",
};

const SECCIONES = [
  { href: "/dashboard/reservas", label: "Reservas" },
  { href: "/dashboard/canchas", label: "Canchas" },
  { href: "/dashboard/clientes", label: "Clientes" },
  { href: "/dashboard/pagos", label: "Cobros" },
];

/** Tarjeta de métrica del día. */
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

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // Lectura scopeada por tenant (withTenant fija app.tenant_id → RLS activa) y
  // además el repo filtra por id. Doble capa independiente.
  const tenant = await withTenant(ctx.tenantId, (tx) =>
    findTenantById(tx, ctx.tenantId),
  );
  if (!tenant) redirect("/login");

  const canManage = ctx.role === ROLES.OWNER || ctx.role === ROLES.STAFF;

  // Un cliente no ve la operación del complejo: solo sus datos de cuenta.
  if (!canManage) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Complejo</p>
            <h1 className="text-2xl font-semibold">{tenant.name}</h1>
          </div>
          <form action={logoutAction}>
            <Button variant="outline" type="submit">
              Cerrar sesión
            </Button>
          </form>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>¡Hola, {ctx.name}!</CardTitle>
            <CardDescription>
              Tu cuenta está asociada a {tenant.name}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tu rol</span>
              <span className="font-medium">
                {ROLE_LABEL[ctx.role] ?? ctx.role}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{ctx.email}</span>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const hoy = todayArDate();
  const { today, alerts, canchasActivas, canchasTotales } =
    await getDashboardOverview(ctx, hoy);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Hola, {ctx.name} · {ROLE_LABEL[ctx.role] ?? ctx.role}
          </p>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        </div>
        <form action={logoutAction}>
          <Button variant="outline" type="submit">
            Cerrar sesión
          </Button>
        </form>
      </header>

      {/* Avisos accionables primero: son los que frenan la operación. */}
      {alerts.length > 0 ? (
        <ul className="grid gap-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
            >
              <span className="text-sm">{a.mensaje}</span>
              <Link
                href={a.href}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {a.cta}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Reservas de hoy"
          value={String(today.reservasConfirmadas)}
          hint={
            today.reservasCanceladas > 0
              ? `${today.reservasCanceladas} cancelada${today.reservasCanceladas === 1 ? "" : "s"}`
              : undefined
          }
        />
        <Stat
          label="Canchas activas"
          value={`${canchasActivas}/${canchasTotales}`}
        />
        <Stat
          label="Cobrado hoy (Mercado Pago)"
          value={formatArs(today.cobradoHoyCents)}
          hint={
            today.cobrosPendientes > 0
              ? `${today.cobrosPendientes} cobro${today.cobrosPendientes === 1 ? "" : "s"} pendiente${today.cobrosPendientes === 1 ? "" : "s"}`
              : undefined
          }
        />
        <Stat
          label="Valor de la jornada"
          value={formatArs(today.estimadoHoyCents)}
          hint="Reservas confirmadas de hoy, cobres por donde cobres"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos turnos</CardTitle>
          <CardDescription>
            Lo que queda por jugarse hoy ({hoy}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {today.proximos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No quedan turnos para hoy.
            </p>
          ) : (
            <ul className="grid gap-2">
              {today.proximos.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/dashboard/reservas/${r.id}`}
                    className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="font-medium tabular-nums">
                      {utcToArTime(r.startsAt)}–{utcToArTime(r.endsAt)}
                    </span>
                    <span className="flex-1 truncate">{r.customerName}</span>
                    <span className="text-muted-foreground">{r.courtName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gestión</CardTitle>
          <CardDescription>Administración del complejo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {SECCIONES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={buttonVariants({ variant: "outline" })}
            >
              {s.label}
            </Link>
          ))}
          {/* Los números del negocio los ve el dueño. */}
          {ctx.role === ROLES.OWNER ? (
            <Link
              href="/dashboard/reportes"
              className={buttonVariants({ variant: "outline" })}
            >
              Reportes
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
