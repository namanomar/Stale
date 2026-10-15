import { checkIntegration } from "@/lib/connectors";
import { route } from "@/lib/http";
import { getIntegration, integrationConfig, setIntegrationStatus } from "@/lib/system";

/** Make one small real request to the service and report whether the connection actually works. */
export const GET = route(async ({ principal, params }) => {
  const i = await getIntegration(principal.org.id, params.id);
  const r = await checkIntegration(i.type, await integrationConfig(principal.org.id, i.id), i.events);
  await setIntegrationStatus(principal.org.id, i.id, r.state === "error" ? "error" : "connected");
  return r;
});
