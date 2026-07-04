import { NextResponse, type NextRequest } from "next/server";

/**
 * Baseline de security headers para TODA respuesta.
 *
 * CSP con nonce por request: generamos un nonce, lo ponemos en la CSP del
 * REQUEST y Next.js lo propaga automáticamente a sus propios <script>. Junto a
 * `strict-dynamic` esto evita inline-scripts no autorizados (anti-XSS) sin
 * listar hashes a mano.
 *
 * En edge runtime no hay Buffer: usamos Web Crypto + btoa.
 *
 * (Next 16 renombró el convention `middleware` → `proxy`.)
 */
export function proxy(request: NextRequest): NextResponse {
  const isProd = process.env.NODE_ENV === "production";

  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  const nonce = btoa(String.fromCharCode(...random));

  const csp = [
    `default-src 'self'`,
    // En dev, Next necesita 'unsafe-eval' (HMR). En prod, solo nonce + strict-dynamic.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isProd ? "" : " 'unsafe-eval'"
    }`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next lee el nonce desde esta CSP del request para aplicarlo a sus scripts.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );
  if (isProd) {
    response.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  // Aplica a todo menos a assets estáticos y al favicon.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
