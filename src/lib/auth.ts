import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/env";
import { db } from "@/modules/shared/infrastructure/db/client";
import {
  user,
  session,
  account,
  verification,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Configuración de better-auth (vive en nuestro Postgres, sin lock-in).
 *
 * Seguridad:
 *  - Cookies de sesión HttpOnly + SameSite=Lax + Secure (en prod). better-auth
 *    crea una sesión nueva en cada login (rotación de sesión).
 *  - Rate limiting activo (anti fuerza bruta en login y endpoints sensibles).
 *  - Política de contraseña: mínimo 12, máximo 128.
 *  - El plugin nextCookies() persiste las cookies cuando llamamos a auth.api
 *    desde Server Actions.
 */
export const auth = betterAuth({
  appName: "Canchas SaaS",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // refresca expiración 1×/día
  },

  rateLimit: {
    enabled: true,
    window: 60, // 60 s
    max: 20, // por ventana, por IP
  },

  advanced: {
    cookiePrefix: "canchas",
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    },
  },

  // nextCookies() debe ir SIEMPRE último.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
