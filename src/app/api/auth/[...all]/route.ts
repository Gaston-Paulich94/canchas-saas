import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Handler de todos los endpoints de better-auth (/api/auth/*).
export const { GET, POST } = toNextJsHandler(auth);
