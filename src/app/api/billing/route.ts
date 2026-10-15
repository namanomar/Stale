import { billingSummary } from "@/lib/billing";
import { route } from "@/lib/http";

/** Plan, status and usage for the signed-in workspace. */
export const GET = route(async ({ principal }) => billingSummary(principal.org.id));
