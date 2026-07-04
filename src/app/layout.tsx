import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canchas SaaS",
  description: "Gestión de complejos deportivos",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
