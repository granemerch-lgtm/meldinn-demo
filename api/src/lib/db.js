/* Lagring: Azure Table Storage (saker, innstillinger, brukere) + Blob Storage (bilder).
   Krever app-innstillingen STORAGE_CONNECTION. */
const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const C = require("./meldinn-core.js");
const CONN = process.env.STORAGE_CONNECTION;
const tables = {}; let blobs = null, ready = null;
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
  if (!ready) ready = Promise.all(["cases", "settings", "users"].map(n => table(n).createTable().catch(ignore409)).concat(container().createIfNotExists()))
    .catch(e => { ready = null; throw e; });
  return ready;
}
async function all(name, pk) { await init(); const out = []; for await (const e of table(name).listEntities({ queryOptions: { filter: `PartitionKey eq '${pk}'` } })) out.push(JSON.parse(e.data)); return out; }
async function one(name, pk, rk) { await init(); try { return JSON.parse((await table(name).getEntity(pk, rk)).data); } catch (e) { if (e.statusCode === 404) return null; throw e; } }
async function put(name, pk, rk, obj) { await init(); await table(name).upsertEntity({ partitionKey: pk, rowKey: rk, data: JSON.stringify(obj) }, "Replace"); return obj; }

const listCases = async () => (await all("cases", "case")).sort((a, b) => b.created.localeCompare(a.created));
async function getCase(id) { const c = await one("cases", "case", id); if (!c) throw fail("Fant ikke saken", 404); return c; }
const saveCase = c => put("cases", "case", c.id, c);
async function getSettings() { return C.normalizeSettings(await one("settings", "cfg", "main")); }
async function saveSettings(s) { const clean = C.normalizeSettings(s); await put("settings", "cfg", "main", clean); return clean; }

const listUsers = () => all("users", "user");
const getUser = un => one("users", "user", un);
const saveUser = u => put("users", "user", u.username, u);
async function deleteUser(un) { await init(); try { await table("users").deleteEntity("user", un); } catch (e) { if (e.statusCode !== 404) throw e; } }

// Fortløpende saksnummer per prefiks med optimistisk låsing
async function nextId(prefix) {
  await init(); const t = table("settings"), row = "counter-" + prefix;
  for (let i = 0; i < 8; i++) {
    let e;
    try { e = await t.getEntity("cfg", row); }
    catch (err) { if (err.statusCode !== 404) throw err;
      const existing = (await listCases()).filter(c => c.id.startsWith(prefix + "-")).map(c => +c.id.split("-")[1] || 0);
      try { await t.createEntity({ partitionKey: "cfg", rowKey: row, n: Math.max(1000, ...existing) }); } catch (x) { ignore409(x); }
      continue; }
    const n = Number(e.n) + 1;
    try { await t.updateEntity({ partitionKey: "cfg", rowKey: row, n }, "Replace", { etag: e.etag }); return prefix + "-" + n; }
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
  await init(); const b = container().getBlockBlobClient(`${id}-${kind}`);
  try { const p = await b.getProperties(); return { buffer: await b.downloadToBuffer(), contentType: p.contentType || "image/jpeg" }; }
  catch (e) { if (e.statusCode === 404) throw fail("Bilde finnes ikke", 404); throw e; }
}
module.exports = { listCases, getCase, saveCase, getSettings, saveSettings, nextId, putPhoto, getPhoto, listUsers, getUser, saveUser, deleteUser };
