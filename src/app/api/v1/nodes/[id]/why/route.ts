import { route } from "@/lib/http";

export const GET = route(({ mem, params }) => mem.why(params.id));
