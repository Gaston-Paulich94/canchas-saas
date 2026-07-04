import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/modules/shared/infrastructure/db/client";
import { user } from "@/modules/shared/infrastructure/db/schema";
import { withTenantAndSelf } from "@/modules/shared/infrastructure/db/with-tenant";
import { insertTenant } from "@/modules/tenants/infrastructure/tenant.repository";
import { insertProfile } from "@/modules/auth/infrastructure/profile.repository";
import { ROLES } from "@/modules/auth/domain/roles";
import type { RegisterOwnerInput } from "@/modules/auth/domain/schemas";

function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "complejo";
}

/**
 * Use-case: registro de un OWNER.
 *
 * 1. Crea el usuario y su sesión vía better-auth (autoSignIn → cookie segura,
 *    rotada). La contraseña la hashea better-auth; nunca la tocamos.
 * 2. Crea el tenant y el profile (rol owner) en una transacción scopeada con
 *    app.tenant_id + app.user_id, de modo que el WITH CHECK de RLS pase.
 *
 * El tenantId se genera en el SERVIDOR (randomUUID), nunca viene del cliente.
 * Si el paso 2 falla, borramos el usuario recién creado para no dejar un
 * usuario huérfano sin tenant (consistencia / fail-closed).
 */
export async function registerOwner(
  input: RegisterOwnerInput,
): Promise<{ tenantId: string }> {
  const signUp = await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.ownerName,
    },
    headers: await headers(),
  });

  const userId = signUp.user.id;
  const tenantId = randomUUID();
  const slug = `${slugify(input.complejoName)}-${randomUUID().slice(0, 8)}`;

  try {
    await withTenantAndSelf(tenantId, userId, async (tx) => {
      await insertTenant(tx, {
        id: tenantId,
        name: input.complejoName,
        slug,
      });
      await insertProfile(tx, {
        userId,
        tenantId,
        role: ROLES.OWNER,
      });
    });
  } catch (err) {
    // Rollback de consistencia: el usuario sin tenant no debe quedar.
    // (user no tiene RLS; app_user tiene DELETE. El cascade limpia su sesión.)
    await db.delete(user).where(eq(user.id, userId));
    throw err;
  }

  return { tenantId };
}
