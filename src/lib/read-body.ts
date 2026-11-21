/**
 * Lee el cuerpo de un request con un TOPE de bytes. Devuelve null si lo supera.
 *
 * `request.text()` carga el cuerpo entero en memoria, sea del tamaño que sea.
 * En un endpoint público sin sesión (el webhook) eso permite que cualquiera
 * mande cuerpos enormes antes de que se verifique nada. Acá se corta apenas
 * se pasa el tope, y si `Content-Length` ya lo anuncia, ni se empieza a leer.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
