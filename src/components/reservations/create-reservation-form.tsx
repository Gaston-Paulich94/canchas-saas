"use client";

import { useActionState } from "react";
import {
  createReservationAction,
  type ActionState,
} from "@/app/actions/reservations";
import type { Slot } from "@/modules/availability/domain/availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const initialState: ActionState = { error: null };

/**
 * Paso 2 del alta: elegir turno libre + datos del cliente. courtId y date van
 * como hidden pero el SERVIDOR revalida todo (cancha del tenant, slot ∈
 * disponibilidad, turno libre vía EXCLUDE): manipularlos no abre nada.
 */
export function CreateReservationForm({
  courtId,
  date,
  freeSlots,
}: {
  courtId: string;
  date: string;
  freeSlots: Slot[];
}) {
  const [state, formAction, pending] = useActionState(
    createReservationAction,
    initialState,
  );

  if (freeSlots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No quedan turnos libres para esta cancha en la fecha elegida.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="courtId" value={courtId} />
      <input type="hidden" name="date" value={date} />

      <div className="grid gap-2">
        <Label htmlFor="startTime">Turno</Label>
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

      <div className="grid gap-2">
        <Label htmlFor="customerName">Nombre del cliente</Label>
        <Input
          id="customerName"
          name="customerName"
          type="text"
          required
          maxLength={120}
          placeholder="Juan Pérez"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="customerPhone">Teléfono (opcional)</Label>
        <Input
          id="customerPhone"
          name="customerPhone"
          type="tel"
          maxLength={30}
          placeholder="+54 9 11 5555-5555"
        />
        <p className="text-xs text-muted-foreground">
          Lo vamos a usar para las notificaciones por WhatsApp.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <Input id="notes" name="notes" type="text" maxLength={500} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Reservando…" : "Confirmar reserva"}
      </Button>
    </form>
  );
}
