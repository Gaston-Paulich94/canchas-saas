import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/modules/auth/application/session-context";
import { RegisterForm } from "@/components/auth/register-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function RegisterPage() {
  const ctx = await getSessionContext();
  if (ctx) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Registrá tu complejo</CardTitle>
          <CardDescription>
            Creá tu cuenta de dueño y empezá a gestionar.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <RegisterForm />
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="font-medium underline">
              Ingresá
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
