import type { HubSpotObject } from "./hubspotClient.js";

/** Wrap plain text in the MCP tool-result content shape. */
export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Render a HubSpot object's properties as a readable key: value block. */
export function formatObject(label: string, obj: HubSpotObject): string {
  const lines = Object.entries(obj.properties)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `  ${k}: ${v}`);
  return `${label} [${obj.id}]\n${lines.join("\n")}`;
}

/** Format a currency amount (HubSpot stores amounts as plain numeric strings). */
export function formatAmount(raw: string | null | undefined, currency = "USD"): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toLocaleString()}`;
  }
}
