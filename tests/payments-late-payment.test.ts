import { describe, it, expect } from "vitest";
import {
  decidePaymentUpdate,
  needsRefund,
  type LocalPaymentState,
  type NotificationContext,
} from "@/modules/payments/domain/payment";

/**
 * Qué hace el webhook con cada notificación, sobre todo con los PAGOS TARDÍOS:
 * el link se paga cuando el cobro ya no correspondía.
 */

const NOW = new Date("2026-10-03T15:00:00.000Z");
const APROBADO_MP = new Date("2026-10-03T14:59:00.000Z");
const VIGENTE: NotificationContext = { reservaCancelada: false, otroCobroActivo: false };

const pendiente: LocalPaymentState = { status: "pendiente", mpPaymentId: null, paidAt: null };
const anulado: LocalPaymentState = { status: "cancelado", mpPaymentId: null, paidAt: null };
const aprobadoMp = { status: "aprobado" as const, mpPaymentId: "mp-1", approvedAt: APROBADO_MP };

describe("Pago normal", () => {
  it("un cobro pendiente que se paga queda aprobado", () => {
    const d = decidePaymentUpdate(pendiente, aprobadoMp, VIGENTE, NOW);
    expect(d).toEqual({
      kind: "actualizar",
      patch: { status: "aprobado", mpPaymentId: "mp-1", paidAt: APROBADO_MP },
      requiereReembolso: false,
    });
  });

  it("es idempotente: la misma notificación reenviada no cambia nada", () => {
    const yaAprobado: LocalPaymentState = { status: "aprobado", mpPaymentId: "mp-1", paidAt: APROBADO_MP };
    expect(decidePaymentUpdate(yaAprobado, aprobadoMp, VIGENTE, NOW)).toEqual({ kind: "sin_cambios" });
  });

  it("si MP no informa la fecha de aprobación, usa ahora", () => {
    const d = decidePaymentUpdate(pendiente, { ...aprobadoMp, approvedAt: null }, VIGENTE, NOW);
    expect(d.kind === "actualizar" && d.patch.paidAt).toEqual(NOW);
  });

  it("un intento rechazado y un reintento exitoso con el MISMO link se aprueba", () => {
    // "rechazado" lo pone MP, no es una anulación nuestra.
    const rechazado: LocalPaymentState = { status: "rechazado", mpPaymentId: "mp-0", paidAt: null };
    const d = decidePaymentUpdate(rechazado, aprobadoMp, VIGENTE, NOW);
    expect(d.kind === "actualizar" && d.patch.status).toBe("aprobado");
  });

  it("un rechazo de MP sobre un pendiente se registra", () => {
    const d = decidePaymentUpdate(pendiente, { status: "rechazado", mpPaymentId: "mp-1", approvedAt: null }, VIGENTE, NOW);
    expect(d.kind === "actualizar" && d.patch).toEqual({ status: "rechazado", mpPaymentId: "mp-1", paidAt: null });
  });
});

