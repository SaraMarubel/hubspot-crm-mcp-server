import { describe, it, expect } from "vitest";
import { HubSpotClient, HubSpotApiError } from "../src/hubspotClient.js";
import { mockFetchJson, mockFetchSequence } from "./mocks/hubspotMock.js";

describe("HubSpotClient", () => {
  it("throws immediately if constructed without an access token", () => {
    // @ts-expect-error deliberately omitting the required field
    expect(() => new HubSpotClient({})).toThrow(/access token is required/i);
  });

  it("lists objects and normalizes the result shape", async () => {
    const fetchImpl = mockFetchJson(200, {
      results: [{ id: "1", properties: { email: "a@example.com" } }],
    });
    const client = new HubSpotClient({ accessToken: "test-token", fetchImpl });

    const result = await client.list("contacts", { limit: 5 });

    expect(result.total).toBe(1);
    expect(result.results[0].properties.email).toBe("a@example.com");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/crm/v3/objects/contacts?limit=5"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends the bearer token on every request", async () => {
    const fetchImpl = mockFetchJson(200, { results: [] });
    const client = new HubSpotClient({ accessToken: "secret-token-123", fetchImpl });

    await client.list("deals");

    const [, init] = (fetchImpl as ReturnType<typeof mockFetchJson> & { mock: any }).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer secret-token-123");
  });

  it("gets a single object by id with the requested properties", async () => {
    const fetchImpl = mockFetchJson(200, {
      id: "42",
      properties: { dealname: "Acme Renewal", amount: "5000" },
    });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    const deal = await client.get("deals", "42", ["dealname", "amount"]);

    expect(deal.id).toBe("42");
    expect(deal.properties.amount).toBe("5000");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/crm/v3/objects/deals/42?properties=dealname,amount"),
      expect.anything(),
    );
  });

  it("posts a search body with filters and query", async () => {
    const fetchImpl = mockFetchJson(200, { total: 1, results: [{ id: "1", properties: {} }] });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    await client.search("contacts", {
      query: "acme",
      filters: [{ propertyName: "company", operator: "EQ", value: "Acme" }],
      properties: ["email"],
      limit: 3,
    });

    const [url, init] = (fetchImpl as ReturnType<typeof mockFetchJson> & { mock: any }).mock.calls[0];
    expect(url).toContain("/crm/v3/objects/contacts/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.query).toBe("acme");
    expect(body.filterGroups[0].filters[0].propertyName).toBe("company");
  });

  it("creates an object via POST with the given properties", async () => {
    const fetchImpl = mockFetchJson(201, { id: "99", properties: { email: "new@example.com" } });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    const created = await client.create("contacts", { email: "new@example.com" });

    expect(created.id).toBe("99");
    const [, init] = (fetchImpl as ReturnType<typeof mockFetchJson> & { mock: any }).mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("updates an object via PATCH", async () => {
    const fetchImpl = mockFetchJson(200, { id: "7", properties: { dealstage: "closedwon" } });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    const updated = await client.update("deals", "7", { dealstage: "closedwon" });

    expect(updated.properties.dealstage).toBe("closedwon");
    const [, init] = (fetchImpl as ReturnType<typeof mockFetchJson> & { mock: any }).mock.calls[0];
    expect(init.method).toBe("PATCH");
  });

  it("returns an empty list (not an error) when associations 404", async () => {
    const fetchImpl = mockFetchJson(404, { message: "not found" });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    const ids = await client.listAssociations("contacts", "1", "deals");

    expect(ids).toEqual([]);
  });

  it("parses associated object IDs from the associations endpoint", async () => {
    const fetchImpl = mockFetchJson(200, { results: [{ toObjectId: "10" }, { toObjectId: "11" }] });
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    const ids = await client.listAssociations("contacts", "1", "deals");

    expect(ids).toEqual(["10", "11"]);
  });

  it("throws a HubSpotApiError with status and parsed body on a non-404 failure", async () => {
    const fetchImpl = mockFetchJson(401, { message: "This access token is invalid" });
    const client = new HubSpotClient({ accessToken: "bad", fetchImpl });

    await expect(client.get("contacts", "1")).rejects.toMatchObject({
      status: 401,
      message: "This access token is invalid",
    });
    await expect(client.get("contacts", "1")).rejects.toBeInstanceOf(HubSpotApiError);
  });

  it("associate() PUTs to the v4 default-association endpoint with no body", async () => {
    const fetchImpl = mockFetchJson(200, {});
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    await client.associate("deals", "5", "contacts", "9");

    const [url, init] = (fetchImpl as ReturnType<typeof mockFetchJson> & { mock: any }).mock.calls[0];
    expect(url).toContain("/crm/v4/objects/deals/5/associations/default/contacts/9");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeUndefined();
  });

  it("propagates a failed association as a HubSpotApiError", async () => {
    const fetchImpl = mockFetchSequence([{ status: 404, body: { message: "no such contact" } }]);
    const client = new HubSpotClient({ accessToken: "t", fetchImpl });

    await expect(client.associate("deals", "5", "contacts", "999")).rejects.toThrow(/associate/i);
  });
});
