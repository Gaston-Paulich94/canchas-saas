import { NextResponse } from "next/server";
import { env } from "@/env";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { oauthCallbackSchema } from "@/modules/payments/domain/schemas";
import { completeMpConnection } from "@/modules/payments/application/mp-connection";

/**
 * Callback del OAuth de Mercado Pago.
 *
 * Exige SESIÓN válida: el tenant al que se asocia la cuenta sale de la sesión
 * del servidor, nunca de la URL. El `state` (cookie HttpOnly, un solo uso) se
 * valida dentro del use-case.
 *
 * Nunca se filtra el motivo exacto del fallo al usuario; se vuelve a la
 * pantalla de pagos con un flag genérico.
 */

export const dynamic = "force-dynamic";

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, env.APP_PUBLIC_URL));
}

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await getSessionContext();
  if (!ctx) return redirectTo("/login");

  const url = new URL(request.url);
  const parsed = oauthCallbackSchema.safeParse({
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state") ?? "",
  });

  if (!parsed.success) {
    return redirectTo("/dashboard/pagos?conexion=error");
  }

  try {
    await completeMpConnection(ctx, parsed.data.code, parsed.data.state);
  } catch {
    return redirectTo("/dashboard/pagos?conexion=error");
  }

  return redirectTo("/dashboard/pagos?conexion=ok");
}
