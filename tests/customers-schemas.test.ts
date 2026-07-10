import { describe, it, expect } from "vitest";
import { customerInputSchema } from "@/modules/customers/domain/schemas";

const valid = {
  name: "Juan Pérez",
  phone: "+54 9 11 5555-5555",
  email: "juan@mail.com",
  notes: "Juega los martes",
};

describe("Esquema de clientes (validación en el borde)", () => {
  it("acepta un input válido", () => {
    expect(customerInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza campos extra (anti mass assignment: tenantId/id)", () => {
    const res = customerInputSchema.safeParse({
      ...valid,
      tenantId: "00000000-0000-0000-0000-000000000000",
      id: "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45",
    });
    expect(res.success).toBe(false);
  });

  it("acepta solo nombre (resto opcional → null)", () => {
    const res = customerInputSchema.safeParse({ name: "Ana" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.phone).toBeNull();
      expect(res.data.email).toBeNull();
      expect(res.data.notes).toBeNull();
    }
  });

  it("rechaza teléfono con caracteres inválidos", () => {
    expect(
      customerInputSchema.safeParse({ ...valid, phone: "tel<script>" })
        .success,
    ).toBe(false);
  });

  it("rechaza email inválido y normaliza el válido", () => {
    expect(
      customerInputSchema.safeParse({ ...valid, email: "no-es-email" })
        .success,
    ).toBe(false);
    const res = customerInputSchema.safeParse({
      ...valid,
      email: "  JUAN@Mail.COM ",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.email).toBe("juan@mail.com");
  });

  it("rechaza nombre muy corto", () => {
    expect(customerInputSchema.safeParse({ ...valid, name: "J" }).success).toBe(
      false,
    );
  });
});
