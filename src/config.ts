import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} wajib diisi`);
  return v;
}

export const config = {
  targetBase: (process.env.TARGET_BASE ?? "https://ditznesia.com").replace(/\/$/, ""),
  infoOrderPath: process.env.INFO_ORDER_PATH ?? "/orderv3?nomor=&status=Sukses&limit=100&page=1&action=infoOrder",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),

  cookies: {
    phpsessid: process.env.MARS_PHPSESSID ?? "",
    userId: process.env.MARS_USER_ID ?? "",
    expiresAt: process.env.MARS_EXPIRES_AT ?? "",
    cfClearance: process.env.MARS_CF_CLEARANCE ?? "",
  },

  ingestUrl: req("INGEST_URL"),
  ingestSecret: req("INGEST_SECRET"),

  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",
  chromePath: process.env.CHROME_PATH || undefined,

  // Residential/mobile proxy (biar dapet IP fast-lane, bukan datacenter).
  // Contoh: PROXY_SERVER=http://gate.provider.com:8000
  proxy: {
    server: process.env.PROXY_SERVER || "",
    user: process.env.PROXY_USER || "",
    pass: process.env.PROXY_PASS || "",
  },
} as const;