#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { hubspotClientFromEnv } from "./hubspotClient.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerDealTools } from "./tools/deals.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerAccountSummaryTool } from "./tools/accountSummary.js";

async function main() {
  const client = hubspotClientFromEnv();

  const server = new McpServer({
    name: "hubspot-crm-mcp-server",
    version: "0.1.0",
  });

  registerContactTools(server, client);
  registerDealTools(server, client);
  registerTicketTools(server, client);
  registerAccountSummaryTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // MCP communicates over stdio, so nothing else may write to stdout —
  // status logging goes to stderr instead.
  console.error("hubspot-crm-mcp-server: connected, 10 tools registered.");
}

main().catch((err) => {
  console.error("hubspot-crm-mcp-server failed to start:", err);
  process.exit(1);
});
