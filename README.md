# HubSpot CRM MCP Server

An [MCP](https://modelcontextprotocol.io) server that connects Claude directly to a HubSpot CRM — search, create, and update contacts, deals, and support tickets, plus a cross-object account summary tool that stitches all three together into one brief. Built as a demonstration of the kind of integration work a client/solutions engineer actually ships: wiring a real customer's business system up to an AI assistant, with the auth, error handling, and test coverage a production integration needs — not a toy demo.

## Why this exists

Enterprise customers who want to use Claude against their own tools need someone to build the connector. This repo is that connector for HubSpot: a small, focused MCP server exposing the CRM objects a sales/support team actually works with, so Claude can answer "what deals are in the proposal stage" or "summarize this account" against real data instead of a copy-pasted CRM export.

## Tools

| Tool | What it does |
|---|---|
| `search_contacts` | Free-text search across name, email, company |
| `get_contact` | Fetch one contact's full profile by ID |
| `create_contact` | Create a new contact |
| `search_deals` | Search deals, optionally filtered by pipeline stage |
| `get_deal` | Fetch one deal, including its associated contacts |
| `create_deal` | Create a deal, optionally associated with a contact |
| `update_deal_stage` | Move a deal to a new pipeline stage |
| `search_tickets` | Search support tickets, optionally filtered by priority |
| `create_ticket` | Create a support ticket, optionally associated with a contact |
| `get_account_summary` | **The cross-object tool** — one contact's profile + every deal + every ticket associated with them, in a single readable brief |

`get_account_summary` is the one tool here that isn't a thin CRUD wrapper — it's the concrete reason to put an MCP server in front of a CRM instead of just using the CRM's own UI: assembling that view by hand normally means opening three separate tabs.

## Setup

**1. Install and build**

```bash
npm install
npm run build
```

**2. Get a HubSpot access token**

You don't need a paid HubSpot account — a free [developer test account](https://developers.hubspot.com/docs/getting-started/account-types#developer-test-accounts) comes preloaded with realistic sample CRM data, which is what this was built and tested against.

1. In your HubSpot account: **Settings → Integrations → Private Apps → Create a private app**
2. Under **Scopes**, grant:
   - `crm.objects.contacts.read` / `.write`
   - `crm.objects.deals.read` / `.write`
   - `crm.objects.tickets.read` / `.write`
3. Copy the generated access token

**3. Configure the token**

```bash
cp .env.example .env
# paste your token into .env
```

**4. Point an MCP client at it**

For Claude Desktop or Claude Code, add to your MCP config:

```json
{
  "mcpServers": {
    "hubspot-crm": {
      "command": "node",
      "args": ["/absolute/path/to/hubspot-crm-mcp-server/dist/index.js"],
      "env": { "HUBSPOT_ACCESS_TOKEN": "your-token-here" }
    }
  }
}
```

Then ask Claude things like: *"Search HubSpot for contacts at Acme"* or *"Give me an account summary for contact 12345"*.

**5. Or test it standalone with the MCP Inspector** (no Claude client needed):

```bash
npm run inspector
```

This opens a browser UI to call each tool directly and inspect the raw responses — the fastest way to verify the server works end-to-end against your own HubSpot data before wiring up a client.

## Testing

```bash
npm test
```

The full suite (26 tests) runs against a mocked `fetch` — no live HubSpot token required, so CI can run on every push without secrets. Tests cover the HTTP client (auth headers, request shaping, error handling, 404-as-empty-list semantics for associations) and every tool's business logic (formatting, filtering, the multi-call `get_account_summary` fan-out, and graceful handling when an association write fails).

## Architecture

```
src/
  hubspotClient.ts   Thin wrapper over HubSpot's REST API v3/v4 (plain fetch,
                      no HubSpot SDK dependency) — list/get/search/create/
                      update/associate, with an injectable fetch impl for tests
  format.ts           Shared response-formatting helpers
  tools/
    contacts.ts       Tool logic + MCP registration, contacts
    deals.ts          Tool logic + MCP registration, deals
    tickets.ts        Tool logic + MCP registration, tickets
    accountSummary.ts Cross-object account brief
  index.ts             Server entrypoint (stdio transport)
test/
  hubspotClient.test.ts   Unit tests for the HTTP client
  tools.test.ts           Unit tests for each tool's business logic
  mocks/hubspotMock.ts    Mocked-fetch test helpers
```

Each tool's business logic is a standalone exported function (`searchContacts`, `createDeal`, etc.) that `registerXTools()` wires into the MCP server — kept separate on purpose so the logic is directly unit-testable without spinning up an MCP transport.

## Tech stack

TypeScript, the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), Zod for input validation/schema, Vitest for testing. No HubSpot SDK, no framework — plain `fetch` against documented REST endpoints, kept deliberately small and readable.

## Limitations

- `create_ticket` assumes the default HubSpot ticket pipeline (`hs_pipeline: "0"`, first stage `"1"`) — correct for a fresh portal, but a customized pipeline would need its own IDs looked up first.
- Associations use HubSpot's v4 "default association" endpoint, which covers the common case (link a deal/ticket to a contact) but not custom association types.
- No rate-limit backoff yet — HubSpot's API returns 429s under heavy use, which this surfaces as a normal `HubSpotApiError` rather than retrying.

---
Not affiliated with or endorsed by HubSpot. Built as a portfolio project demonstrating MCP server / API integration engineering.
