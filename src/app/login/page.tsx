import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Stale" };

export default async function Login() {
  if (await getPrincipal()) redirect("/app");
  return <AuthForm mode="login" />;
}
