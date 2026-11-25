import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/AuthPage";

export const metadata: Metadata = { title: "Login — Rokkha" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return <AuthPage mode="login" searchParams={searchParams} />;
}
