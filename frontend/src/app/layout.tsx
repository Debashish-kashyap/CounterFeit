import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verity | Medicine Traceability",
  description: "Medicine supply-chain verification and custody records.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ServiceWorkerRegister />
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}