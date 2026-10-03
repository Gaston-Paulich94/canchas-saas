import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  isLoginAllowed,
  isRegisterAllowed,
  rateLimitKeyHash,
  AUTH_LIMITS,
} from "@/modules/auth/application/rate-limit";
import {
  consumeRateLimit,
  type SqlExecutor,
} from "@/modules/auth/infrastructure/rate-limit.repository";

/**
 * Rate-limit de login/registro contra Postgres real, con el rol de runtime
 * `app_user` (el mismo que usa la app en producción).
 */
describe("Rate-limit de autenticación (anti fuerza bruta)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  beforeEach(async () => {
    await db.adminSql`delete from auth_rate_limits`;
  });

  it("bloquea la fuerza bruta sobre UNA cuenta aunque cambie la IP", async () => {
    const { max } = AUTH_LIMITS.loginPorCuenta;
    const results: boolean[] = [];
    for (let i = 0; i < max + 1; i++) {
      // Una IP distinta por intento: el límite por IP no interviene.
      results.push(await isLoginAllowed(`10.0.0.${i}`, "victima@demo.test", db.appDb));
    }
    expect(results.slice(0, max).every(Boolean)).toBe(true);
    expect(results[max]).toBe(false);
  });

  it("el límite por cuenta no bloquea a OTRAS cuentas", async () => {
    const { max } = AUTH_LIMITS.loginPorCuenta;
    for (let i = 0; i < max + 1; i++) {
      await isLoginAllowed(`10.0.1.${i}`, "victima@demo.test", db.appDb);
    }
    expect(await isLoginAllowed("10.0.2.1", "otra@demo.test", db.appDb)).toBe(true);
  });

  it("bloquea a UNA IP que prueba muchas cuentas", async () => {
    const { max } = AUTH_LIMITS.loginPorIp;
    const results: boolean[] = [];
    for (let i = 0; i < max + 1; i++) {
      results.push(await isLoginAllowed("203.0.113.9", `cuenta${i}@demo.test`, db.appDb));
    }
    expect(results.slice(0, max).every(Boolean)).toBe(true);
    expect(results[max]).toBe(false);
  });

  it("normaliza el email: mayúsculas y espacios no esquivan el límite", async () => {
    const { max } = AUTH_LIMITS.loginPorCuenta;
    for (let i = 0; i < max; i++) {
      const variante = i % 2 === 0 ? "Victima@Demo.test" : "  victima@demo.test ";
      await isLoginAllowed(`10.0.3.${i}`, variante, db.appDb);
    }
    expect(await isLoginAllowed("10.0.3.99", "VICTIMA@DEMO.TEST", db.appDb)).toBe(false);
  });

  it("cuando vence la ventana, la cuenta se desbloquea", async () => {
    const { max, windowSeconds } = AUTH_LIMITS.loginPorCuenta;
    for (let i = 0; i < max + 1; i++) {
      await isLoginAllowed(`10.0.4.${i}`, "victima@demo.test", db.appDb);
    }
    expect(await isLoginAllowed("10.0.4.200", "victima@demo.test", db.appDb)).toBe(false);

    // Simula el paso del tiempo: ventanas iniciadas antes del período.
    await db.adminSql`
      update auth_rate_limits
      set window_start = now() - make_interval(secs => ${windowSeconds + 60})`;
    expect(await isLoginAllowed("10.0.4.201", "victima@demo.test", db.appDb)).toBe(true);
  });

  it("limita la creación de cuentas por IP", async () => {
    const { max } = AUTH_LIMITS.registroPorIp;
    const results: boolean[] = [];
    for (let i = 0; i < max + 1; i++) {
      results.push(await isRegisterAllowed("198.51.100.4", db.appDb));
    }
    expect(results.slice(0, max).every(Boolean)).toBe(true);
    expect(results[max]).toBe(false);
  });

  it("es atómico: 30 intentos concurrentes cuentan exactamente 30", async () => {
    const key = rateLimitKeyHash("login:cuenta:concurrente@demo.test");
    await Promise.all(
      Array.from({ length: 30 }, () => consumeRateLimit(db.appDb, key, 900)),
    );
    const [row] = await db.adminSql`
      select count from auth_rate_limits where key_hash = ${key}`;
    expect(row?.count).toBe(30);
  });

  it("no guarda emails ni IPs en claro (solo HMAC)", async () => {
    await isLoginAllowed("192.0.2.77", "privado@demo.test", db.appDb);
    const rows = await db.adminSql`select key_hash from auth_rate_limits`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const k = r.key_hash as string;
      expect(k).toMatch(/^[0-9a-f]{64}$/);
      expect(k).not.toContain("privado");
      expect(k).not.toContain("192.0.2.77");
    }
  });

  it("fail-closed: si el contador falla, se deniega", async () => {
    const roto: SqlExecutor = {
      execute: (() => Promise.reject(new Error("DB caída"))) as unknown as SqlExecutor["execute"],
    };
    expect(await isLoginAllowed("192.0.2.1", "x@demo.test", roto)).toBe(false);
    expect(await isRegisterAllowed("192.0.2.1", roto)).toBe(false);
  });
});
