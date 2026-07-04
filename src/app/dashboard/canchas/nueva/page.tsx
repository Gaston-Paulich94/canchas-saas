import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { createCourtAction } from "@/app/actions/courts";
import { CourtForm } from "@/components/courts/court-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function NuevaCanchaPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== ROLES.OWNER && ctx.role !== ROLES.STAFF) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Nueva cancha</CardTitle>
        </CardHeader>
        <CardContent>
          <CourtForm
            action={createCourtAction}
            submitLabel="Crear cancha"
            pendingLabel="Creando…"
          />
        </CardContent>
      </Card>
    </main>
  );
}
