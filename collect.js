import { chromium } from "playwright";

const LOGIN_URL = "https://rastroseguro.1gps.com.br/apps/loginApp.seam";
const MAP_URL = "https://rastroseguro.1gps.com.br/system/track/mapSimpleCar.seam";

const required = ["RASTRO_USER", "RASTRO_PASSWORD", "WORKER_URL", "ME_TOWER_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Secret ausente: ${key}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await context.newPage();

try {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[name$=":username"]').fill(process.env.RASTRO_USER);
  await page.locator('input[name$=":pass"]').fill(process.env.RASTRO_PASSWORD);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}),
    page.locator('input[name$=":logarPortal"]').click(),
  ]);

  await page.goto(MAP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => document.documentElement.innerHTML.includes("registerCar("),
    undefined,
    { timeout: 60000 }
  );

  const html = await page.content();
  const vehicles = parseVehicles(html);
  if (vehicles.length < 250) {
    throw new Error(`Frota incompleta: ${vehicles.length}; título: ${await page.title()}; URL: ${page.url()}`);
  }

  const payload = { collectedAt: new Date().toISOString(), vehicles };
  const response = await fetch(`${process.env.WORKER_URL.replace(/\/$/, "")}/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.ME_TOWER_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`Worker ${response.status}: ${result}`);
  console.log(`Coleta concluída: ${vehicles.length} veículos. ${result}`);
} finally {
  await browser.close();
}

function parseVehicles(html) {
  return extractCalls(html, "registerCar").map(splitArgs).filter((a) => a.length > 11).map((a) => {
    const trackerName = value(a[1]);
    const parts = trackerName.trim().split(/\s+/);
    const plate = parts.at(-1) || trackerName;
    return {
      fleetNumber: /^\d{4,6}$/.test(parts[0] || "") ? parts[0] : plate,
      plate,
      trackerName,
      trackerId: value(a[11]),
      positionAt: toIso(value(a[2])),
      ignition: value(a[3]).includes("key_ok"),
      speed: Number(value(a[4])) || 0,
      event: value(a[5]),
      currentLocation: value(a[6]) || "SEM LOCALIZAÇÃO",
      latitude: Number(value(a[8])),
      longitude: Number(value(a[9])),
    };
  });
}

function extractCalls(source, name) {
  const out = [], needle = `${name}(`;
  let pos = 0;
  while ((pos = source.indexOf(needle, pos)) >= 0) {
    let i = pos + needle.length, depth = 1, quote = "", escaped = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    if (depth === 0) out.push(source.slice(pos + needle.length, i));
    pos = i + 1;
  }
  return out;
}

function splitArgs(call) {
  const args = []; let current = "", quote = "", escaped = false, depth = 0;
  for (const ch of call) {
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) { args.push(current.trim()); current = ""; }
    else current += ch;
  }
  args.push(current.trim());
  return args;
}

function value(raw = "") {
  const text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  }
  return text;
}

function toIso(brDate) {
  const m = brDate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00` : brDate;
}
