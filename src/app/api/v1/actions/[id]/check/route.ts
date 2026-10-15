import { route } from "@/lib/http";

export const GET = route(({ mem, params }) => mem.checkAction(params.id));
export const POST = GET;
