import { z } from "zod";
import { route } from "@/lib/http";
import { addMemberByEmail, listMembers, removeMember } from "@/lib/system";

export const GET = route(async ({ principal }) => listMembers(principal.org.id));

export const POST = route(
  async ({ principal, body }) => {
    const b = await body(z.object({ email: z.string().trim().email(), role: z.enum(["viewer", "member", "admin"]) }));
    addMemberByEmail(principal.org.id, b.email, b.role);
    return listMembers(principal.org.id);
  },
  { min: "admin" },
);

export const DELETE = route(
  async ({ principal, url }) => {
    removeMember(principal.org.id, url.searchParams.get("userId") ?? "");
    return listMembers(principal.org.id);
  },
  { min: "admin" },
);
