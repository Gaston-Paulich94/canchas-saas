import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tokenNeedsRefresh,
  tokenIsExpired,
  expiresAtFrom,
  TOKEN_REFRESH_MARGIN_MS,
} from "@/modules/payments/domain/mp-token";
import {
  getValidMpAccessToken,
  type MpTokenDeps,
} from "@/modules/payments/application/mp-token-service";
import { refreshAccessToken } from "@/modules/payments/infrastructure/mp-client";
import {
  MpConnectionExpiredError,
  MpNotConnectedError,
  MpApiError,
} from "@/modules/payments/domain/payment";
import type { StoredMpTokens } from "@/modules/payments/infrastructure/mp-credentials";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);

describe("Vigencia del token (lógica pura)", () => {
  it("con mucho margen no se renueva", () => {
    expect(tokenNeedsRefresh(inDays(30), NOW)).toBe(false);
  });

  it("dentro del margen de 7 días se renueva", () => {
    expect(tokenNeedsRefresh(inDays(6), NOW)).toBe(true);
    expect(tokenNeedsRefresh(new Date(NOW.getTime() + TOKEN_REFRESH_MARGIN_MS - 1), NOW)).toBe(true);
  });

  it("vencido también se intenta renovar (el refresh token puede seguir valiendo)", () => {
    expect(tokenNeedsRefresh(inDays(-3), NOW)).toBe(true);
    expect(tokenIsExpired(inDays(-3), NOW)).toBe(true);
  });

  it("sin vencimiento conocido no se renueva ni se da por vencido", () => {
    expect(tokenNeedsRefresh(null, NOW)).toBe(false);
    expect(tokenIsExpired(null, NOW)).toBe(false);
  });

  it("calcula el vencimiento desde expires_in", () => {
    expect(expiresAtFrom(15_552_000, NOW)).toEqual(inDays(180));
    expect(expiresAtFrom(undefined, NOW)).toBeNull();
    expect(expiresAtFrom(0, NOW)).toBeNull();
  });
});

/** Base de datos de mentira: un complejo con tokens y un "cifrado" versionado. */
function fakeDeps(initial: StoredMpTokens | null, overrides: Partial<MpTokenDeps> = {}) {
  let stored = initial;
  let version = 0;
  const saves: unknown[] = [];
  const deps: MpTokenDeps = {
    load: async () => {
      if (!stored) throw new MpNotConnectedError();
      return { ...stored };
    },
    refresh: vi.fn(async () => ({
      access_token: "access-nuevo",
      refresh_token: "refresh-nuevo",
      user_id: "1",
      expires_in: 15_552_000,
    })),
    saveIfUnchanged: async (_t, expected, tokens) => {
      if (!stored || stored.refreshTokenEnc !== expected) return false;
      version++;
      stored = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        refreshTokenEnc: `enc-v${version}`,
      };
      saves.push(tokens);
      return true;
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, saves, current: () => stored };
}

const vigente = (expiresAt: Date | null): StoredMpTokens => ({
  accessToken: "access-actual",
  refreshToken: "refresh-actual",
  expiresAt,
  refreshTokenEnc: "enc-v0",
});

describe("getValidMpAccessToken", () => {
  it("token con margen: lo devuelve sin llamar a MP", async () => {
    const { deps } = fakeDeps(vigente(inDays(60)));
    expect(await getValidMpAccessToken("t", deps)).toBe("access-actual");
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("cerca de vencer: renueva, guarda el par nuevo y devuelve el nuevo", async () => {
    const { deps, saves, current } = fakeDeps(vigente(inDays(3)));
    expect(await getValidMpAccessToken("t", deps)).toBe("access-nuevo");
    expect(deps.refresh).toHaveBeenCalledWith("refresh-actual");
    expect(saves).toHaveLength(1);
    expect(current()?.refreshToken).toBe("refresh-nuevo");
    expect(current()?.expiresAt).toEqual(inDays(180));
  });

  it("si MP no devuelve refresh token nuevo, conserva el actual", async () => {
    const { deps, current } = fakeDeps(vigente(inDays(3)), {
      refresh: vi.fn(async () => ({ access_token: "access-nuevo", user_id: "1", expires_in: 100 })),
    });
    await getValidMpAccessToken("t", deps);
    expect(current()?.refreshToken).toBe("refresh-actual");
  });

  it("falla la renovación pero el token todavía vale: lo usa (reintenta después)", async () => {
    const { deps, saves } = fakeDeps(vigente(inDays(3)), {
      refresh: vi.fn(async () => { throw new MpApiError(); }),
    });
    expect(await getValidMpAccessToken("t", deps)).toBe("access-actual");
    expect(saves).toHaveLength(0);
  });

  it("falla la renovación y ya venció: pide reconectar", async () => {
    const { deps } = fakeDeps(vigente(inDays(-1)), {
      refresh: vi.fn(async () => { throw new MpApiError(); }),
    });
    await expect(getValidMpAccessToken("t", deps)).rejects.toBeInstanceOf(MpConnectionExpiredError);
  });

  it("vencido y sin refresh token: pide reconectar sin llamar a MP", async () => {
    const { deps } = fakeDeps({ ...vigente(inDays(-1)), refreshToken: null, refreshTokenEnc: null });
    await expect(getValidMpAccessToken("t", deps)).rejects.toBeInstanceOf(MpConnectionExpiredError);
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("sin cuenta conectada: MpNotConnectedError", async () => {
    const { deps } = fakeDeps(null);
    await expect(getValidMpAccessToken("t", deps)).rejects.toBeInstanceOf(MpNotConnectedError);
  });

  it("CARRERA: otro pedido renovó antes de guardar → no lo pisa y usa el suyo", async () => {
    const base = fakeDeps(vigente(inDays(3)));
    // Simula que, mientras renovábamos, otro proceso guardó un par más nuevo.
    const deps: MpTokenDeps = {
      ...base.deps,
      refresh: vi.fn(async () => {
        await base.deps.saveIfUnchanged("t", "enc-v0", {
          accessToken: "access-del-otro",
          refreshToken: "refresh-del-otro",
          expiresAt: inDays(180),
        });
        return { access_token: "access-mio", refresh_token: "refresh-mio", user_id: "1", expires_in: 100 };
      }),
    };
    expect(await getValidMpAccessToken("t", deps)).toBe("access-del-otro");
    expect(base.current()?.refreshToken).toBe("refresh-del-otro"); // no se pisó
  });

  it("CARRERA: el refresh falla porque otro ya lo usó → usa el token que guardó el otro", async () => {
    const base = fakeDeps({ ...vigente(inDays(-1)) });
    const deps: MpTokenDeps = {
      ...base.deps,
      refresh: vi.fn(async () => {
        await base.deps.saveIfUnchanged("t", "enc-v0", {
          accessToken: "access-del-otro",
          refreshToken: "refresh-del-otro",
          expiresAt: inDays(180),
        });
        throw new MpApiError(); // nuestro refresh token ya quedó viejo
      }),
    };
    expect(await getValidMpAccessToken("t", deps)).toBe("access-del-otro");
  });
});

describe("Pedido de renovación a Mercado Pago", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POST /oauth/token con grant_type refresh_token y las credenciales de la app", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "a", refresh_token: "r", user_id: 1, expires_in: 10 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await refreshAccessToken("refresh-del-complejo");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/oauth/token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-del-complejo",
    });
  });
});
