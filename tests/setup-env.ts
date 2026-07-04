// Variables de entorno dummy para los tests UNITARIOS (los que importan módulos
// que dependen de `@/env`, como el cifrado). Los tests de integración con
// testcontainers construyen sus propias conexiones y NO usan estos valores.
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV ??= "test";
env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
env.APP_DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
env.BETTER_AUTH_SECRET ??= "test-secret-de-al-menos-32-caracteres!!";
env.BETTER_AUTH_URL ??= "http://localhost:3000";
env.MP_TOKEN_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
