import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HubSpotClient, HubSpotObject } from "../hubspotClient.js";
import { textResult, formatObject, formatAmount } from "../format.js";

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "hs_deal_stage_probability",
];

export async function searchDeals(
  client: HubSpotClient,
  { query, dealStage, limit }: { query?: string; dealStage?: string; limit?: number },
) {
  const filters = dealStage
    ? [{ propertyName: "dealstage", operator: "EQ" as const, value: dealStage }]
    : undefined;
  const result = await client.search("deals", {
    query,
    filters,
    properties: DEAL_PROPERTIES,
    limit: limit ?? 10,
  });
  if (result.results.length === 0) {
    return textResult("No deals matched that search.");
  }
  const lines = result.results.map(formatDealLine);
  return textResult(`Found ${result.results.length} deal(s):\n\n${lines.join("\n")}`);
}

export async function getDeal(client: HubSpotClient, { dealId }: { dealId: string }) {
  const [deal, contactIds] = await Promise.all([
    client.get("deals", dealId, DEAL_PROPERTIES),
    client.listAssociations("deals", dealId, "contacts"),
  ]);
  const assoc = contactIds.length
    ? `\n\nAssociated contact IDs: ${contactIds.join(", ")}`
    : "\n\nNo associated contacts.";
  return textResult(formatObject("Deal", deal) + assoc);
}

export async function createDeal(
  client: HubSpotClient,
  args: {
    dealName: string;
    amount?: number;
    dealStage?: string;
    pipeline?: string;
    contactId?: string;
  },
) {
  const properties: Record<string, string | number> = { dealname: args.dealName };
  if (args.amount !== undefined) properties.amount = args.amount;
  if (args.dealStage) properties.dealstage = args.dealStage;
  if (args.pipeline) properties.pipeline = args.pipeline;

  const created = await client.create("deals", properties);

  let associationNote = "";
  if (args.contactId) {
    try {
      await client.associate("deals", created.id, "contacts", args.contactId);
      associationNote = `\n\nAssociated with contact ${args.contactId}.`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      associationNote = `\n\nDeal created, but associating it with contact ${args.contactId} failed: ${reason}`;
    }
  }

  return textResult(
    `Created deal ${created.id}.\n\n${formatObject("Deal", created)}${associationNote}`,
  );
}

export async function updateDealStage(
  client: HubSpotClient,
  { dealId, dealStage }: { dealId: string; dealStage: string },
) {
  const updated = await client.update("deals", dealId, { dealstage: dealStage });
  return textResult(`Updated deal ${dealId} to stage "${dealStage}".\n\n${formatObject("Deal", updated)}`);
}

function formatDealLine(d: HubSpotObject): string {
  const p = d.properties;
  return `- [${d.id}] ${p.dealname ?? "(unnamed)"} — ${formatAmount(p.amount)} — stage: ${p.dealstage ?? "unknown"}`;
}

export function registerDealTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "search_deals",
    "Search HubSpot deals by name, optionally filtered to a specific pipeline stage. " +
      "Useful for questions like 'what deals are in the proposal stage'.",
    {
      query: z.string().optional().describe("Free-text match against the deal name."),
      dealStage: z
        .string()
        .optional()
        .describe("Exact HubSpot dealstage internal value to filter on, if known."),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    },
    (args) => searchDeals(client, args),
  );

  server.tool(
    "get_deal",
    "Fetch a single HubSpot deal by ID, including stage, amount, close date, and the " +
      "contacts associated with it.",
    { dealId: z.string().describe("HubSpot deal ID (from search_deals).") },
    (args) => getDeal(client, args),
  );

  server.tool(
    "create_deal",
    "Create a new HubSpot deal, optionally associated with an existing contact. " +
      "Amount is in the portal's default currency.",
    {
      dealName: z.string(),
      amount: z.number().optional(),
      dealStage: z.string().optional().describe("Internal dealstage value; omit to use the pipeline default."),
      pipeline: z.string().optional(),
      contactId: z.string().optional().describe("If provided, associates the new deal with this contact."),
    },
    (args) => createDeal(client, args),
  );

  server.tool(
    "update_deal_stage",
    "Move a deal to a new pipeline stage — the most common day-to-day CRM write action " +
      "(e.g. advancing a deal from 'proposal' to 'closed won').",
    {
      dealId: z.string(),
      dealStage: z.string().describe("Internal HubSpot dealstage value to move the deal to."),
    },
    (args) => updateDealStage(client, args),
  );
}
