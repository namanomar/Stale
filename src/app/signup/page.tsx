import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create workspace · Stale" };

export default async function Signup() {
  if (await getPrincipal()) redirect("/app");
  return <AuthForm mode="signup" />;
}
