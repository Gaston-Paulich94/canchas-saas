"use client";

import { useActionState } from "react";
import {
  cancelReservationAction,
  type ActionState,
} from "@/app/actions/reservations";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/** Cancela una reserva. El id se liga en el SERVIDOR (bind), no viaja editable. */
export function CancelReservationButton({
  reservationId,
  returnDate,
}: {
  reservationId: string;
  returnDate: string | null;
}) {
  const action = cancelReservationAction.bind(null, reservationId, returnDate);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("¿Cancelar esta reserva? El turno queda libre.")) {
          e.preventDefault();
        }
      }}
    >
      <Button variant="destructive" type="submit" disabled={pending}>
        {pending ? "Cancelando…" : "Cancelar reserva"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
