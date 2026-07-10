import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { updateCustomerAction } from "@/app/actions/customers";
import {
  getCustomer,
  getCustomerReservations,
} from "@/modules/customers/application/customer-service";
import { CustomerNotFoundError } from "@/modules/customers/domain/customer";
import { RESERVATION_STATUS_LABELS } from "@/modules/reservations/domain/reservation";
import {
  utcToArDate,
  utcToArTime,
} from "@/modules/reservations/domain/datetime";
import { CustomerForm } from "@/components/customers/customer-form";
import { DeleteCustomerButton } from "@/components/customers/delete-customer-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  let customer;
  let reservations;
  try {
    customer = await getCustomer(ctx, id);
    reservations = await getCustomerReservations(ctx, id);
  } catch (err) {
    if (err instanceof CustomerNotFoundError) notFound();
    throw err;
  }

  const action = updateCustomerAction.bind(null, customer.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <header>
        <Link
          href="/dashboard/clientes"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver a clientes
        </Link>
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm
            action={action}
            defaultValues={customer}
            submitLabel="Guardar cambios"
            pendingLabel="Guardando…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de reservas</CardTitle>
          <CardDescription>
            {reservations.length === 0
              ? "Sin reservas registradas."
              : `${reservations.length} reserva${reservations.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        {reservations.length > 0 ? (
          <CardContent>
            <ul className="grid gap-2">
              {reservations.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/dashboard/reservas/${r.id}`}
                    className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="tabular-nums">
                      {utcToArDate(r.startsAt)} · {utcToArTime(r.startsAt)}–
                      {utcToArTime(r.endsAt)}
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
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Zona de peligro</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteCustomerButton customerId={customer.id} />
        </CardContent>
      </Card>
    </main>
  );
}
