import { env } from "@/env";
import {
  MpApiError,
  type PaymentStatus,
  mapMpStatus,
} from "@/modules/payments/domain/payment";
import {
  mpTokenResponseSchema,
  mpPreferenceResponseSchema,
  mpPaymentResponseSchema,
  type MpTokenResponse,
} from "@/modules/payments/domain/schemas";

/**
 * Cliente de la API de Mercado Pago con `fetch` nativo (sin SDK: menos
 * superficie de cadena de suministro).
 *
 * Reglas de seguridad de este adapter:
 *  - El host es CONSTANTE y hardcodeado: ninguna URL saliente se arma con
 *    input del usuario (anti-SSRF).
 *  - Timeout en toda llamada: una API colgada no cuelga la app.
 *  - Los tokens viajan en el header y NUNCA se loguean ni se devuelven al
 *    cliente. Los errores se normalizan a MpApiError (sin cuerpo crudo).
 *  - Toda respuesta se valida con Zod antes de usarse.
 */

const MP_API_BASE = "https://api.mercadopago.com";
const MP_AUTH_BASE = "https://auth.mercadopago.com.ar";
const REQUEST_TIMEOUT_MS = 10_000;

async function mpFetch(
  path: string,
  init: RequestInit & { accessToken?: string },
): Promise<unknown> {
  const { accessToken, headers, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${MP_API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
    });

    if (!res.ok) {
      // No propagamos el cuerpo de MP: puede incluir datos sensibles y no le
      // sirve al cliente. El detalle queda del lado del servidor.
      throw new MpApiError(`Mercado Pago respondió ${res.status}.`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof MpApiError) throw err;
    throw new MpApiError();
  } finally {
    clearTimeout(timeout);
  }
}

/** URL a la que mandamos al owner para que autorice su cuenta (OAuth). */
export function buildAuthorizationUrl(state: string, redirectUri: string): string {
  const url = new URL("/authorization", MP_AUTH_BASE);
  url.searchParams.set("client_id", env.MP_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

/** Canjea el `code` del OAuth por los tokens del complejo. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<MpTokenResponse> {
  const json = await mpFetch("/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const parsed = mpTokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new MpApiError("Respuesta de OAuth inesperada.");
  return parsed.data;
}

/** Renueva el access token del complejo con su refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<MpTokenResponse> {
  const json = await mpFetch("/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const parsed = mpTokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new MpApiError("Respuesta de refresh inesperada.");
  return parsed.data;
}

export interface CreatePreferenceInput {
  accessToken: string;
  /** NUESTRO uuid de payment: ata la notificación a la fila correcta. */
  externalReference: string;
  title: string;
  amountCents: number;
  feeCents: number;
  notificationUrl: string;
  successUrl: string;
  payerEmail?: string | null;
}

/** Crea la preferencia de Checkout Pro en la cuenta del complejo. */
export async function createPreference(
  input: CreatePreferenceInput,
): Promise<{ id: string; initPoint: string }> {
  const json = await mpFetch("/checkout/preferences", {
    method: "POST",
    accessToken: input.accessToken,
    body: JSON.stringify({
      items: [
        {
          title: input.title,
          quantity: 1,
          currency_id: "ARS",
          // MP espera el importe en pesos (decimal); internamente lo llevamos
          // en centavos enteros para no arrastrar errores de punto flotante.
          unit_price: input.amountCents / 100,
        },
      ],
      // Comisión que retiene la plataforma (marketplace). La calcula el backend.
      marketplace_fee: input.feeCents / 100,
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: { success: input.successUrl, pending: input.successUrl, failure: input.successUrl },
      ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
    }),
  });

  const parsed = mpPreferenceResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new MpApiError("Respuesta de preferencia inesperada.");
  }
  return { id: parsed.data.id, initPoint: parsed.data.init_point };
}

/** Fecha en el formato que espera MP, con offset de Argentina (-03:00). */
function toMpDate(date: Date): string {
  const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
  return new Date(date.getTime() - AR_OFFSET_MS)
    .toISOString()
    .replace("Z", "-03:00");
}

/**
 * Vence una preferencia de Checkout Pro: a partir de `now` el link ya no se
 * puede pagar. Se usa al anular un cobro o cancelar la reserva.
 */
export async function expirePreference(
  accessToken: string,
  preferenceId: string,
  now: Date = new Date(),
): Promise<void> {
  // El id se valida antes de interpolarlo en la ruta (sin input libre en URLs).
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(preferenceId)) {
    throw new MpApiError("Id de preferencia inválido.");
  }
  await mpFetch(`/checkout/preferences/${preferenceId}`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify({
      expires: true,
      expiration_date_to: toMpDate(now),
    }),
  });
}

export interface MpPaymentSnapshot {
  mpPaymentId: string;
  status: PaymentStatus;
  externalReference: string | null;
  /** Importe que MP dice que se pagó, en CENTAVOS (MP lo informa en pesos). */
  amountCents: number | null;
  currencyId: string | null;
  approvedAt: Date | null;
}

/**
 * Consulta un pago en la API de MP. ESTA es la fuente de verdad: el cuerpo del
 * webhook solo aporta el id, nunca el estado.
 */
export async function getPayment(
  accessToken: string,
  mpPaymentId: string,
): Promise<MpPaymentSnapshot> {
  // El id se valida como dígitos/alfanumérico antes de interpolarlo en la ruta.
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mpPaymentId)) {
    throw new MpApiError("Id de pago inválido.");
  }

  const json = await mpFetch(`/v1/payments/${mpPaymentId}`, {
    method: "GET",
    accessToken,
  });

  const parsed = mpPaymentResponseSchema.safeParse(json);
  if (!parsed.success) throw new MpApiError("Respuesta de pago inesperada.");

  const approved = parsed.data.date_approved
    ? new Date(parsed.data.date_approved)
    : null;

  return {
    mpPaymentId: parsed.data.id,
    status: mapMpStatus(parsed.data.status),
    externalReference: parsed.data.external_reference ?? null,
    // Pesos → centavos con redondeo: evita que un 0.1 flotante no coincida.
    amountCents:
      parsed.data.transaction_amount === undefined
        ? null
        : Math.round(parsed.data.transaction_amount * 100),
    currencyId: parsed.data.currency_id ?? null,
    approvedAt: approved && !Number.isNaN(approved.getTime()) ? approved : null,
  };
}
