import { vi } from "vitest";

/**
 * A minimal mock of the global `fetch` shape, matched against HubSpot's REST
 * responses closely enough to exercise HubSpotClient's parsing logic without
 * ever hitting the network or requiring a real access token.
 */
export function mockFetchJson(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
}

export function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  }) as unknown as typeof fetch;
}
