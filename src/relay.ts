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
  // cf_clearance SENGAJA gak di-inject: kebind ke IP lain -> bikin CF curiga.
  // Biarin browser generate sendiri pas lewatin challenge.
  if (items.length) {
    await page.setCookie(...items);
    log(`set ${items.length} cookie login (tanpa cf_clearance)`);
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

/** Tunggu challenge kelar SENDIRI (gak reload). CF auto-navigate pas solved. */
async function waitForChallengeClear(page: Page, maxMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 3000));
    if (!(await isChallenge(page))) return true;
  }
  return false;
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

/** 1x poll. */
async function pollOnce(page: Page): Promise<void> {
  if (await isChallenge(page)) {
    log("challenge CF kedeteksi - nunggu browser solve (gak reload)...");
    const cleared = await waitForChallengeClear(page, 30000);
    if (cleared) {
      log("challenge kelar, lanjut polling.");
    } else {
      log("challenge belum kelar 30s - reload sekali, coba lagi.");
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    }
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

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--window-size=1280,800",
  ];
  if (config.proxy.server) {
    launchArgs.push(`--proxy-server=${config.proxy.server}`);
    log(`pakai proxy: ${config.proxy.server}`);
  }

  const browser: Browser = await puppeteer.launch({
    headless: config.headless,
    executablePath: config.chromePath,
    userDataDir: config.userDataDir,
    args: launchArgs,
  });

  const page = await browser.newPage();
  if (config.proxy.user) {
    await page.authenticate({ username: config.proxy.user, password: config.proxy.pass });
  }
  await page.setViewport({ width: 1280, height: 800 });
  await applyCookies(page);
  log("navigate ke target (nunggu challenge kelar dulu)...");
  await page.goto(config.targetBase, { waitUntil: "networkidle2", timeout: 90000 }).catch((e) => {
    log("goto error:", (e as Error).message);
  });
  // Kasih waktu challenge awal kelar sebelum mulai polling.
  if (await isChallenge(page)) {
    log("challenge awal - nunggu solve...");
    const ok = await waitForChallengeClear(page, 40000);
    log(ok ? "challenge awal kelar." : "challenge awal belum kelar 40s (IP mungkin di-throttle).");
  }

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