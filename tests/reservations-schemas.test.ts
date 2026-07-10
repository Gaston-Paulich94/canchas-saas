import { describe, it, expect } from "vitest";
import {
  createReservationSchema,
  rescheduleReservationSchema,
} from "@/modules/reservations/domain/schemas";

// UUID v4 real: el .uuid() de Zod valida versión/variante RFC 9562.
const valid = {
  courtId: "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45",
  date: "2026-07-10",
  startTime: "18:00",
  customerName: "Juan Pérez",
  customerPhone: "+54 9 11 5555-5555",
  notes: "Paga en efectivo",
};

describe("Esquemas de reservas (validación en el borde)", () => {
  it("acepta un input válido", () => {
    expect(createReservationSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza campos extra (anti mass assignment: tenantId/status)", () => {
    const res = createReservationSchema.safeParse({
      ...valid,
      tenantId: "00000000-0000-0000-0000-000000000000",
      status: "cancelada",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza courtId que no es uuid", () => {
    expect(
      createReservationSchema.safeParse({ ...valid, courtId: "1; drop table" })
        .success,
    ).toBe(false);
  });

  it("rechaza fecha y hora con formato inválido", () => {
    expect(
      createReservationSchema.safeParse({ ...valid, date: "10/07/2026" })
        .success,
    ).toBe(false);
    expect(
      createReservationSchema.safeParse({ ...valid, startTime: "25:00" })
        .success,
    ).toBe(false);
  });

  it("rechaza teléfono con caracteres inválidos", () => {
    expect(
      createReservationSchema.safeParse({
        ...valid,
        customerPhone: "llamame<script>",
      }).success,
    ).toBe(false);
  });

  it("acepta sin teléfono ni notas (opcionales → null)", () => {
    const res = createReservationSchema.safeParse({
      courtId: valid.courtId,
      date: valid.date,
      startTime: valid.startTime,
      customerName: valid.customerName,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.customerPhone).toBeNull();
      expect(res.data.notes).toBeNull();
    }
  });

  it("rechaza nombre de cliente muy corto", () => {
    expect(
      createReservationSchema.safeParse({ ...valid, customerName: "J" })
        .success,
    ).toBe(false);
  });

  it("reschedule también es .strict()", () => {
    expect(
      rescheduleReservationSchema.safeParse({
        courtId: valid.courtId,
        date: valid.date,
        startTime: valid.startTime,
        status: "confirmada",
      }).success,
    ).toBe(false);
  });
});
