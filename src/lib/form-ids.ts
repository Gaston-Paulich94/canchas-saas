import { z } from "zod";

/**
 * Ids de recursos que viajan como CAMPO OCULTO de un formulario.
 *
 * Por qué no `.bind(null, id)`: cuando el `.bind` se hace en un componente
 * de CLIENTE y la acción devuelve un estado (un error), si el formulario se
 * envía sin JavaScript Next nunca responde. Es un bug de Next: reproducido en
 * 16.3.8, 16.4.2 y 16.4.3 con una página mínima, sin código nuestro ni el
 * proxy. El `.bind` hecho en un componente de servidor no se colgaba, pero
 * usamos el mismo patrón en todos lados: es más simple y deja explícito de
 * dónde viene el id. El campo oculto anda bien con y sin JavaScript.
 *
 * Importante: el id lo controla el cliente, igual que lo hacía con `.bind`. Acá
 * solo se valida la FORMA (UUID). Que el recurso pertenezca al complejo lo
 * garantiza el service, que siempre busca por tenant + id (anti-IDOR, con
 * tests), y la RLS de la base.
 */

const uuid = z.string().uuid();

/** Lee un id del formulario. Devuelve null si falta o no es un UUID válido. */
export function readIdField(formData: FormData, name: string): string | null {
  const parsed = uuid.safeParse(formData.get(name));
  return parsed.success ? parsed.data : null;
}
