import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HubSpotClient, HubSpotObject } from "../hubspotClient.js";
import { textResult, formatObject } from "../format.js";

const CONTACT_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "company",
  "jobtitle",
  "lifecyclestage",
  "hs_lead_status",
];

export async function searchContacts(
  client: HubSpotClient,
  { query, limit }: { query: string; limit?: number },
) {
  const result = await client.search("contacts", {
    query,
    properties: CONTACT_PROPERTIES,
    limit: limit ?? 10,
  });
  if (result.results.length === 0) {
    return textResult(`No contacts matched "${query}".`);
  }
  const lines = result.results.map(formatContactLine);
  return textResult(`Found ${result.results.length} contact(s):\n\n${lines.join("\n")}`);
}

export async function getContact(client: HubSpotClient, { contactId }: { contactId: string }) {
  const contact = await client.get("contacts", contactId, CONTACT_PROPERTIES);
  return textResult(formatObject("Contact", contact));
}

export async function createContact(
  client: HubSpotClient,
  args: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    jobTitle?: string;
  },
) {
  const properties: Record<string, string> = { email: args.email };
  if (args.firstName) properties.firstname = args.firstName;
  if (args.lastName) properties.lastname = args.lastName;
  if (args.company) properties.company = args.company;
  if (args.phone) properties.phone = args.phone;
  if (args.jobTitle) properties.jobtitle = args.jobTitle;

  const created = await client.create("contacts", properties);
  return textResult(`Created contact ${created.id}.\n\n${formatObject("Contact", created)}`);
}

function formatContactLine(c: HubSpotObject): string {
  const p = c.properties;
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "(no name)";
  const company = p.company ? ` @ ${p.company}` : "";
  return `- [${c.id}] ${name}${company} — ${p.email ?? "no email"}`;
}

export function registerContactTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "search_contacts",
    "Search HubSpot contacts by name, email, or company. Returns up to `limit` matches " +
      "with their core properties. Use this before get_contact when you don't already have an ID.",
    {
      query: z
        .string()
        .describe("Free-text search — matches against name, email, company, and phone."),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    },
    (args) => searchContacts(client, args),
  );

  server.tool(
    "get_contact",
    "Fetch a single HubSpot contact by ID, including their core properties. " +
      "Pair with get_account_summary for a fuller picture (deals + tickets included).",
    { contactId: z.string().describe("HubSpot contact ID (from search_contacts).") },
    (args) => getContact(client, args),
  );

  server.tool(
    "create_contact",
    "Create a new HubSpot contact. Email is required by HubSpot for deduplication; " +
      "other fields are optional but recommended for a usable CRM record.",
    {
      email: z.string().email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      company: z.string().optional(),
      phone: z.string().optional(),
      jobTitle: z.string().optional(),
    },
    (args) => createContact(client, args),
  );
}
