import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getPrincipal } from "@/lib/session";
import { orgsOf, pendingReviewCount } from "@/lib/system";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const p = await getPrincipal();
  if (!p || !p.user) redirect("/login");
  const initial = {
    user: p.user,
    org: p.org,
    role: p.role,
    orgs: (await orgsOf(p.user.id)).map((o) => ({ id: o.id, name: o.name, role: o.role })),
    pendingReviews: await pendingReviewCount(p.org.id),
  };
  return <Shell initial={initial}>{children}</Shell>;
}
