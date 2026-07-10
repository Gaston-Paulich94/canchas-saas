"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/app/actions/customers";
import type { Customer } from "@/modules/customers/domain/customer";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { error: null };

type CustomerAction = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

interface CustomerFormProps {
  action: CustomerAction;
  defaultValues?: Customer;
  submitLabel: string;
  pendingLabel: string;
}

export function CustomerForm({
  action,
  defaultValues,
  submitLabel,
  pendingLabel,
}: CustomerFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

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
          placeholder="Juan Pérez"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="phone">Teléfono (opcional)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          maxLength={30}
          defaultValue={defaultValues?.phone ?? ""}
          placeholder="+54 9 11 5555-5555"
        />
        <p className="text-xs text-muted-foreground">
          Único por complejo. Lo usamos para vincular reservas y WhatsApp.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">Email (opcional)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          maxLength={254}
          defaultValue={defaultValues?.email ?? ""}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <Input
          id="notes"
          name="notes"
          type="text"
          maxLength={500}
          defaultValue={defaultValues?.notes ?? ""}
        />
      </div>

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
          href="/dashboard/clientes"
          className={buttonVariants({ variant: "outline" })}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
