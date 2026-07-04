import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";

export default async function Home() {
  const ctx = await getSessionContext();
  redirect(ctx ? "/dashboard" : "/login");
}
