import { afterEach, describe, expect, it, vi } from "vitest";
import { expirePreference } from "@/modules/payments/infrastructure/mp-client";
import { MpApiError } from "@/modules/payments/domain/payment";

/**
 * Lo que mandamos a Mercado Pago para vencer un link. Se verifica el pedido
 * exacto con `fetch` simulado; que MP lo acepte solo se puede comprobar contra
 * el servicio real (pendiente de la prueba con credenciales de prueba).
 */
describe("Vencer el link de pago en Mercado Pago", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hace PUT a la preferencia con expires y la fecha de vencimiento", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "pref-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expirePreference(
      "token-del-complejo",
      "123456789-abcd-ef01",
      new Date("2026-10-03T15:00:00.000Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.mercadopago.com/checkout/preferences/123456789-abcd-ef01",
    );
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-del-complejo",
    );
    // 15:00 UTC = 12:00 en Argentina, con el offset que espera MP.
    expect(JSON.parse(init.body as string)).toEqual({
      expires: true,
      expiration_date_to: "2026-10-03T12:00:00.000-03:00",
    });
  });

  it("rechaza un id con caracteres raros sin llegar a llamar a MP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(expirePreference("t", "../v1/payments")).rejects.toBeInstanceOf(
      MpApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si MP responde error, lo informa como MpApiError (sin filtrar el cuerpo)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("detalle interno de MP", { status: 404 })),
    );
    await expect(expirePreference("t", "pref-1")).rejects.toBeInstanceOf(MpApiError);
  });
});
