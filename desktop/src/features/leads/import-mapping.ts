/** Spreadsheet column -> lead field mapping, and turning sheet rows into import rows. */

export type ImportField =
  | "business_name" | "industry" | "category" | "market" | "country" | "region" | "city" | "address"
  | "website_url" | "facebook_url" | "instagram_url" | "linkedin_url" | "google_maps_url" | "business_phone"
  | "business_email" | "contact_name" | "contact_position" | "contact_email" | "contact_phone" | "source_name"
  | "source_detail" | "stage_name" | "priority" | "potential_services" | "estimated_value" | "currency"
  | "research_notes" | "next_action";

export const IMPORT_FIELDS: { field: ImportField; label: string; group: string; synonyms: string[] }[] = [
  { field: "business_name", label: "Business name", group: "Business", synonyms: ["business name", "business", "company", "company name", "name", "establishment", "store", "shop", "brand"] },
  { field: "industry", label: "Industry", group: "Business", synonyms: ["industry", "sector", "niche"] },
  { field: "category", label: "Category", group: "Business", synonyms: ["category", "type", "business type"] },
  { field: "market", label: "Market (local / international)", group: "Business", synonyms: ["market", "local international"] },
  { field: "country", label: "Country", group: "Location", synonyms: ["country", "nation"] },
  { field: "region", label: "Region / state", group: "Location", synonyms: ["region", "state", "province"] },
  { field: "city", label: "City / municipality", group: "Location", synonyms: ["city", "municipality", "town"] },
  { field: "address", label: "Full address", group: "Location", synonyms: ["address", "full address", "location", "street"] },
  { field: "website_url", label: "Website", group: "Online", synonyms: ["website", "site", "url", "web", "website url"] },
  { field: "facebook_url", label: "Facebook", group: "Online", synonyms: ["facebook", "fb", "facebook page", "facebook url"] },
  { field: "instagram_url", label: "Instagram", group: "Online", synonyms: ["instagram", "ig"] },
  { field: "linkedin_url", label: "LinkedIn", group: "Online", synonyms: ["linkedin"] },
  { field: "google_maps_url", label: "Google Maps link", group: "Online", synonyms: ["google maps", "maps", "map link", "gmaps"] },
  { field: "business_phone", label: "Business phone", group: "Contact", synonyms: ["phone", "phone number", "business phone", "telephone", "tel", "mobile", "landline"] },
  { field: "business_email", label: "Business email", group: "Contact", synonyms: ["email", "business email", "e mail", "email address"] },
  { field: "contact_name", label: "Contact person", group: "Contact", synonyms: ["contact person", "contact", "contact name", "owner", "owner name", "person"] },
  { field: "contact_position", label: "Contact position", group: "Contact", synonyms: ["position", "title", "role", "designation", "job title"] },
  { field: "contact_email", label: "Contact email", group: "Contact", synonyms: ["contact email", "owner email"] },
  { field: "contact_phone", label: "Contact phone", group: "Contact", synonyms: ["contact phone", "contact number", "owner phone", "cellphone"] },
  { field: "source_name", label: "Lead source", group: "Sales", synonyms: ["source", "lead source", "found on", "found via"] },
  { field: "source_detail", label: "Source details", group: "Sales", synonyms: ["source details", "search term", "keyword"] },
  { field: "stage_name", label: "Pipeline stage", group: "Sales", synonyms: ["stage", "pipeline stage", "lead stage"] },
  { field: "priority", label: "Priority", group: "Sales", synonyms: ["priority"] },
  { field: "potential_services", label: "Potential services", group: "Sales", synonyms: ["services", "potential services", "service", "needs"] },
  { field: "estimated_value", label: "Estimated value", group: "Sales", synonyms: ["value", "deal value", "estimated value", "budget", "amount"] },
  { field: "currency", label: "Currency", group: "Sales", synonyms: ["currency"] },
  { field: "research_notes", label: "Notes", group: "Sales", synonyms: ["notes", "remarks", "comments", "research notes", "observations"] },
  { field: "next_action", label: "Next action", group: "Sales", synonyms: ["next action", "next step", "to do"] },
];

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best guess of which spreadsheet column feeds each field. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  const norm = headers.map(simplify);
  // Exact matches first, then "header contains synonym".
  for (const pass of ["exact", "contains"] as const) {
    for (const f of IMPORT_FIELDS) {
      if (mapping[f.field] !== undefined) continue;
      const idx = norm.findIndex(
        (h, i) => !used.has(i) && f.synonyms.some((s) => (pass === "exact" ? h === s : h.includes(s) && s.length >= 4)),
      );
      if (idx >= 0) {
        mapping[f.field] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

export type MarketDefault = "local" | "international" | "infer";

const PH = new Set(["philippines", "ph", "phl", "pilipinas"]);

function parseMarket(raw: string, country: string, fallback: MarketDefault): "local" | "international" {
  const v = simplify(raw);
  if (["local", "ph", "philippines", "domestic"].includes(v)) return "local";
  if (["international", "intl", "foreign", "overseas", "abroad"].includes(v)) return "international";
  if (fallback === "infer") return !country || PH.has(simplify(country)) ? "local" : "international";
  return fallback;
}

function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

/** One sheet row -> the JSON row the API expects. */
export function buildRow(
  row: string[],
  mapping: Partial<Record<ImportField, number>>,
  marketDefault: MarketDefault,
): Record<string, unknown> {
  const get = (f: ImportField) => {
    const i = mapping[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const out: Record<string, unknown> = {};
  for (const { field } of IMPORT_FIELDS) {
    const v = get(field);
    if (!v) continue;
    switch (field) {
      case "market":
        break;
      case "estimated_value": {
        const amount = parseAmount(v);
        if (amount) out.estimated_value = amount;
        break;
      }
      case "potential_services":
        out.potential_services = v.split(/[,;|/]/).map((s) => s.trim()).filter(Boolean);
        break;
      case "priority": {
        const p = v.toLowerCase();
        if (["low", "medium", "high", "urgent"].includes(p)) out.priority = p;
        break;
      }
      case "currency":
        if (/^[a-z]{3}$/i.test(v)) out.currency = v.toUpperCase();
        else if (v.includes("₱")) out.currency = "PHP";
        else if (v.includes("$")) out.currency = "USD";
        break;
      default:
        out[field] = v;
    }
  }
  out.business_name = get("business_name");
  out.market = parseMarket(get("market"), get("country"), marketDefault);
  if (!out.currency && out.estimated_value) out.currency = out.market === "local" ? "PHP" : "USD";
  return out;
}
