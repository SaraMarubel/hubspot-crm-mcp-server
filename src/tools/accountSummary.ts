import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HubSpotClient } from "../hubspotClient.js";
import { textResult, formatAmount } from "../format.js";

/**
 * The one tool in this server that isn't a thin CRUD wrapper: it stitches
 * together a contact's own properties with every deal and ticket associated
 * with them into one readable account brief. This is the kind of
 * cross-object view a rep would otherwise have to open three separate CRM
 * tabs to assemble by hand — and the concrete reason to put an MCP server in
 * front of a CRM instead of just using the CRM's own UI.
 */
export async function getAccountSummary(client: HubSpotClient, { contactId }: { contactId: string }) {
  const contact = await client.get("contacts", contactId, [
    "email",
    "firstname",
    "lastname",
    "company",
    "jobtitle",
    "lifecyclestage",
  ]);

  const [dealIds, ticketIds] = await Promise.all([
    client.listAssociations("contacts", contactId, "deals"),
    client.listAssociations("contacts", contactId, "tickets"),
  ]);

  const [deals, tickets] = await Promise.all([
    Promise.all(dealIds.map((id) => client.get("deals", id, ["dealname", "amount", "dealstage"]))),
    Promise.all(
      ticketIds.map((id) => client.get("tickets", id, ["subject", "hs_ticket_priority", "hs_pipeline_stage"])),
    ),
  ]);

  const p = contact.properties;
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "(no name)";
  const lines: string[] = [
    `# Account Summary — ${name}`,
    `Email: ${p.email ?? "—"}  |  Company: ${p.company ?? "—"}  |  Title: ${p.jobtitle ?? "—"}`,
    `Lifecycle stage: ${p.lifecyclestage ?? "—"}`,
    "",
    `## Deals (${deals.length})`,
  ];

  if (deals.length === 0) {
    lines.push("None on record.");
  } else {
    const totalOpen = deals.reduce((sum, d) => sum + (Number(d.properties.amount) || 0), 0);
    for (const d of deals) {
      lines.push(
        `- ${d.properties.dealname ?? "(unnamed)"} — ${formatAmount(d.properties.amount)} — ${d.properties.dealstage ?? "unknown stage"}`,
      );
    }
    lines.push(`Total deal value on record: ${formatAmount(String(totalOpen))}`);
  }

  lines.push("", `## Support tickets (${tickets.length})`);
  if (tickets.length === 0) {
    lines.push("None on record.");
  } else {
    for (const t of tickets) {
      const priority = t.properties.hs_ticket_priority ? ` [${t.properties.hs_ticket_priority}]` : "";
      lines.push(`- ${t.properties.subject ?? "(no subject)"}${priority}`);
    }
  }

  return textResult(lines.join("\n"));
}

export function registerAccountSummaryTool(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "get_account_summary",
    "Build a single account brief for a contact: their profile, every deal associated " +
      "with them (with stage and amount), and every support ticket associated with them " +
      "(with priority). Use this instead of chaining get_contact + search_deals + " +
      "search_tickets when you want the full picture in one call.",
    { contactId: z.string().describe("HubSpot contact ID.") },
    (args) => getAccountSummary(client, args),
  );
}
