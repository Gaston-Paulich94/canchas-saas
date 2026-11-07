import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/mp/webhooks/payment/route";
import { readBodyWithLimit } from "@/lib/read-body";

/**
 * Hallazgo #8: el webhook leía el cuerpo entero (sin tope) y lo parseaba
 * antes de verificar la firma. Ninguno de estos casos llega a la base.
 */

const SECRET = "test-webhook-secret"; // el de tests/setup-env.ts
const BASE = "http://localhost:3000/api/mp/webhooks/payment";

function signature(dataId: string, requestId: string, ts = Math.floor(Date.now() / 1000)): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("readBodyWithLimit", () => {
  it("devuelve el cuerpo si entra en el tope", async () => {
    const req = new Request(BASE, { method: "POST", body: '{"data":{"id":"1"}}' });
    expect(await readBodyWithLimit(req, 1024)).toBe('{"data":{"id":"1"}}');
  });

  it("devuelve null si el cuerpo supera el tope, aunque no declare Content-Length", async () => {
    const big = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const req = new Request(BASE, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBodyWithLimit(req, 16 * 1024)).toBeNull();
  });

  it("corta sin leer si Content-Length ya anuncia más que el tope", async () => {
    const req = new Request(BASE, {
      method: "POST",
      body: "x",
      headers: { "content-length": String(10 * 1024 * 1024) },
    });
    expect(await readBodyWithLimit(req, 16 * 1024)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it("sin cuerpo devuelve string vacío", async () => {
    expect(await readBodyWithLimit(new Request(BASE, { method: "POST" }), 1024)).toBe("");
  });
});

describe("POST /api/mp/webhooks/payment — antes de la firma", () => {
  it("con el id en la query y firma inválida: 401 sin leer el cuerpo", async () => {
    const req = new Request(`${BASE}?data.id=123&payment_ref=x`, {
      method: "POST",
      body: '{"data":{"id":"123"}}',
      headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "r1" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(req.bodyUsed).toBe(false);
  });

  it("con el id en la query y firma válida: verifica sin leer el cuerpo", async () => {
    // payment_ref inválido: corta con 200 después de la firma, sin tocar la base.
    const req = new Request(`${BASE}?data.id=123&payment_ref=no-es-uuid`, {
      method: "POST",
      body: '{"data":{"id":"123"}}',
      headers: { "x-signature": signature("123", "r2"), "x-request-id": "r2" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(req.bodyUsed).toBe(false);
  });

  it("sin id en la query y cuerpo enorme: 413 sin cargarlo entero", async () => {
    const req = new Request(`${BASE}?payment_ref=x`, {
      method: "POST",
      body: "x".repeat(1024 * 1024),
      headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "r3" },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("sin id en la query: toma el id del cuerpo y exige la firma igual", async () => {
    const sinFirma = new Request(`${BASE}?payment_ref=x`, {
      method: "POST",
      body: '{"data":{"id":"456"}}',
      headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "r4" },
    });
    expect((await POST(sinFirma)).status).toBe(401);

    const firmada = new Request(`${BASE}?payment_ref=no-es-uuid`, {
      method: "POST",
      body: '{"data":{"id":"456"}}',
      headers: { "x-signature": signature("456", "r5"), "x-request-id": "r5" },
    });
    expect((await POST(firmada)).status).toBe(200);
  });

  it("cuerpo que no es JSON y sin id en la query: 401 (no hay qué verificar)", async () => {
    const req = new Request(`${BASE}?payment_ref=x`, {
      method: "POST",
      body: "<xml>no</xml>",
      headers: { "x-signature": signature("1", "r6"), "x-request-id": "r6" },
    });
    expect((await POST(req)).status).toBe(401);
  });
});
