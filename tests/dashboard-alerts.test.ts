import { describe, it, expect } from "vitest";
import { buildAlerts } from "@/modules/dashboard/application/dashboard-service";

/**
 * Los avisos del panel son la guía operativa del dueño: tienen que aparecer
 * exactamente cuando algo bloquea la operación, y no antes.
 */

const base = {
  canchasTotales: 2,
  sinPrecio: 0,
  sinDisponibilidad: 0,
  mpConectado: true,
  esOwner: true,
};

function ids(alerts: ReturnType<typeof buildAlerts>): string[] {
  return alerts.map((a) => a.id);
}

describe("Avisos del panel", () => {
  it("complejo en orden: sin avisos", () => {
    expect(buildAlerts(base)).toHaveLength(0);
  });

  it("sin canchas: solo avisa eso (el resto sobra)", () => {
    const alerts = buildAlerts({
      ...base,
      canchasTotales: 0,
      sinPrecio: 0,
      sinDisponibilidad: 0,
      mpConectado: false,
    });
    expect(ids(alerts)).toEqual(["sin-canchas"]);
  });

  it("avisa canchas sin horarios cargados", () => {
    const alerts = buildAlerts({ ...base, sinDisponibilidad: 2 });
    expect(ids(alerts)).toContain("sin-disponibilidad");
    expect(alerts[0]?.mensaje).toContain("2 canchas");
  });

  it("usa singular cuando es una sola cancha", () => {
    const alerts = buildAlerts({ ...base, sinDisponibilidad: 1 });
    expect(alerts[0]?.mensaje).toContain("1 cancha activa");
  });

  it("avisa canchas sin precio (no se les puede cobrar)", () => {
    const alerts = buildAlerts({ ...base, sinPrecio: 1 });
    expect(ids(alerts)).toContain("sin-precio");
  });

  it("avisa Mercado Pago sin conectar solo al dueño", () => {
    expect(ids(buildAlerts({ ...base, mpConectado: false }))).toContain(
      "mp-sin-conectar",
    );
    // El staff no puede conectar la cuenta: el aviso no le sirve.
    expect(
      ids(buildAlerts({ ...base, mpConectado: false, esOwner: false })),
    ).not.toContain("mp-sin-conectar");
  });

  it("prioriza disponibilidad sobre precio (primero poder reservar)", () => {
    const alerts = buildAlerts({ ...base, sinPrecio: 1, sinDisponibilidad: 1 });
    expect(ids(alerts)).toEqual(["sin-disponibilidad", "sin-precio"]);
  });

  it("cada aviso trae link y llamada a la acción", () => {
    const alerts = buildAlerts({
      ...base,
      sinPrecio: 1,
      sinDisponibilidad: 1,
      mpConectado: false,
    });
    for (const a of alerts) {
      expect(a.href.startsWith("/dashboard")).toBe(true);
      expect(a.cta.length).toBeGreaterThan(0);
    }
  });
});
