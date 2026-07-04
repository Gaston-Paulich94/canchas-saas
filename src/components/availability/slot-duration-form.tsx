"use client";

import { useActionState } from "react";
import {
  setSlotDurationAction,
  type ActionState,
} from "@/app/actions/availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { error: null };

export function SlotDurationForm({
  courtId,
  current,
}: {
  courtId: string;
  current: number;
}) {
  const action = setSlotDurationAction.bind(null, courtId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor="slotDurationMin">Duración del turno (minutos)</Label>
        <Input
          id="slotDurationMin"
          name="slotDurationMin"
          type="number"
          min={15}
          max={1440}
          step={5}
          inputMode="numeric"
          defaultValue={current}
          className="w-40"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
