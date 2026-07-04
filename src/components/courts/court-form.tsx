"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/app/actions/courts";
import { SPORT_LABELS, COURT_SPORTS, type Court } from "@/modules/courts/domain/court";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const initialState: ActionState = { error: null };

type CourtAction = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

interface CourtFormProps {
  action: CourtAction;
  /** Valores actuales cuando se edita; ausente en el alta. */
  defaultValues?: Court;
  submitLabel: string;
  pendingLabel: string;
}

export function CourtForm({
  action,
  defaultValues,
  submitLabel,
  pendingLabel,
}: CourtFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // Alta: cancha activa por defecto, no techada. Edición: valores actuales.
  const isActiveDefault = defaultValues ? defaultValues.isActive : true;
  const indoorDefault = defaultValues ? defaultValues.indoor : false;

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          defaultValue={defaultValues?.name ?? ""}
          placeholder="Cancha 1"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sport">Deporte</Label>
        <NativeSelect
          id="sport"
          name="sport"
          required
          defaultValue={defaultValues?.sport ?? ""}
        >
          <option value="" disabled>
            Elegí un deporte…
          </option>
          {COURT_SPORTS.map((s) => (
            <option key={s} value={s}>
              {SPORT_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="surface">Superficie (opcional)</Label>
        <Input
          id="surface"
          name="surface"
          type="text"
          maxLength={120}
          defaultValue={defaultValues?.surface ?? ""}
          placeholder="Sintético, cemento, polvo de ladrillo…"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pricePerHour">Precio por hora (ARS, opcional)</Label>
        <Input
          id="pricePerHour"
          name="pricePerHour"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={defaultValues?.pricePerHour ?? ""}
          placeholder="12000"
        />
        <p className="text-xs text-muted-foreground">
          Valor de referencia. El cobro real se configura en la etapa de pagos.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="indoor"
          defaultChecked={indoorDefault}
          className="h-4 w-4 rounded border-input"
        />
        Techada
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={isActiveDefault}
          className="h-4 w-4 rounded border-input"
        />
        Activa (disponible para reservas)
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <Link
          href="/dashboard/canchas"
          className={buttonVariants({ variant: "outline" })}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
