import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/AuthPage";

export const metadata: Metadata = { title: "Sign up — JibonSetu" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return <AuthPage mode="signup" searchParams={searchParams} />;
}
