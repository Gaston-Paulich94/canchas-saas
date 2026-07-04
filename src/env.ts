import { z } from "zod";

/**
 * Validación de variables de entorno en el borde de arranque.
 *
 * Si falta o es inválida cualquier variable crítica, la app NO arranca
 * (fail-closed). Esto evita correr en producción con una config insegura
 * (ej. sin clave de cifrado, o con la URL de DB equivocada).
 *
 * Este módulo es SOLO de servidor. Nunca lo importes desde un Client Component:
 * filtraría secretos al bundle del cliente.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // URL del rol ADMIN/owner de la DB. Se usa exclusivamente para migraciones
  // (DDL, creación de roles, RLS). Nunca para el runtime de la app.
  DATABASE_URL: z.string().url(),

  // URL del rol de runtime de la app: app_user, NO-owner y SIN BYPASSRLS.
  // Es la conexión que respeta RLS. Toda query de negocio usa esta.
  APP_DATABASE_URL: z.string().url(),

  // Secreto de better-auth (firma de sesiones/tokens). Mínimo 32 chars.
  BETTER_AUTH_SECRET: z.string().min(32),

  // URL base pública de la app (better-auth la usa para cookies y callbacks).
  BETTER_AUTH_URL: z.string().url(),

  // Clave AES-256-GCM para cifrar tokens OAuth de Mercado Pago at-rest.
  // 32 bytes codificados en base64 (=> 44 chars base64). Se valida el largo
  // real del material de clave al decodificar.
  MP_TOKEN_ENC_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "MP_TOKEN_ENC_KEY debe ser 32 bytes en base64 (clave AES-256)."),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // No serializamos los valores, solo qué claves fallaron.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${issues}\n` +
        "Revisá tu .env contra .env.example.",
    );
  }
  return parsed.data;
}

export const env = loadEnv();
