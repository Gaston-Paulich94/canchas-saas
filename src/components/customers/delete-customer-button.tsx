"use client";

import { useActionState } from "react";
import {
  deleteCustomerAction,
  type ActionState,
} from "@/app/actions/customers";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Borra un cliente. El id viaja como campo oculto: el cliente lo controla, así que el service
 * vuelve a verificar que pertenezca al complejo (tenant + id, más RLS).
 * Las reservas del
 * cliente NO se borran: quedan con customer_id NULL y conservan el snapshot.
 */
export function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState(
    deleteCustomerAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "¿Eliminar este cliente? Sus reservas pasadas se conservan.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="customerId" value={customerId} />
      <Button variant="destructive" type="submit" disabled={pending}>
        {pending ? "Eliminando…" : "Eliminar cliente"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
