"use client";

import { useActionState } from "react";
import {
  deleteCustomerAction,
  type ActionState,
} from "@/app/actions/customers";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/**
 * Borra un cliente. El id se liga en el SERVIDOR (bind). Las reservas del
 * cliente NO se borran: quedan con customer_id NULL y conservan el snapshot.
 */
export function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const action = deleteCustomerAction.bind(null, customerId);
  const [state, formAction, pending] = useActionState(action, initialState);

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
