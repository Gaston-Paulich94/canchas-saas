import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { findTenantById } from "@/modules/tenants/infrastructure/tenant.repository";
import { logoutAction } from "@/app/actions/auth";
import { ROLES } from "@/modules/auth/domain/roles";
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
            Bienvenido al panel de {tenant.name}.
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

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gestión</CardTitle>
            <CardDescription>Administración del complejo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/canchas"
              className={buttonVariants({ variant: "outline" })}
            >
              Canchas
            </Link>
            <Link
              href="/dashboard/reservas"
              className={buttonVariants({ variant: "outline" })}
            >
              Reservas
            </Link>
            <Link
              href="/dashboard/clientes"
              className={buttonVariants({ variant: "outline" })}
            >
              Clientes
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Próximamente: pagos con Mercado Pago y reportes.
      </p>
    </main>
  );
}
