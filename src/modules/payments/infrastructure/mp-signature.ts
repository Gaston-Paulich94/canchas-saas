import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma del webhook de Mercado Pago.
 *
 * Es LA garantía de que una notificación de pago es auténtica: sin esto,
 * cualquiera que conozca la URL podría marcar reservas como pagadas.
 *
 * Mecanismo (documentado por MP):
 *   header `x-signature`:  ts=<unix>,v1=<hmac-sha256-hex>
 *   header `x-request-id`: <id del request>
 *   query  `data.id`:      <id del pago>
 *
 *   manifest = `id:<data.id>;request-id:<request-id>;ts:<ts>;`
 *   v1 == HMAC_SHA256(manifest, MP_WEBHOOK_SECRET)
 *
 * Defensas:
 *  - comparación en tiempo constante (no filtra la firma por timing);
 *  - ventana temporal (anti-replay de notificaciones viejas capturadas);
 *  - fail-closed: cualquier header ausente/malformado => inválida.
 */

/** Tolerancia de reloj para el `ts` de la firma. */
export const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export interface VerifySignatureInput {
  /** Header `x-signature` crudo. */
  signatureHeader: string | null;
  /** Header `x-request-id` crudo. */
  requestId: string | null;
  /** `data.id` del query string (id del pago en MP). */
  dataId: string | null;
  /** Clave secreta del webhook (env). */
  secret: string;
  /** Momento actual, inyectable para tests. */
  now?: number;
}

/** Parsea `ts=...,v1=...` en un mapa. Tolera espacios; ignora claves extra. */
function parseSignatureHeader(header: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const chunk of header.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (key && value && !parts.has(key)) parts.set(key, value);
  }
  return parts;
}

/** Compara dos strings hex en tiempo constante. */
function safeEqualHex(a: string, b: string): boolean {
  // Longitudes distintas => inválida. (El largo de un HMAC-SHA256 es fijo, así
  // que comparar largos acá no filtra información útil.)
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Normaliza el `ts` de la firma a milisegundos. */
function tsToMillis(ts: string): number | null {
  if (!/^\d+$/.test(ts)) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // MP envía segundos; toleramos milisegundos por las dudas.
  return n >= 1e12 ? n : n * 1000;
}

/**
 * Devuelve true SOLO si la notificación es auténtica y está dentro de la
 * ventana temporal. Cualquier duda => false (fail-closed).
 */
export function verifyMpWebhookSignature({
  signatureHeader,
  requestId,
  dataId,
  secret,
  now = Date.now(),
}: VerifySignatureInput): boolean {
  if (!signatureHeader || !dataId || !secret) return false;

  const parts = parseSignatureHeader(signatureHeader);
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  const tsMs = tsToMillis(ts);
  if (tsMs === null) return false;
  // Rechaza notificaciones viejas (replay) y timestamps del futuro.
  if (Math.abs(now - tsMs) > SIGNATURE_MAX_AGE_MS) return false;

  // MP indica usar el id en minúsculas cuando es alfanumérico.
  const normalizedId = dataId.toLowerCase();
  const manifest = `id:${normalizedId};request-id:${requestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  return safeEqualHex(expected, v1.toLowerCase());
}
