import { NextResponse } from "next/server";
import { env } from "@/env";
import { verifyMpWebhookSignature } from "@/modules/payments/infrastructure/mp-signature";
import { mpWebhookBodySchema } from "@/modules/payments/domain/schemas";
import { readBodyWithLimit } from "@/lib/read-body";
import { processPaymentNotification } from "@/modules/payments/application/process-notification";

/**
 * Webhook de Mercado Pago — ÚNICA fuente de verdad de un pago.
 *
 * Endpoint público sin sesión, así que la postura es máxima desconfianza:
 *  1. Verificación de firma HMAC-SHA256 (timing-safe) + ventana anti-replay.
 *     Sin firma válida => 401 y no se toca la base. El cuerpo no se lee antes
 *     de verificar salvo que el id no venga por query, y entonces con tope.
 *  2. El cuerpo solo aporta el id del pago; el estado se re-consulta a la API
 *     de MP (ver process-notification).
 *  3. Respuestas mínimas: nunca se filtra si una referencia existe, ni detalle
 *     de errores internos.
 *  4. Ante un error interno devolvemos 500 para que MP REINTENTE (no se pierde
 *     una acreditación por una caída puntual).
 */

// Siempre dinámico: nunca cachear una notificación.
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Una notificación de MP pesa unos cientos de bytes; 16 KB sobra.
const MAX_BODY_BYTES = 16 * 1024;

/** id del pago en el cuerpo `{ data: { id } }`, o null si no está. */
function dataIdFromBody(rawBody: string): string | null {
  if (!rawBody) return null;
  try {
    const parsed = mpWebhookBodySchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? parsed.data.data.id : null;
  } catch {
    return null; // Cuerpo no-JSON.
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // `payment_ref` lo pusimos NOSOTROS en la notification_url al crear la
  // preferencia: es un puntero a nuestra fila, no una fuente de autoridad.
  const paymentRef = url.searchParams.get("payment_ref");
  // MP manda el id del pago por query y/o en el cuerpo.
  const dataIdFromQuery =
    url.searchParams.get("data.id") ?? url.searchParams.get("id");

  // MP firma el data.id que manda por query: con eso se verifica la firma sin
  // tocar el cuerpo. Solo si no vino por query se lee el cuerpo, con tope de
  // tamaño, porque todavía no se verificó nada.
  let dataId = dataIdFromQuery;
  if (!dataId) {
    const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (rawBody === null) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    dataId = dataIdFromBody(rawBody);
  }

  // El manifest de la firma se arma con el data.id.
  const signatureValid = verifyMpWebhookSignature({
    signatureHeader: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    dataId,
    secret: env.MP_WEBHOOK_SECRET,
  });

  if (!signatureValid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ya autenticada la notificación, validamos la forma de los datos.
  if (!paymentRef || !UUID_RE.test(paymentRef) || !dataId) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await processPaymentNotification(paymentRef, dataId);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    // 500 => Mercado Pago reintenta la notificación más tarde.
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
