import { route } from "@/lib/http";

export const GET = route(({ mem, url }) => {
  const raw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 50;
  return mem.events(limit);
});
