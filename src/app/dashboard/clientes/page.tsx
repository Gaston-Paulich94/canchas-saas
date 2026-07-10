import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { getCustomers } from "@/modules/customers/application/customer-service";
import { customerSearchSchema } from "@/modules/customers/domain/schemas";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const { buscar } = await searchParams;
  const parsedSearch = customerSearchSchema.safeParse(buscar);
  const search = parsedSearch.success ? parsedSearch.data : null;

  const customers = await getCustomers(ctx, search);

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
          <h1 className="text-2xl font-semibold">Clientes</h1>
        </div>
        <Link href="/dashboard/clientes/nueva" className={buttonVariants()}>
          Nuevo cliente
        </Link>
      </header>

      <form method="get" className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <label htmlFor="buscar" className="text-sm font-medium">
            Buscar
          </label>
          <Input
            id="buscar"
            name="buscar"
            type="search"
            maxLength={120}
            defaultValue={search ?? ""}
            placeholder="Nombre o teléfono…"
          />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      {customers.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {search ? "Sin resultados" : "Todavía no tenés clientes"}
            </CardTitle>
            <CardDescription>
              {search
                ? "Probá con otro nombre o teléfono."
                : "Se crean solos al reservar, o cargalos manualmente."}
            </CardDescription>
          </CardHeader>
          {search ? null : (
            <CardContent>
              <Link
                href="/dashboard/clientes/nueva"
                className={buttonVariants()}
              >
                Cargar el primer cliente
              </Link>
            </CardContent>
          )}
        </Card>
      ) : (
        <ul className="grid gap-3">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/clientes/${c.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.phone ?? "Sin teléfono"}
                      {c.email ? ` · ${c.email}` : ""}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
