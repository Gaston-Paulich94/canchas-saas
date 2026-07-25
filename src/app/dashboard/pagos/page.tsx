import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { getConnectionStatus } from "@/modules/payments/application/mp-connection";
import {
  ConnectMpButton,
  DisconnectMpButton,
} from "@/components/payments/mp-connection-buttons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ conexion?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const status = await getConnectionStatus(ctx);
  const { conexion } = await searchParams;
  const isOwner = ctx.role === ROLES.OWNER;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver al panel
        </Link>
        <h1 className="text-2xl font-semibold">Cobros</h1>
      </header>

      {conexion === "ok" ? (
        <p role="status" className="rounded-md border p-3 text-sm">
          Cuenta de Mercado Pago conectada correctamente.
        </p>
      ) : null}
      {conexion === "error" ? (
        <p role="alert" className="rounded-md border p-3 text-sm text-destructive">
          No pudimos conectar la cuenta. Volvé a intentarlo.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mercado Pago</CardTitle>
          <CardDescription>
            Los pagos de tus reservas caen directamente en la cuenta del
            complejo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Estado</span>
            <span className="font-medium">
              {status.connected ? "Conectada" : "Sin conectar"}
            </span>
          </div>
          {status.connected && status.mpUserId ? (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Cuenta</span>
              <span className="font-medium tabular-nums">
                {status.mpUserId}
              </span>
            </div>
          ) : null}

          {isOwner ? (
            status.connected ? (
              <DisconnectMpButton />
            ) : (
              <ConnectMpButton />
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Solo el dueño del complejo puede conectar o desconectar la cuenta.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo cobrar una reserva</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground">
          <p>
            1. Cargá el precio por hora de cada cancha (se usa para calcular el
            importe).
          </p>
          <p>
            2. Entrá al detalle de una reserva y generá el link de pago.
          </p>
          <p>
            3. Pasale el link al cliente. Cuando pague, el estado se actualiza
            solo.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
