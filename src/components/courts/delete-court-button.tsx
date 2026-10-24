"use client";

import { useActionState } from "react";
import { deleteCourtAction, type ActionState } from "@/app/actions/courts";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Botón de baja de una cancha. El id viaja como campo oculto: el cliente lo controla, así que el service
 * vuelve a verificar que pertenezca al complejo (tenant + id, más RLS).
 */
export function DeleteCourtButton({ courtId }: { courtId: string }) {
  const [state, formAction, pending] = useActionState(
    deleteCourtAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("¿Eliminar esta cancha? Esta acción no se puede deshacer.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="courtId" value={courtId} />
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
