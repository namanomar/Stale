import { route } from "@/lib/http";
import { listReviews } from "@/lib/system";

export const GET = route(async ({ principal, url }) =>
  await listReviews(principal.org.id, url.searchParams.get("status") ?? undefined),
);
