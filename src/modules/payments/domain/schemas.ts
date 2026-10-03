import { z } from "zod";

/**
 * Esquemas Zod del módulo pagos. Validan TODO lo que entra desde afuera:
 * el callback de OAuth y el cuerpo del webhook de Mercado Pago.
 *
 * Que un dato pase el schema NO lo vuelve confiable: el webhook además exige
 * firma válida y se re-consulta contra la API de MP antes de acreditar nada.
 */

/** Query del callback de OAuth (?code=...&state=...). */
export const oauthCallbackSchema = z
  .object({
    code: z.string().min(1).max(512),
    state: z.string().min(1).max(256),
  })
  .strict();

/** Respuesta del intercambio de `code` por tokens (POST /oauth/token). */
export const mpTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  // user_id del vendedor (el complejo). MP lo manda como número.
  user_id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  expires_in: z.number().optional(),
});

/** Respuesta de la creación de preferencia (POST /checkout/preferences). */
export const mpPreferenceResponseSchema = z.object({
  id: z.string().min(1),
  init_point: z.string().url(),
  sandbox_init_point: z.string().url().optional(),
});

/**
 * Pago consultado a la API de MP (GET /v1/payments/{id}).
 * `external_reference` es NUESTRO uuid de payment: así atamos la notificación
 * a la fila correcta sin confiar en el cuerpo del webhook.
 */
export const mpPaymentResponseSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string().min(1),
  external_reference: z.string().uuid().nullable().optional(),
  transaction_amount: z.number().nonnegative().optional(),
  currency_id: z.string().nullable().optional(),
  date_approved: z.string().nullable().optional(),
});

/**
 * Cuerpo de la notificación del webhook. Solo nos interesa `data.id` (el id del
 * pago en MP); el resto del payload es informativo y NO decide nada.
 */
export const mpWebhookBodySchema = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  data: z.object({
    id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  }),
});

export type MpTokenResponse = z.infer<typeof mpTokenResponseSchema>;
export type MpPreferenceResponse = z.infer<typeof mpPreferenceResponseSchema>;
export type MpPaymentResponse = z.infer<typeof mpPaymentResponseSchema>;
export type MpWebhookBody = z.infer<typeof mpWebhookBodySchema>;
