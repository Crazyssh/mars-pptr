import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { config } from "./config.js";

puppeteer.use(StealthPlugin());

const HOST = new URL(config.targetBase).hostname; // ditznesia.com

function log(...a: unknown[]) {
  console.log(`[pptr-relay] ${new Date().toISOString()}`, ...a);
}

/** Set cookie login ke domain ditznesia sebelum navigate. */
async function applyCookies(page: Page) {
  const c = config.cookies;
  const items: { name: string; value: string; domain: string; path: string }[] = [];
  const push = (name: string, value: string) => {
    if (value) items.push({ name, value, domain: HOST, path: "/" });
  };
  push("PHPSESSID", c.phpsessid);
  push("user_id", c.userId);
  push("expires_at", c.expiresAt);
  push("cf_clearance", c.cfClearance);
  if (items.length) {
    await page.setCookie(...items);
    log(`set ${items.length} cookie`);
  }
}

/** True kalau halaman lagi nampilin challenge Cloudflare. */
async function isChallenge(page: Page): Promise<boolean> {
  try {
    const title = (await page.title()).toLowerCase();
    if (title.includes("just a moment") || title.includes("attention required")) return true;
    const body = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
    return (
      body.includes("performing security verification") ||
      body.includes("verifies you are not a bot") ||
      body.includes("checking if the site connection is secure")
    );
  } catch {
    return false;
  }
}

/** Push array order ke Mars ingest. */
async function pushToIngest(orders: unknown[]): Promise<void> {
  try {
    const res = await fetch(config.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ingest-Secret": config.ingestSecret },
      body: JSON.stringify({ orders }),
    });
    const txt = await res.text();
    if (res.ok) log(`relay OK (${orders.length} orders)`, txt.slice(0, 120));
    else log(`relay gagal HTTP ${res.status}`, txt.slice(0, 120));
  } catch (e) {
    log("relay error:", (e as Error).message);
  }
}

/** 1x poll: fetch infoOrder dari konteks browser (pakai cookie + cf_clearance browser). */
async function pollOnce(page: Page): Promise<void> {
  if (await isChallenge(page)) {
    log("challenge Cloudflare kedeteksi - reload, nunggu browser solve...");
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 6000));
    return;
  }

  const result = await page.evaluate(async (path: string) => {
    try {
      const r = await fetch(path, {
        headers: { "x-requested-with": "XMLHttpRequest" },
        credentials: "include",
      });
      const text = await r.text();
      return { status: r.status, text };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  }, config.infoOrderPath);

  if (result.status !== 200) {
    log(`fetch HTTP ${result.status}`);
    if (result.status === 403 || result.status === 503) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
    return;
  }

  let orders: unknown;
  try {
    orders = JSON.parse(result.text);
  } catch {
    log("respons bukan JSON (cookie expired / challenge?)");
    return;
  }
  if (!Array.isArray(orders)) {
    log("respons bukan array");
    return;
  }
  await pushToIngest(orders);
}

export async function runRelay(): Promise<void> {
  log(`start - target ${config.targetBase}, interval ${config.pollIntervalMs}ms, headless=${config.headless}`);

  const browser: Browser = await puppeteer.launch({
    headless: config.headless,
    executablePath: config.chromePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  const page = await browser.newPage();
  await applyCookies(page);
  log("navigate ke target...");
  await page.goto(config.targetBase, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => {
    log("goto error:", (e as Error).message);
  });

  // Loop polling fixed-interval (gak overlap - Puppeteer 1 page = sequential).
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const t0 = Date.now();
      try {
        await pollOnce(page);
      } catch (e) {
        log("pollOnce error:", (e as Error).message);
      }
      const elapsed = Date.now() - t0;
      const wait = Math.max(0, config.pollIntervalMs - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  };

  const shutdown = async () => {
    stopped = true;
    log("shutdown...");
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await loop();
}
