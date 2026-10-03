import { describe, it, expect } from "vitest";
import { clientIpFrom } from "@/lib/client-ip";
import { auth } from "@/lib/auth";

describe("IP del cliente para el rate-limit", () => {
  it("prefiere x-real-ip (lo fija el proxy)", () => {
    const h = new Headers({
      "x-real-ip": "198.51.100.10",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(clientIpFrom(h)).toBe("198.51.100.10");
  });

  it("sin x-real-ip usa el ÚLTIMO salto de x-forwarded-for (no el que inventa el cliente)", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.20" });
    expect(clientIpFrom(h)).toBe("198.51.100.20");
  });

  it("sin headers de proxy devuelve 'unknown'", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("Endpoints HTTP de better-auth", () => {
  it("sign-in y sign-up por HTTP están deshabilitados (solo por Server Action con rate-limit)", () => {
    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining(["/sign-in/email", "/sign-up/email"]),
    );
  });
});
