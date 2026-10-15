import { checkIntegration } from "@/lib/connectors";
import { route } from "@/lib/http";
import { getIntegration, integrationConfig, setIntegrationStatus } from "@/lib/system";

/** Make one small real request to the service and report whether the connection actually works. */
export const GET = route(async ({ principal, params }) => {
  const i = getIntegration(principal.org.id, params.id);
  const r = await checkIntegration(i.type, integrationConfig(principal.org.id, i.id), i.events);
  setIntegrationStatus(principal.org.id, i.id, r.state === "error" ? "error" : "connected");
  return r;
});
