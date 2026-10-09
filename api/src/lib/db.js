/* Lagring: Azure Table Storage (saker/innstillinger) + Blob Storage (bilder).
   Krever app-innstillingen STORAGE_CONNECTION (connection string til Storage-kontoen). */
const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const C = require("./meldinn-core.js");

const CONN = process.env.STORAGE_CONNECTION;
const tables = {};
let blobs = null, ready = null;

function fail(msg, status) { const e = new Error(msg); e.status = status; return e; }
function table(name) {
  if (!CONN) throw fail("STORAGE_CONNECTION er ikke satt i Azure (Environment variables)", 503);
  return tables[name] || (tables[name] = TableClient.fromConnectionString(CONN, name));
}
function container() {
  if (!CONN) throw fail("STORAGE_CONNECTION er ikke satt i Azure (Environment variables)", 503);
  return blobs || (blobs = BlobServiceClient.fromConnectionString(CONN).getContainerClient("photos"));
}
const ignore409 = e => { if (e.statusCode !== 409) throw e; };
async function init() {
  if (!ready) ready = Promise.all([
    table("cases").createTable().catch(ignore409),
    table("settings").createTable().catch(ignore409),
    container().createIfNotExists()
  ]).catch(e => { ready = null; throw e; });
  return ready;
}

async function listCases() {
  await init();
  const out = [];
  for await (const e of table("cases").listEntities({ queryOptions: { filter: "PartitionKey eq 'case'" } })) out.push(JSON.parse(e.data));
  return out.sort((a, b) => b.created.localeCompare(a.created));
}
async function getCase(id) {
  await init();
  try { return JSON.parse((await table("cases").getEntity("case", id)).data); }
  catch (e) { if (e.statusCode === 404) throw fail("Fant ikke saken", 404); throw e; }
}
async function saveCase(c) {
  await init();
  await table("cases").upsertEntity({ partitionKey: "case", rowKey: c.id, data: JSON.stringify(c) }, "Replace");
  return c;
}
async function getSettings() {
  await init();
  try { return C.merge(C.DEFAULT_SETTINGS, JSON.parse((await table("settings").getEntity("cfg", "main")).data)); }
  catch (e) { if (e.statusCode === 404) return C.clone(C.DEFAULT_SETTINGS); throw e; }
}
async function saveSettings(s) {
  await init();
  const clean = C.merge(C.DEFAULT_SETTINGS, s);
  await table("settings").upsertEntity({ partitionKey: "cfg", rowKey: "main", data: JSON.stringify(clean) }, "Replace");
  return clean;
}
// Fortløpende saksnummer med optimistisk låsing (etag)
async function nextId() {
  await init();
  const t = table("settings");
  for (let i = 0; i < 8; i++) {
    let e;
    try { e = await t.getEntity("cfg", "counter"); }
    catch (err) {
      if (err.statusCode !== 404) throw err;
      try { await t.createEntity({ partitionKey: "cfg", rowKey: "counter", n: 1046 }); } catch (x) { ignore409(x); }
      continue;
    }
    const n = Number(e.n) + 1;
    try { await t.updateEntity({ partitionKey: "cfg", rowKey: "counter", n }, "Replace", { etag: e.etag }); return "SK-" + n; }
    catch (err) { if (err.statusCode !== 412) throw err; }
  }
  throw fail("Kunne ikke tildele saksnummer, prøv igjen", 503);
}
async function putPhoto(id, kind, dataUrl) {
  await init();
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw fail("Ugyldig bildeformat", 400);
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 3 * 1024 * 1024) throw fail("Bildet er for stort (maks 3 MB)", 413);
  await container().getBlockBlobClient(`${id}-${kind}`).uploadData(buf, { blobHTTPHeaders: { blobContentType: m[1] } });
}
async function getPhoto(id, kind) {
  await init();
  const b = container().getBlockBlobClient(`${id}-${kind}`);
  try { const p = await b.getProperties(); return { buffer: await b.downloadToBuffer(), contentType: p.contentType || "image/jpeg" }; }
  catch (e) { if (e.statusCode === 404) throw fail("Bilde finnes ikke", 404); throw e; }
}

module.exports = { listCases, getCase, saveCase, getSettings, saveSettings, nextId, putPhoto, getPhoto };
