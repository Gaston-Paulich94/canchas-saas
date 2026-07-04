"use client";

import { useActionState } from "react";
import {
  removeAvailabilityAction,
  type ActionState,
} from "@/app/actions/availability";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Quita una franja horaria. courtId + availabilityId se ligan en el SERVIDOR;
 * el service igual scopea por tenant (RLS + filtro) al borrar.
 */
export function RemoveAvailabilityButton({
  courtId,
  availabilityId,
}: {
  courtId: string;
  availabilityId: string;
}) {
  const action = removeAvailabilityAction.bind(null, courtId, availabilityId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
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
