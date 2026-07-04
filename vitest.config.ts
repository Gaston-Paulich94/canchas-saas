import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Tests de integración con testcontainers: levantan Postgres real y pueden
    // tardar en el primer pull de la imagen.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
