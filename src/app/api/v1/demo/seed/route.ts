import { seedDemo } from "@/lib/demo";
import { route } from "@/lib/http";
import { Memory } from "@/lib/memory";

/** Wipes the tenant and loads the launch + poisoned-email scenarios. */
export const POST = route(async ({ mem }) => {
  await mem.reset();
  return seedDemo(await Memory.open(mem.tenant));
});
