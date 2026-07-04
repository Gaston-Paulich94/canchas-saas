"use client";

import { useActionState } from "react";
import { addAvailabilityAction, type ActionState } from "@/app/actions/availability";
import {
  DAY_LABELS,
  WEEK_ORDER,
} from "@/modules/availability/domain/availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const initialState: ActionState = { error: null };

export function AddAvailabilityForm({ courtId }: { courtId: string }) {
  const action = addAvailabilityAction.bind(null, courtId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <div className="grid gap-1">
        <Label htmlFor="dayOfWeek">Día</Label>
        <NativeSelect id="dayOfWeek" name="dayOfWeek" required defaultValue="">
          <option value="" disabled>
            Elegí…
          </option>
          {WEEK_ORDER.map((d) => (
            <option key={d} value={d}>
              {DAY_LABELS[d]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="openTime">Apertura</Label>
        <Input id="openTime" name="openTime" type="time" required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="closeTime">Cierre</Label>
        <Input id="closeTime" name="closeTime" type="time" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Agregando…" : "Agregar"}
      </Button>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-4">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
