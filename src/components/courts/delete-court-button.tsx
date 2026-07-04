"use client";

import { useActionState } from "react";
import { deleteCourtAction, type ActionState } from "@/app/actions/courts";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Botón de baja de una cancha. El id se liga en el SERVIDOR (bind), no viaja en
 * un campo editable del form. Igual el service scopea por tenant: aun forzando
 * otro id, solo se puede borrar dentro del propio tenant (RLS + filtro app).
 */
export function DeleteCourtButton({ courtId }: { courtId: string }) {
  const action = deleteCourtAction.bind(null, courtId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("¿Eliminar esta cancha? Esta acción no se puede deshacer.")) {
          e.preventDefault();
        }
      }}
    >
      <Button variant="destructive" type="submit" disabled={pending}>
        {pending ? "Eliminando…" : "Eliminar cancha"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
