import type { NextConfig } from "next";

/**
 * Host del túnel para probar Mercado Pago en local (ver docs/pruebas-mercado-pago.md).
 * En desarrollo Next bloquea los pedidos al dev server que vienen de otro
 * dominio que no sea localhost; el túnel es otro dominio, así que se habilita
 * el de APP_PUBLIC_URL. En producción esta opción no tiene efecto.
 */
function devTunnelHosts(): string[] {
  const raw = process.env.APP_PUBLIC_URL;
  if (!raw) return [];
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" ? [] : [host];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Build de salida autónomo: copia solo lo necesario para correr en Docker.
  output: "standalone",
  // No revelar el framework subyacente.
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: devTunnelHosts(),
  // Los security headers (incluida la CSP con nonce) se aplican en el middleware,
  // que es el único lugar donde podemos generar un nonce por request.
};

export default nextConfig;
