import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build de salida autónomo: copia solo lo necesario para correr en Docker.
  output: "standalone",
  // No revelar el framework subyacente.
  poweredByHeader: false,
  reactStrictMode: true,
  // Los security headers (incluida la CSP con nonce) se aplican en el middleware,
  // que es el único lugar donde podemos generar un nonce por request.
};

export default nextConfig;
