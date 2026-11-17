import { chromium } from "playwright";

import { collectWithFailover } from "./failover.js";

const required = ["RASTRO_USER", "RASTRO_PASSWORD", "WORKER_URL", "ME_TOWER_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Secret ausente: ${key}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const selected = await collectWithFailover(async (origin) => {
    const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    context.setDefaultTimeout(30000);
    const page = await context.newPage();
    const LOGIN_URL = `${origin}/apps/loginApp.seam`;
    try {
      let authenticated = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const loginResponse = await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        if (!loginResponse?.ok()) throw new Error("login_http_error");
        await page.locator('input[name$=":username"]').fill(process.env.RASTRO_USER);
        await page.locator('input[name$=":pass"]').fill(process.env.RASTRO_PASSWORD);
        await page.locator('input[name$=":logarPortal"]').click();
        await page.waitForTimeout(7000);

        const afterLoginTitle = await page.title();
        const afterLoginUrl = page.url();
        const stillOnLogin = /login/i.test(afterLoginTitle) || /loginApp\.seam/i.test(afterLoginUrl);
        console.log(`Login RastroSeguro — tentativa ${attempt}/2: ${stillOnLogin ? "não autenticou" : "autenticado"}`);

        if (!stillOnLogin) {
          authenticated = true;
          break;
        }

        if (attempt < 2) {
          console.warn("Primeira tentativa de login falhou. Nova tentativa automática em 3 segundos.");
          await page.waitForTimeout(3000);
        }
      }

      if (!authenticated) {
        throw new Error("O Rastro Seguro permaneceu na tela de login após 2 tentativas. Verifique as credenciais ou eventual bloqueio do portal.");
      }

      const label=origin.includes(".1gps.")?"1GPS":"2GPS";
      async function readMarkerFleet(mapPage) {
        await mapPage.waitForFunction(()=>document.querySelectorAll('.leaflet-marker-icon').length>=250,undefined,{timeout:25000}).catch(()=>{});
        const markers=mapPage.locator('.leaflet-marker-icon');
        const names=[...new Set((await markers.allTextContents()).map(v=>v.trim()).filter(v=>/\b[A-Z]{3}\d[A-Z0-9]\d{2}$/i.test(v)))];
        if(names.length<250){console.warn(`[${label}] marcadores: ${names.length} identificados; mínimo: 250.`);return null;}
        const fleet=new Map(), deadline=Date.now()+100000;
        for(const name of names){
          if(Date.now()>=deadline)break;
          try {
            await markers.filter({hasText:name}).first().dispatchEvent('click',{}, {timeout:350});
            const popup=mapPage.locator('.leaflet-popup-content').filter({hasText:name}).first();
            const vehicle=parseMarkerPopup(await popup.innerText({timeout:450}),name);
            if(vehicle)fleet.set(vehicle.plate,vehicle);
          } catch { /* A marker may disappear as the tracker refreshes. */ }
        }
        console.log(`[${label}] marcadores: ${names.length} identificados; ${fleet.size} posições válidas.`);
        return fleet.size>=250?[...fleet.values()]:null;
      }
      const response=await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:30000});
      const login=/loginApp\.(?:seam|html)/i.test(new URL(page.url()).pathname);
      console.log("["+label+"] visão geral: HTTP "+(response?.status()??"sem resposta")+"; retorno ao login: "+(login?"sim":"não")+".");
      if(!response?.ok()||login)throw new Error("map_http_or_login_error");
      const fleet=await readMarkerFleet(page);
      if(!fleet)throw new Error("incomplete_fleet");
      return fleet;
    } finally { await context.close(); }
  });
  const { vehicles, source, contingency } = selected;
  const payload = { collectedAt: new Date().toISOString(), vehicles, source, contingency };
  const response = await fetch(`${process.env.WORKER_URL.replace(/\/$/, "")}/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.ME_TOWER_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`Worker ${response.status}: ${result}`);
  console.log(`Coleta concluída: ${vehicles.length} veículos. ${result}`);
} finally {
  await browser.close();
}

function toIso(brDate) {
  const m = brDate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00` : brDate;
}


function parseMarkerPopup(text,name){
  const plate=name.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2})$/i)?.[1]?.toUpperCase();
  const shown=text.match(/Veículo:\s*([^\n]+)/i)?.[1]?.trim();
  const date=text.match(/Data Posição:\s*(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})/i)?.[1];
  const coords=text.match(/Lat\s*\/\s*Long\s*:\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)/i);
  if(!plate||shown!==name||!date||!coords)return null;
  const positionAt=toIso(date),latitude=Number(coords[1]),longitude=Number(coords[2]);
  if(!Number.isFinite(Date.parse(positionAt))||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))return null;
  return {plate,fleetNumber:name.match(/^\d{4,6}(?=\s)/)?.[0]||plate,trackerName:name,
    trackerId:text.match(/Dispositivo:\s*(\d+)/i)?.[1]||null,positionAt,latitude,longitude,
    speed:Number(text.match(/Velocidade:\s*(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',','.'))||0,
    event:text.match(/(?:^|\n)Evento:\s*([^\n]+)/i)?.[1]?.trim()||'',
    currentLocation:text.match(/Localização:\s*([^\n]+)/i)?.[1]?.trim()||'SEM LOCALIZAÇÃO'};
}
