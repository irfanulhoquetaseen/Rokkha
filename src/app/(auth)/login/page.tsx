import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/AuthPage";

export const metadata: Metadata = { title: "Login — JibonSetu" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return <AuthPage mode="login" searchParams={searchParams} />;
}
