import { describe, it, expect } from "vitest";
import { HubSpotClient } from "../src/hubspotClient.js";
import { mockFetchJson, mockFetchSequence } from "./mocks/hubspotMock.js";
import { searchContacts, getContact, createContact } from "../src/tools/contacts.js";
import { searchDeals, getDeal, createDeal, updateDealStage } from "../src/tools/deals.js";
import { searchTickets, createTicket } from "../src/tools/tickets.js";
import { getAccountSummary } from "../src/tools/accountSummary.js";

function clientWith(fetchImpl: typeof fetch) {
  return new HubSpotClient({ accessToken: "test-token", fetchImpl });
}

describe("contacts tools", () => {
  it("search_contacts reports a clean 'no matches' message instead of an empty block", async () => {
    const client = clientWith(mockFetchJson(200, { results: [] }));
    const result = await searchContacts(client, { query: "nobody" });
    expect(result.content[0].text).toMatch(/no contacts matched/i);
  });

  it("search_contacts formats name, company, and email per result", async () => {
    const client = clientWith(
      mockFetchJson(200, {
        results: [
          { id: "1", properties: { firstname: "Ada", lastname: "Lovelace", company: "Acme", email: "ada@acme.com" } },
        ],
      }),
    );
    const result = await searchContacts(client, { query: "ada" });
    expect(result.content[0].text).toContain("Ada Lovelace @ Acme");
    expect(result.content[0].text).toContain("ada@acme.com");
  });

  it("get_contact returns the object's properties formatted", async () => {
    const client = clientWith(mockFetchJson(200, { id: "5", properties: { email: "x@y.com" } }));
    const result = await getContact(client, { contactId: "5" });
    expect(result.content[0].text).toContain("Contact [5]");
    expect(result.content[0].text).toContain("email: x@y.com");
  });

  it("create_contact only sends properties that were actually provided", async () => {
    const fetchImpl = mockFetchJson(201, { id: "9", properties: { email: "a@b.com" } });
    const client = clientWith(fetchImpl);

    await createContact(client, { email: "a@b.com" });

    const [, init] = (fetchImpl as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.properties).toEqual({ email: "a@b.com" });
    expect(body.properties.firstname).toBeUndefined();
  });
});

describe("deals tools", () => {
  it("search_deals filters by dealStage when provided", async () => {
    const fetchImpl = mockFetchJson(200, { results: [] });
    const client = clientWith(fetchImpl);

    await searchDeals(client, { dealStage: "closedwon" });

    const [, init] = (fetchImpl as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.filterGroups[0].filters[0]).toEqual({
      propertyName: "dealstage",
      operator: "EQ",
      value: "closedwon",
    });
  });

  it("get_deal includes associated contact IDs when present", async () => {
    const client = clientWith(
      mockFetchSequence([
        { status: 200, body: { id: "1", properties: { dealname: "Acme Deal" } } },
        { status: 200, body: { results: [{ toObjectId: "42" }] } },
      ]),
    );
    const result = await getDeal(client, { dealId: "1" });
    expect(result.content[0].text).toContain("Associated contact IDs: 42");
  });

  it("get_deal notes when there are no associated contacts", async () => {
    const client = clientWith(
      mockFetchSequence([
        { status: 200, body: { id: "1", properties: { dealname: "Solo Deal" } } },
        { status: 404, body: { message: "not found" } },
      ]),
    );
    const result = await getDeal(client, { dealId: "1" });
    expect(result.content[0].text).toContain("No associated contacts.");
  });

  it("create_deal associates with a contact when contactId is given", async () => {
    const fetchImpl = mockFetchSequence([
      { status: 201, body: { id: "77", properties: { dealname: "New Deal" } } },
      { status: 200, body: {} },
    ]);
    const client = clientWith(fetchImpl);

    const result = await createDeal(client, { dealName: "New Deal", contactId: "3" });

    expect(result.content[0].text).toContain("Associated with contact 3.");
    const [assocUrl] = (fetchImpl as any).mock.calls[1];
    expect(assocUrl).toContain("/associations/default/contacts/3");
  });

  it("create_deal reports (without throwing) when the association call fails", async () => {
    const fetchImpl = mockFetchSequence([
      { status: 201, body: { id: "77", properties: { dealname: "New Deal" } } },
      { status: 404, body: { message: "contact not found" } },
    ]);
    const client = clientWith(fetchImpl);

    const result = await createDeal(client, { dealName: "New Deal", contactId: "does-not-exist" });

    expect(result.content[0].text).toContain("Created deal 77");
    expect(result.content[0].text).toMatch(/associating it with contact does-not-exist failed/i);
  });

  it("update_deal_stage sends a PATCH with only dealstage", async () => {
    const fetchImpl = mockFetchJson(200, { id: "1", properties: { dealstage: "closedwon" } });
    const client = clientWith(fetchImpl);

    const result = await updateDealStage(client, { dealId: "1", dealStage: "closedwon" });

    const [, init] = (fetchImpl as any).mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).properties).toEqual({ dealstage: "closedwon" });
    expect(result.content[0].text).toContain('stage "closedwon"');
  });
});

describe("tickets tools", () => {
  it("search_tickets filters by priority", async () => {
    const fetchImpl = mockFetchJson(200, { results: [] });
    const client = clientWith(fetchImpl);

    await searchTickets(client, { priority: "URGENT" });

    const body = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(body.filterGroups[0].filters[0].value).toBe("URGENT");
  });

  it("create_ticket sets default pipeline/stage and optional priority", async () => {
    const fetchImpl = mockFetchJson(201, { id: "8", properties: { subject: "Login broken" } });
    const client = clientWith(fetchImpl);

    await createTicket(client, { subject: "Login broken", priority: "HIGH" });

    const body = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(body.properties.hs_pipeline).toBe("0");
    expect(body.properties.hs_ticket_priority).toBe("HIGH");
  });
});

describe("get_account_summary", () => {
  it("stitches contact + deals + tickets into one brief, including a computed total", async () => {
    const client = clientWith(
      mockFetchSequence([
        { status: 200, body: { id: "1", properties: { firstname: "Ada", lastname: "Lovelace", company: "Acme" } } },
        { status: 200, body: { results: [{ toObjectId: "d1" }] } }, // deal associations
        { status: 200, body: { results: [{ toObjectId: "t1" }] } }, // ticket associations
        { status: 200, body: { id: "d1", properties: { dealname: "Acme Expansion", amount: "12000", dealstage: "proposal" } } },
        { status: 200, body: { id: "t1", properties: { subject: "Onboarding question", hs_ticket_priority: "LOW" } } },
      ]),
    );

    const result = await getAccountSummary(client, { contactId: "1" });
    const text = result.content[0].text;

    expect(text).toContain("Account Summary — Ada Lovelace");
    expect(text).toContain("Acme Expansion");
    expect(text).toContain("$12,000.00");
    expect(text).toContain("Onboarding question");
    expect(text).toContain("Total deal value on record: $12,000.00");
  });

  it("reports 'None on record' for a contact with no deals or tickets", async () => {
    const client = clientWith(
      mockFetchSequence([
        { status: 200, body: { id: "2", properties: { firstname: "Grace", lastname: "Hopper" } } },
        { status: 404, body: {} },
        { status: 404, body: {} },
      ]),
    );

    const result = await getAccountSummary(client, { contactId: "2" });
    const text = result.content[0].text;

    expect(text).toContain("## Deals (0)");
    expect(text).toContain("## Support tickets (0)");
    expect((text.match(/None on record\./g) || []).length).toBe(2);
  });
});
