import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HubSpotClient, HubSpotObject } from "../hubspotClient.js";
import { textResult, formatObject } from "../format.js";

const TICKET_PROPERTIES = ["subject", "content", "hs_pipeline_stage", "hs_ticket_priority", "createdate"];
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export async function searchTickets(
  client: HubSpotClient,
  { query, priority, limit }: { query?: string; priority?: Priority; limit?: number },
) {
  const filters = priority
    ? [{ propertyName: "hs_ticket_priority", operator: "EQ" as const, value: priority }]
    : undefined;
  const result = await client.search("tickets", {
    query,
    filters,
    properties: TICKET_PROPERTIES,
    limit: limit ?? 10,
  });
  if (result.results.length === 0) {
    return textResult("No tickets matched that search.");
  }
  const lines = result.results.map(formatTicketLine);
  return textResult(`Found ${result.results.length} ticket(s):\n\n${lines.join("\n")}`);
}

export async function createTicket(
  client: HubSpotClient,
  args: { subject: string; content?: string; priority?: Priority; contactId?: string },
) {
  // "0" / "1" are the default ticket pipeline and its first stage on a fresh
  // HubSpot portal, but pipelines are customizable — if this portal has
  // renumbered or added pipelines, these would need to be looked up instead.
  const properties: Record<string, string> = {
    subject: args.subject,
    hs_pipeline: "0",
    hs_pipeline_stage: "1",
  };
  if (args.content) properties.content = args.content;
  if (args.priority) properties.hs_ticket_priority = args.priority;

  const created = await client.create("tickets", properties);

  let associationNote = "";
  if (args.contactId) {
    try {
      await client.associate("tickets", created.id, "contacts", args.contactId);
      associationNote = `\n\nAssociated with contact ${args.contactId}.`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      associationNote = `\n\nTicket created, but associating it with contact ${args.contactId} failed: ${reason}`;
    }
  }

  return textResult(
    `Created ticket ${created.id}.\n\n${formatObject("Ticket", created)}${associationNote}`,
  );
}

function formatTicketLine(t: HubSpotObject): string {
  const p = t.properties;
  const priority = p.hs_ticket_priority ? ` [${p.hs_ticket_priority}]` : "";
  return `- [${t.id}]${priority} ${p.subject ?? "(no subject)"}`;
}

export function registerTicketTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "search_tickets",
    "Search HubSpot support tickets by subject text, optionally filtered by priority. " +
      "Useful for 'what high-priority tickets are open' style questions.",
    {
      query: z.string().optional().describe("Free-text match against the ticket subject."),
      priority: z
        .enum(["LOW", "MEDIUM", "HIGH", "URGENT"])
        .optional()
        .describe("Filter to tickets at this exact priority."),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    },
    (args) => searchTickets(client, args),
  );

  server.tool(
    "create_ticket",
    "Create a new HubSpot support ticket, optionally associated with an existing contact.",
    {
      subject: z.string(),
      content: z.string().optional().describe("Ticket body / description of the issue."),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
      contactId: z.string().optional().describe("If provided, associates the ticket with this contact."),
    },
    (args) => createTicket(client, args),
  );
}
