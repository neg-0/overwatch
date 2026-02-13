/**
 * UDL ELSET query — final working version
 * Usage: npx tsx scripts/test-udl.ts
 */
import 'dotenv/config';

const UDL_BASE = 'https://unifieddatalibrary.com/udl';
const username = process.env.UDL_USERNAME!;
const password = process.env.UDL_PASSWORD!;
const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

const headers = {
  Authorization: `Basic ${basicAuth}`,
  Accept: 'application/json',
};

async function fetchJson(path: string) {
  const url = `${UDL_BASE}${path}`;
  console.log(`→ GET ${url}\n`);
  const res = await fetch(url, { headers });
  console.log(`← ${res.status} ${res.statusText}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  // 1. Get query help to understand parameters
  console.log('═══ ELSET Query Help ═══\n');
  const help = await fetchJson('/elset/queryhelp');
  console.log('\n', JSON.stringify(help, null, 2).slice(0, 3000));

  // 2. Query ELSET with correct ISO epoch interval
  console.log('\n\n═══ ELSET for GPS III SV01 (NORAD 48859) ═══\n');
  const gps = await fetchJson('/elset?satNo=48859&epoch=2026-02-11T00:00:00Z/2026-02-13T00:00:00Z');
  if (Array.isArray(gps)) {
    console.log(`\n✅ ${gps.length} results returned. First:\n`);
    console.log(JSON.stringify(gps[0], null, 2));
  } else {
    console.log('\n', JSON.stringify(gps, null, 2).slice(0, 2000));
  }

  // 3. Try current elset endpoint
  console.log('\n\n═══ ELSET Current ═══\n');
  const current = await fetchJson('/elset/current?satNo=48859');
  if (Array.isArray(current)) {
    console.log(`\n✅ ${current.length} results. First:\n`);
    console.log(JSON.stringify(current[0], null, 2));
  } else {
    console.log('\n', JSON.stringify(current, null, 2).slice(0, 2000));
  }
}

main().catch(console.error);
