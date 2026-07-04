import { eq, desc } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  profiles,
  type Profile,
  type NewProfile,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a profiles. Toda lectura filtra explícitamente por el id de usuario
 * (capa de app), ADEMÁS de la RLS de la DB (capa independiente). Las dos cubren
 * por separado: si una se misconfigura, la otra sostiene.
 */

export async function findProfileByUserId(
  tx: DbTx,
  userId: string,
): Promise<Profile | null> {
  const rows = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .orderBy(desc(profiles.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertProfile(
  tx: DbTx,
  data: NewProfile,
): Promise<Profile> {
  const rows = await tx.insert(profiles).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear el profile.");
  return row;
}