describe("Pago tardío: el link se pagó cuando el cobro ya no correspondía", () => {
  it("cobro ANULADO por el operador: no se reactiva, queda a reembolsar", () => {
    // Antes: el webhook lo pasaba a "aprobado" y la reserva figuraba como paga.
    const d = decidePaymentUpdate(anulado, aprobadoMp, VIGENTE, NOW);
    expect(d).toEqual({
      kind: "actualizar",
      patch: { status: "cancelado", mpPaymentId: "mp-1", paidAt: APROBADO_MP },
      requiereReembolso: true,
    });
  });

  it("hay OTRO link vivo para la reserva: no se reactiva (antes: choque de índice y 500 eterno)", () => {
    const rechazado: LocalPaymentState = { status: "rechazado", mpPaymentId: "mp-0", paidAt: null };
    const d = decidePaymentUpdate(rechazado, aprobadoMp, { reservaCancelada: false, otroCobroActivo: true }, NOW);
    expect(d.kind === "actualizar" && d.patch.status).toBe("cancelado");
    expect(d.kind === "actualizar" && d.requiereReembolso).toBe(true);
  });

  it("reserva CANCELADA con el cobro aún pendiente: no se aprueba, queda a reembolsar", () => {
    const d = decidePaymentUpdate(pendiente, aprobadoMp, { reservaCancelada: true, otroCobroActivo: false }, NOW);
    expect(d.kind === "actualizar" && d.patch.status).toBe("cancelado");
    expect(d.kind === "actualizar" && d.requiereReembolso).toBe(true);
  });

  it("nunca deja el pago en un estado vivo (eso es lo que chocaba con el índice único)", () => {
    for (const ctx of [
      { reservaCancelada: true, otroCobroActivo: false },
      { reservaCancelada: false, otroCobroActivo: true },
    ]) {
      const d = decidePaymentUpdate(pendiente, aprobadoMp, ctx, NOW);
      expect(d.kind).toBe("actualizar");
      if (d.kind === "actualizar") {
        expect(["pendiente", "aprobado"]).not.toContain(d.patch.status);
      }
    }
  });

  it("es idempotente: reenviar el pago tardío no lo vuelve a registrar", () => {
    const yaRegistrado: LocalPaymentState = { status: "cancelado", mpPaymentId: "mp-1", paidAt: APROBADO_MP };
    expect(decidePaymentUpdate(yaRegistrado, aprobadoMp, VIGENTE, NOW)).toEqual({ kind: "sin_cambios" });
  });

  it("si el complejo lo reembolsa en MP, pasa a reembolsado y conserva cuándo se cobró", () => {
    const aReembolsar: LocalPaymentState = { status: "cancelado", mpPaymentId: "mp-1", paidAt: APROBADO_MP };
    const d = decidePaymentUpdate(aReembolsar, { status: "reembolsado", mpPaymentId: "mp-1", approvedAt: null }, VIGENTE, NOW);
    expect(d).toEqual({
      kind: "actualizar",
      patch: { status: "reembolsado", mpPaymentId: "mp-1", paidAt: APROBADO_MP },
      requiereReembolso: false,
    });
  });

  it("anulado y MP dice pendiente o rechazado: no entró plata, nada que registrar", () => {
    for (const status of ["pendiente", "rechazado", "cancelado"] as const) {
      expect(decidePaymentUpdate(anulado, { status, mpPaymentId: "mp-1", approvedAt: null }, VIGENTE, NOW)).toEqual({
        kind: "sin_cambios",
      });
    }
  });
});

describe("Pago aprobado ANTES de cancelar la reserva", () => {
  it("una notificación reenviada no lo reclasifica como pago tardío", () => {
    // Qué hacer con esa plata es política del complejo, no del webhook.
    const yaAprobado: LocalPaymentState = { status: "aprobado", mpPaymentId: "mp-1", paidAt: APROBADO_MP };
    expect(
      decidePaymentUpdate(yaAprobado, aprobadoMp, { reservaCancelada: true, otroCobroActivo: false }, NOW),
    ).toEqual({ kind: "sin_cambios" });
  });

  it("si después se reembolsa en MP, se registra el reembolso", () => {
    const yaAprobado: LocalPaymentState = { status: "aprobado", mpPaymentId: "mp-1", paidAt: APROBADO_MP };
    const d = decidePaymentUpdate(
      yaAprobado,
      { status: "reembolsado", mpPaymentId: "mp-1", approvedAt: null },
      { reservaCancelada: true, otroCobroActivo: false },
      NOW,
    );
    expect(d.kind === "actualizar" && d.patch.status).toBe("reembolsado");
  });
});

describe("Marca de plata a devolver", () => {
  it("cancelado CON fecha de pago = hay que reembolsar", () => {
    expect(needsRefund({ status: "cancelado", paidAt: APROBADO_MP })).toBe(true);
  });

  it("un anulado normal (sin pago) no requiere nada", () => {
    expect(needsRefund({ status: "cancelado", paidAt: null })).toBe(false);
  });

  it("aprobado o reembolsado no figuran como pendientes de devolver", () => {
    expect(needsRefund({ status: "aprobado", paidAt: APROBADO_MP })).toBe(false);
    expect(needsRefund({ status: "reembolsado", paidAt: APROBADO_MP })).toBe(false);
  });
});
