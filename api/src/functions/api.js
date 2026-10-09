/* MeldInn API
   /api/public/*  – åpent for innbyggere, data filtreres etter kommunens synlighetsvalg
   /api/manage/*  – kun rollen "kommune" (beskyttet i staticwebapp.config.json + sjekk her)
   /api/photo/*   – bilder, styrt av synlighetsvalg (kommunen ser alltid) */
const { app } = require("@azure/functions");
const C = require("../lib/meldinn-core.js");
const db = require("../lib/db.js");

function principal(req) {
  const h = req.headers.get("x-ms-client-principal");
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch (e) { return null; }
}
const isAdmin = req => { const p = principal(req); return !!p && (p.userRoles || []).includes("kommune"); };
const actor = req => { const p = principal(req); return (p && p.userDetails) || "Kommune"; };
const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();

function route(name, methods, path, handler, adminOnly) {
  app.http(name, {
    methods, authLevel: "anonymous", route: path,
    handler: async (req, ctx) => {
      try {
        if (adminOnly && !isAdmin(req)) return json(403, { error: "Ingen tilgang" });
        return await handler(req, ctx);
      } catch (e) {
        if (!e.status || e.status >= 500) ctx.error(e);
        return json(e.status || 500, { error: e.message || "Serverfeil" });
      }
    }
  });
}

/* ---------- Innbygger ---------- */
route("publicSettings", ["GET"], "public/settings", async () => json(200, C.publicSettings(await db.getSettings())));

route("publicCases", ["GET", "POST"], "public/cases", async (req) => {
  const s = await db.getSettings();
  if (req.method === "GET") {
    const ids = (req.query.get("ids") || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 100);
    const all = await db.listCases(), t = Date.now();
    const list = ids.length ? all.filter(c => ids.includes(c.id)) : all.filter(c => C.visibleInList(c, s, t));
    return json(200, list.map(c => C.publicView(c, s)));
  }
  const body = await req.json().catch(() => ({}));
  if (body.photo && body.photo.length > 4.5e6) return json(413, { error: "Bildet er for stort" });
  const id = await db.nextId();
  const c = C.createCase(body, id, s, now());
  if (body.photo) await db.putPhoto(id, "before", body.photo);
  await db.saveCase(c);
  return json(201, C.publicView(c, s));
});

route("publicCase", ["GET"], "public/cases/{id}", async (req) => {
  const [s, c] = await Promise.all([db.getSettings(), db.getCase(req.params.id)]);
  return json(200, C.publicView(c, s));
});

route("publicFollow", ["POST"], "public/cases/{id}/follow", async (req) => {
  const s = await db.getSettings(), c = await db.getCase(req.params.id);
  c.follows = (c.follows || 0) + 1;
  await db.saveCase(c);
  return json(200, C.publicView(c, s));
});

route("photo", ["GET"], "photo/{id}/{kind}", async (req) => {
  const { id, kind } = req.params;
  if (!["before", "after"].includes(kind)) return json(400, { error: "Ugyldig bildetype" });
  if (!isAdmin(req)) {
    const v = (await db.getSettings()).visibility;
    if ((kind === "before" && !v.showPhotos) || (kind === "after" && !v.showAfterPhoto)) return json(403, { error: "Ikke tilgjengelig" });
  }
  const p = await db.getPhoto(id, kind);
  return { status: 200, body: p.buffer, headers: { "Content-Type": p.contentType, "Cache-Control": "private, max-age=300" } };
});

/* ---------- Kommune ---------- */
route("manageCases", ["GET"], "manage/cases", async () => json(200, await db.listCases()), true);

route("manageCase", ["GET", "PATCH"], "manage/cases/{id}", async (req) => {
  const c = await db.getCase(req.params.id);
  if (req.method === "GET") return json(200, c);
  const patch = await req.json().catch(() => ({}));
  const s = await db.getSettings();
  if (patch.afterPhoto) { await db.putPhoto(c.id, "after", patch.afterPhoto); patch.afterPhoto = true; }
  C.applyUpdate(c, patch, s, actor(req), now());
  await db.saveCase(c);
  return json(200, c);
}, true);

route("manageSettings", ["GET", "PUT"], "manage/settings", async (req) => {
  if (req.method === "GET") return json(200, await db.getSettings());
  return json(200, await db.saveSettings(await req.json()));
}, true);

route("manageSeed", ["POST"], "manage/seed", async () => {
  const existing = new Set((await db.listCases()).map(c => c.id));
  let added = 0;
  for (const c of C.seed(Date.now())) if (!existing.has(c.id)) { await db.saveCase(c); added++; }
  return json(200, { ok: true, added });
}, true);
