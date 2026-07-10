"use client";

import { useActionState } from "react";
import {
  rescheduleReservationAction,
  type ActionState,
} from "@/app/actions/reservations";
import type { Slot } from "@/modules/availability/domain/availability";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const initialState: ActionState = { error: null };

/**
 * Paso 2 de la modificación: elegir el nuevo turno libre. El id de la reserva
 * se liga en el servidor; courtId/date van hidden y el server revalida todo.
 */
export function RescheduleForm({
  reservationId,
  courtId,
  date,
  freeSlots,
}: {
  reservationId: string;
  courtId: string;
  date: string;
  freeSlots: Slot[];
}) {
  const action = rescheduleReservationAction.bind(null, reservationId);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (freeSlots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No quedan turnos libres para esa cancha y fecha.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="courtId" value={courtId} />
      <input type="hidden" name="date" value={date} />

      <div className="grid gap-2">
        <Label htmlFor="startTime">Nuevo turno</Label>
        <NativeSelect id="startTime" name="startTime" required defaultValue="">
          <option value="" disabled>
            Elegí un turno…
          </option>
          {freeSlots.map((s) => (
            <option key={s.start} value={s.start}>
              {s.start} – {s.end}
            </option>
          ))}
        </NativeSelect>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Moviendo…" : "Mover reserva"}
      </Button>
    </form>
  );
}
