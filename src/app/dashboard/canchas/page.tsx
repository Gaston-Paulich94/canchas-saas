import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { getCourts } from "@/modules/courts/application/court-service";
import { SPORT_LABELS } from "@/modules/courts/domain/court";
import { ROLES } from "@/modules/auth/domain/roles";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default async function CanchasPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // Gestión de canchas: solo dueño/staff. Un cliente vuelve al panel.
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  const courts = await getCourts(ctx);

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
          <h1 className="text-2xl font-semibold">Canchas</h1>
        </div>
        <Link href="/dashboard/canchas/nueva" className={buttonVariants()}>
          Nueva cancha
        </Link>
      </header>

      {courts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Todavía no tenés canchas</CardTitle>
            <CardDescription>
              Cargá tu primera cancha para empezar a gestionar la disponibilidad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/canchas/nueva" className={buttonVariants()}>
              Crear la primera cancha
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {courts.map((court) => (
            <li key={court.id}>
              <Link
                href={`/dashboard/canchas/${court.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{court.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {SPORT_LABELS[court.sport]}
                      {court.surface ? ` · ${court.surface}` : ""}
                      {court.indoor ? " · Techada" : ""}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    {court.pricePerHour != null ? (
                      <p className="font-medium">
                        {arsFormatter.format(court.pricePerHour)}/h
                      </p>
                    ) : null}
                    <p
                      className={
                        court.isActive
                          ? "text-muted-foreground"
                          : "text-destructive"
                      }
                    >
                      {court.isActive ? "Activa" : "Inactiva"}
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
