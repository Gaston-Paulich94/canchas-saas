import { describe, it, expect } from "vitest";
import {
  registerOwnerSchema,
  loginSchema,
} from "@/modules/auth/domain/schemas";

// Fixtures ficticios: solo existen para ejercitar las reglas de Zod.
// Válida para el registro: 12 a 128 caracteres.
const VALID_TEST_PASSWORD = "fake-test-password-123";
// Inválida para el registro: menos de 12 caracteres.
const SHORT_TEST_PASSWORD = "fake-pw1";
// Cualquier valor no vacío alcanza para el login.
const LOGIN_TEST_PASSWORD = "fake-login-pw";

const validRegister = {
  complejoName: "Pádel Center",
  ownerName: "Gastón",
  email: "dueno@complejo.com",
  password: VALID_TEST_PASSWORD,
};

describe("Esquemas de auth (validación en el borde)", () => {
  it("acepta un registro válido", () => {
    const res = registerOwnerSchema.safeParse(validRegister);
    expect(res.success).toBe(true);
  });

  it("rechaza campos extra (anti mass assignment: role/tenantId)", () => {
    const res = registerOwnerSchema.safeParse({
      ...validRegister,
      role: "owner",
      tenantId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza contraseñas de menos de 12 caracteres", () => {
    const res = registerOwnerSchema.safeParse({
      ...validRegister,
      password: SHORT_TEST_PASSWORD,
    });
    expect(res.success).toBe(false);
  });

  it("normaliza el email (trim + lowercase)", () => {
    const res = registerOwnerSchema.safeParse({
      ...validRegister,
      email: "  DUENO@Complejo.COM  ",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.email).toBe("dueno@complejo.com");
  });

  it("loginSchema también rechaza campos extra", () => {
    const res = loginSchema.safeParse({
      email: "x@y.com",
      password: LOGIN_TEST_PASSWORD,
      isAdmin: true,
    });
    expect(res.success).toBe(false);
  });
});
