import { route } from "@/lib/http";

export const POST = route(({ mem, params }) => mem.executeAction(params.id));
