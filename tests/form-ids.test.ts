import { describe, it, expect } from "vitest";
import { readIdField } from "@/lib/form-ids";

/**
 * Los ids de los formularios vienen del cliente. Acá solo se valida la forma;
 * la pertenencia al complejo la verifica cada service (tests de IDOR aparte).
 */
describe("readIdField", () => {
  const ID = "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45";

  function form(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.append(k, v);
    return fd;
  }

  it("devuelve el id si es un UUID válido", () => {
    expect(readIdField(form({ courtId: ID }), "courtId")).toBe(ID);
  });

  it("null si falta el campo", () => {
    expect(readIdField(form({}), "courtId")).toBeNull();
  });

  it("null si no es un UUID (evita llevar basura a la base)", () => {
    for (const malo of ["", "123", "../otro", `${ID}' OR '1'='1`]) {
      expect(readIdField(form({ courtId: malo }), "courtId")).toBeNull();
    }
  });

  it("null si el campo es un archivo y no texto", () => {
    const fd = new FormData();
    fd.append("courtId", new Blob(["x"]), "x.txt");
    expect(readIdField(fd, "courtId")).toBeNull();
  });
});
