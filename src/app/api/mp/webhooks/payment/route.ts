import { NextResponse } from "next/server";
import { env } from "@/env";
import { verifyMpWebhookSignature } from "@/modules/payments/infrastructure/mp-signature";
import { mpWebhookBodySchema } from "@/modules/payments/domain/schemas";
import { processPaymentNotification } from "@/modules/payments/application/process-notification";

/**
 * Webhook de Mercado Pago — ÚNICA fuente de verdad de un pago.
 *
 * Endpoint público sin sesión, así que la postura es máxima desconfianza:
 *  1. Verificación de firma HMAC-SHA256 (timing-safe) + ventana anti-replay.
 *     Sin firma válida => 401 y no se toca la base.
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

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // `payment_ref` lo pusimos NOSOTROS en la notification_url al crear la
  // preferencia: es un puntero a nuestra fila, no una fuente de autoridad.
  const paymentRef = url.searchParams.get("payment_ref");
  // MP manda el id del pago por query y/o en el cuerpo.
  const dataIdFromQuery =
    url.searchParams.get("data.id") ?? url.searchParams.get("id");

  const rawBody = await request.text();
  let bodyDataId: string | null = null;
  if (rawBody) {
    try {
      const parsed = mpWebhookBodySchema.safeParse(JSON.parse(rawBody));
      if (parsed.success) bodyDataId = parsed.data.data.id;
    } catch {
      // Cuerpo no-JSON: seguimos con el id del query, si lo hay.
    }
  }

  const dataId = dataIdFromQuery ?? bodyDataId;

  // El manifest de la firma se arma con el data.id tal como llega por query.
  const signatureValid = verifyMpWebhookSignature({
    signatureHeader: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    dataId: dataIdFromQuery ?? dataId,
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
