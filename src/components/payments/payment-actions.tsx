"use client";

import { useActionState } from "react";
import {
  createPaymentLinkAction,
  cancelPaymentAction,
  type ActionState,
} from "@/app/actions/payments";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

/** Genera el link de cobro de una reserva. El importe lo calcula el servidor. */
export function CreatePaymentLinkButton({
  reservationId,
}: {
  reservationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    createPaymentLinkAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Generando…" : "Generar link de pago"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function CancelPaymentButton({
  reservationId,
  paymentId,
}: {
  reservationId: string;
  paymentId: string;
}) {
  const [state, formAction, pending] = useActionState(
    cancelPaymentAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <Button variant="ghost" size="sm" type="submit" disabled={pending}>
        {pending ? "Anulando…" : "Anular cobro"}
      </Button>
      {state.error ? (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
