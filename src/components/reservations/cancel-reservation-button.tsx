"use client";

import { useActionState } from "react";
import {
  cancelReservationAction,
  type ActionState,
} from "@/app/actions/reservations";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Cancela una reserva. El id viaja como campo oculto: el cliente lo controla, así que el service
 * vuelve a verificar que pertenezca al complejo (tenant + id, más RLS).
 */
export function CancelReservationButton({
  reservationId,
  returnDate,
}: {
  reservationId: string;
  returnDate: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    cancelReservationAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("¿Cancelar esta reserva? El turno queda libre.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="returnDate" value={returnDate ?? ""} />
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
