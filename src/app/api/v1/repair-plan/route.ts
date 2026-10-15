import { route } from "@/lib/http";

export const GET = route(({ mem }) => mem.repairPlan());
