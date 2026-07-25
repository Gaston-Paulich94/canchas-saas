"use client";

import { useActionState } from "react";
import {
  connectMpAction,
  disconnectMpAction,
  type ActionState,
} from "@/app/actions/payments";
import { Button } from "@/components/ui/button";

const initialState: ActionState = { error: null };

export function ConnectMpButton() {
  const [state, formAction, pending] = useActionState(
    connectMpAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <Button type="submit" disabled={pending}>
        {pending ? "Redirigiendo…" : "Conectar Mercado Pago"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function DisconnectMpButton() {
  const [state, formAction, pending] = useActionState(
    disconnectMpAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "¿Desconectar Mercado Pago? No vas a poder generar nuevos links de pago.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button variant="outline" type="submit" disabled={pending}>
        {pending ? "Desconectando…" : "Desconectar cuenta"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
