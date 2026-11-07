import { describe, it, expect } from "vitest";
import {
  assertCourtBookable,
  CourtInactiveError,
} from "@/modules/reservations/domain/reservation";

/**
 * Hallazgo #9: la UI ocultaba las canchas desactivadas, pero el server
 * aceptaba reservas en ellas si el pedido llegaba armado a mano.
 */
describe("assertCourtBookable", () => {
  it("una cancha activa acepta turnos", () => {
    expect(() => assertCourtBookable({ isActive: true })).not.toThrow();
  });

  it("una cancha desactivada se rechaza con un mensaje claro", () => {
    expect(() => assertCourtBookable({ isActive: false })).toThrow(CourtInactiveError);
    expect(() => assertCourtBookable({ isActive: false })).toThrow(/desactivada/);
  });
});
