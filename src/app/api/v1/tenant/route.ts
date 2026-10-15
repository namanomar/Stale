import { route } from "@/lib/http";

export const DELETE = route(async ({ mem }) => {
  await mem.reset();
  return { reset: mem.tenant };
});
