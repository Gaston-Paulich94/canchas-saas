import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage() {
  // Si ya hay sesión, no mostramos el login.
  const ctx = await getSessionContext();
  if (ctx) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Ingresá a tu complejo</CardTitle>
          <CardDescription>
            Gestioná reservas, canchas y clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LoginForm />
          <p className="text-center text-sm text-muted-foreground">
            ¿No tenés cuenta?{" "}
            <Link href="/register" className="font-medium underline">
              Registrá tu complejo
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
