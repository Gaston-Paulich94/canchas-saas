"use client";

import { useActionState } from "react";
import {
  removeAvailabilityAction,
  type ActionState,
} from "@/app/actions/availability";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Quita una franja horaria. El id viaja como campo oculto: el cliente lo controla, así que el service
 * vuelve a verificar que pertenezca al complejo (tenant + id, más RLS).
 */
export function RemoveAvailabilityButton({
  courtId,
  availabilityId,
}: {
  courtId: string;
  availabilityId: string;
}) {
  const [state, formAction, pending] = useActionState(
    removeAvailabilityAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="courtId" value={courtId} />
      <input type="hidden" name="availabilityId" value={availabilityId} />
      <Button variant="ghost" size="sm" type="submit" disabled={pending}>
        {pending ? "Quitando…" : "Quitar"}
      </Button>
      {state.error ? (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
