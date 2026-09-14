/**
 * Thin wrapper around HubSpot's CRM REST API (v3), authenticated with a
 * private-app access token. Deliberately dependency-light (no HubSpot SDK):
 * plain fetch calls against documented, stable v3 endpoints, which keeps the
 * surface easy to read, mock in tests, and swap in a different fetch
 * implementation (Node's global fetch by default).
 *
 * Docs: https://developers.hubspot.com/docs/api/crm/understanding-the-crm
 */

const HUBSPOT_API_BASE = "https://api.hubapi.com";

export type CrmObjectType = "contacts" | "deals" | "tickets" | "companies";

export interface HubSpotObject {
  id: string;
  properties: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchFilter {
  propertyName: string;
  operator:
    | "EQ" | "NEQ" | "LT" | "LTE" | "GT" | "GTE"
    | "CONTAINS_TOKEN" | "NOT_CONTAINS_TOKEN" | "HAS_PROPERTY" | "NOT_HAS_PROPERTY";
  value?: string;
}

export interface SearchResult {
  total: number;
  results: HubSpotObject[];
}

export class HubSpotApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "HubSpotApiError";
  }
}

export interface HubSpotClientOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class HubSpotClient {
  private accessToken: string;
  private fetchImpl: typeof fetch;
  private baseUrl: string;

  constructor(opts: HubSpotClientOptions) {
    if (!opts.accessToken) {
      throw new Error(
        "HubSpot access token is required. Set HUBSPOT_ACCESS_TOKEN, or pass accessToken explicitly.",
      );
    }
    this.accessToken = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? HUBSPOT_API_BASE;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await res.json();
      } catch {
        parsedBody = await res.text();
      }
      const message =
        typeof parsedBody === "object" && parsedBody && "message" in parsedBody
          ? String((parsedBody as { message: unknown }).message)
          : `HubSpot API request failed with status ${res.status}`;
      throw new HubSpotApiError(res.status, parsedBody, message);
    }

    return (await res.json()) as T;
  }

  /** List objects of a given type, most-recently-updated first. */
  async list(
    objectType: CrmObjectType,
    opts: { properties?: string[]; limit?: number } = {},
  ): Promise<SearchResult> {
    const limit = opts.limit ?? 10;
    const props = (opts.properties ?? []).join(",");
    const qs = new URLSearchParams({ limit: String(limit) });
    if (props) qs.set("properties", props);
    const data = await this.request<{ results: HubSpotObject[] }>(
      "GET",
      `/crm/v3/objects/${objectType}?${qs.toString()}`,
    );
    return { total: data.results.length, results: data.results };
  }

  /** Get a single object by ID. */
  async get(
    objectType: CrmObjectType,
    id: string,
    properties: string[] = [],
  ): Promise<HubSpotObject> {
    const qs = properties.length ? `?properties=${properties.join(",")}` : "";
    return this.request<HubSpotObject>("GET", `/crm/v3/objects/${objectType}/${id}${qs}`);
  }

  /** Search objects with filters (AND-combined within one filter group). */
  async search(
    objectType: CrmObjectType,
    opts: { filters?: SearchFilter[]; query?: string; properties?: string[]; limit?: number },
  ): Promise<SearchResult> {
    const body: Record<string, unknown> = {
      limit: opts.limit ?? 10,
      properties: opts.properties ?? [],
    };
    if (opts.filters?.length) {
      body.filterGroups = [{ filters: opts.filters }];
    }
    if (opts.query) {
      body.query = opts.query;
    }
    return this.request<SearchResult>("POST", `/crm/v3/objects/${objectType}/search`, body);
  }

  /** Create a new object. */
  async create(
    objectType: CrmObjectType,
    properties: Record<string, string | number>,
  ): Promise<HubSpotObject> {
    return this.request<HubSpotObject>("POST", `/crm/v3/objects/${objectType}`, { properties });
  }

  /** Update (PATCH) an existing object's properties. */
  async update(
    objectType: CrmObjectType,
    id: string,
    properties: Record<string, string | number>,
  ): Promise<HubSpotObject> {
    return this.request<HubSpotObject>("PATCH", `/crm/v3/objects/${objectType}/${id}`, {
      properties,
    });
  }

  /** List the IDs of objects associated with a given object (e.g. a contact's deals). */
  async listAssociations(
    fromObjectType: CrmObjectType,
    id: string,
    toObjectType: CrmObjectType,
  ): Promise<string[]> {
    try {
      const data = await this.request<{ results: { toObjectId: string }[] }>(
        "GET",
        `/crm/v3/objects/${fromObjectType}/${id}/associations/${toObjectType}`,
      );
      return data.results.map((r) => r.toObjectId);
    } catch (err) {
      if (err instanceof HubSpotApiError && err.status === 404) return [];
      throw err;
    }
  }

  /**
   * Create the default association between two objects (e.g. link a deal to
   * a contact). Uses the v4 "default association" endpoint, which needs no
   * request body — HubSpot infers the standard association type for the
   * object-type pair.
   */
  async associate(
    fromObjectType: CrmObjectType,
    fromId: string,
    toObjectType: CrmObjectType,
    toId: string,
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/crm/v4/objects/${fromObjectType}/${fromId}/associations/default/${toObjectType}/${toId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );
    if (!res.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await res.json();
      } catch {
        parsedBody = await res.text();
      }
      throw new HubSpotApiError(
        res.status,
        parsedBody,
        `Failed to associate ${fromObjectType}/${fromId} with ${toObjectType}/${toId}`,
      );
    }
  }
}

export function hubspotClientFromEnv(fetchImpl?: typeof fetch): HubSpotClient {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN is not set. Create a private app in your HubSpot account " +
        "(Settings -> Integrations -> Private Apps) and export its access token.",
    );
  }
  return new HubSpotClient({ accessToken, fetchImpl });
}
