import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, errorResponse, requireRole } from "@/lib/http";
import { buildMcpServer } from "@/lib/mcp";
import { Memory } from "@/lib/memory";

/**
 * Streamable-HTTP MCP endpoint. Stateless: a fresh server per request, scoped to
 * the workspace of the API key: Settings -> API keys.
 *   claude mcp add --transport http stale http://localhost:3000/api/mcp --header "Authorization: Bearer sk_..."
 */
async function handle(req: Request) {
  try {
    const principal = await authenticate(req);
    requireRole(principal, "member");
    const mem = await Memory.open(principal.org.id);
    const server = buildMcpServer(mem);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
