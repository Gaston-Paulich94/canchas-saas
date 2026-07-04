import { redirect, notFound } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { ROLES } from "@/modules/auth/domain/roles";
import { updateCourtAction } from "@/app/actions/courts";
import { getCourt } from "@/modules/courts/application/court-service";
import { CourtNotFoundError } from "@/modules/courts/domain/court";
import { CourtForm } from "@/components/courts/court-form";
import { DeleteCourtButton } from "@/components/courts/delete-court-button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarCanchaPage({
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
  // id malformado → 404 (no lo mandamos a la DB para no gatillar un error de cast).
  if (!UUID_RE.test(id)) notFound();

  let court;
  try {
    court = await getCourt(ctx, id);
  } catch (err) {
    if (err instanceof CourtNotFoundError) notFound();
    throw err;
  }

  // id ligado en el servidor (no viaja como campo editable del form).
  const action = updateCourtAction.bind(null, court.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Editar cancha</CardTitle>
        </CardHeader>
        <CardContent>
          <CourtForm
            action={action}
            defaultValues={court}
            submitLabel="Guardar cambios"
            pendingLabel="Guardando…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Zona de peligro</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteCourtButton courtId={court.id} />
        </CardContent>
      </Card>
    </main>
  );
}
