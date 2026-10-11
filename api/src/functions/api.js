/* MeldInn API v4
   /api/public/*  – appen. Kommuner er åpne, andre organisasjoner krever kode.
   /api/org/*     – organisasjonsportalen. Brukernavn/passord → token i headeren X-MeldInn-Token.
   /api/manage/*  – superbruker (Entra-roller "superadmin" eller "kommune", håndheves også i staticwebapp.config.json).
   /api/photo/*   – bilder, styrt av synlighetsvalg (portalene ser alltid egne). */
const { app } = require("@azure/functions");
const C = require("../lib/meldinn-core.js");
const db = require("../lib/db.js");
const auth = require("../lib/auth.js");
const SUPER_ROLES = ["superadmin", "kommune"];

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();
const fail = (m, s) => { const e = new Error(m); e.status = s; return e; };
function principal(req) {
  const h = req.headers.get("x-ms-client-principal"); if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch (e) { return null; }
}
const isSuper = req => { const p = principal(req); return !!p && (p.userRoles || []).some(r => SUPER_ROLES.includes(r)); };
const superName = req => { const p = principal(req); return (p && p.userDetails) || "Superbruker"; };
const withTenant = (c, s) => { c.tenant = C.caseTenant(c, s); return c; };
// Organisasjonsbruker fra token. Sjekker at brukeren fortsatt er aktiv og at passord/rolle ikke er endret siden innlogging.
async function orgUser(token) {
  const p = auth.verify(token); if (!p) return null;
  const u = await db.getUser(p.u);
  if (!u || u.active === false || u.ver !== p.v || u.tenant !== p.t) return null;
  return u;
}
function route(name, methods, path, handler, guard) {
  app.http(name, { methods, authLevel: "anonymous", route: path,
    handler: async (req, ctx) => {
      try {
        let user = null;
        if (guard === "super" && !isSuper(req)) return json(403, { error: "Ingen tilgang" });
        if (guard === "org" || guard === "orgAdmin") {
          user = await orgUser(req.headers.get("x-meldinn-token"));
          if (!user) return json(401, { error: "Ikke innlogget eller økten er utløpt" });
          if (guard === "orgAdmin" && user.role !== "admin") return json(403, { error: "Krever administrator" });
        }
        return await handler(req, ctx, user);
      } catch (e) {
        if (!e.status || e.status >= 500) ctx.error(e);
        return json(e.status || 500, { error: e.message || "Serverfeil" });
      }
    } });
}
function accessible(s, id, code) { const t = C.tenantOf(s, id); if (!C.canAccessPublic(t, code)) throw fail("Ukjent mottaker eller ugyldig kode", 404); return t; }
function activeTenant(s, id) { const t = C.tenantOf(s, id); if (!t || !t.active) throw fail("Ukjent mottaker", 404); return t; }

/* ======================= App ======================= */
route("publicTenants", ["GET"], "public/tenants", async () => json(200, C.publicTenants(await db.getSettings())));

route("publicJoin", ["POST"], "public/join", async (req) => {
  const b = await req.json().catch(() => ({}));
  const t = C.tenantByCode(await db.getSettings(), b.code);
  if (!t || !t.active) return json(404, { error: "Ugyldig kode" });
  return json(200, Object.assign(C.publicTenantInfo(t), { code: t.code }));
});

route("publicCases", ["GET", "POST"], "public/cases", async (req) => {
  const s = await db.getSettings();
  if (req.method === "GET") {
    const ids = (req.query.get("ids") || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 100);
    const all = (await db.listCases()).map(c => withTenant(c, s)), t0 = Date.now();
    let list;
    if (ids.length) list = all.filter(c => ids.includes(c.id));
    else { const t = accessible(s, req.query.get("tenant"), req.query.get("code")); list = all.filter(c => c.tenant === t.id && C.visibleInList(c, t, t0)); }
    return json(200, list.map(c => ({ c, t: C.tenantOf(s, c.tenant) })).filter(x => x.t && x.t.active).map(x => C.publicView(x.c, x.t)));
  }
  const body = await req.json().catch(() => ({}));
  const t = accessible(s, body.tenant, body.code);
  if (body.photo && body.photo.length > 4.5e6) return json(413, { error: "Bildet er for stort" });
  const id = await db.nextId(t.prefix);
  const c = C.createCase(body, id, t, now());
  if (body.photo) await db.putPhoto(id, "before", body.photo);
  await db.saveCase(c);
  return json(201, C.publicView(c, t));
});
route("publicCase", ["GET"], "public/cases/{id}", async (req) => {
  const s = await db.getSettings(), c = withTenant(await db.getCase(req.params.id), s);
  return json(200, C.publicView(c, activeTenant(s, c.tenant)));
});
route("publicFollow", ["POST"], "public/cases/{id}/follow", async (req) => {
  const s = await db.getSettings(), c = withTenant(await db.getCase(req.params.id), s), t = activeTenant(s, c.tenant);
  c.follows = (c.follows || 0) + 1; await db.saveCase(c); return json(200, C.publicView(c, t));
});
route("photo", ["GET"], "photo/{id}/{kind}", async (req) => {
  const { id, kind } = req.params;
  if (!["before", "after"].includes(kind)) return json(400, { error: "Ugyldig bildetype" });
  const s = await db.getSettings(), c = withTenant(await db.getCase(id), s);
  let ok = isSuper(req);
  if (!ok) { const u = await orgUser(req.query.get("t") || req.headers.get("x-meldinn-token")); ok = !!u && u.tenant === c.tenant; }
  if (!ok) {
    const v = activeTenant(s, c.tenant).visibility;
    if ((kind === "before" && !v.showPhotos) || (kind === "after" && !v.showAfterPhoto)) return json(403, { error: "Ikke tilgjengelig" });
  }
  const p = await db.getPhoto(id, kind);
  return { status: 200, body: p.buffer, headers: { "Content-Type": p.contentType, "Cache-Control": "private, max-age=300" } };
});

/* ======================= Organisasjonsportal ======================= */
route("orgInfo", ["GET"], "org/info", async (req) => {
  const t = C.tenantOf(await db.getSettings(), req.query.get("org"));
  return t ? json(200, { id: t.id, name: t.name, type: t.type }) : json(404, { error: "Ukjent organisasjon" });
});
route("orgLogin", ["POST"], "org/login", async (req) => {
  const b = await req.json().catch(() => ({}));
  const bad = () => json(401, { error: "Feil brukernavn eller passord" });
  const un = C.normUsername(b.username); if (!un || !b.password) return bad();
  const u = await db.getUser(un);
  if (!u) { auth.checkPw(b.password, "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="); return bad(); } // jevn svartid
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) return json(423, { error: "Kontoen er midlertidig låst etter for mange forsøk. Prøv igjen om litt." });
  const pwOk = auth.checkPw(b.password, u.hash);
  if (!pwOk || u.active === false || (b.org && u.tenant !== b.org)) {
    if (!pwOk) { u.failed = (u.failed || 0) + 1; if (u.failed >= 5) { u.lockedUntil = new Date(Date.now() + 10 * 60e3).toISOString(); u.failed = 0; } await db.saveUser(u); }
    return bad();
  }
  u.failed = 0; u.lockedUntil = null; u.lastLogin = now(); await db.saveUser(u);
  return json(200, { token: auth.sign(u), user: C.publicUser(u) });
});
route("orgMe", ["GET"], "org/me", async (req, ctx, u) => {
  const t = C.tenantOf(await db.getSettings(), u.tenant);
  return json(200, { user: C.publicUser(u), tenant: t ? { id: t.id, name: t.name, type: t.type } : { id: u.tenant, name: u.tenant } });
}, "org");
route("orgPassword", ["POST"], "org/password", async (req, ctx, u) => {
  const b = await req.json().catch(() => ({}));
  if (!auth.checkPw(b.old, u.hash)) return json(400, { error: "Nåværende passord er feil" });
  if (!C.validPassword(b.new)) return json(400, { error: "Nytt passord må ha minst 8 tegn" });
  u.hash = auth.hashPw(b.new); u.ver = (u.ver || 1) + 1; await db.saveUser(u);
  return json(200, { ok: true, token: auth.sign(u) });
}, "org");
route("orgCases", ["GET"], "org/cases", async (req, ctx, u) => {
  const s = await db.getSettings();
  return json(200, (await db.listCases()).map(c => withTenant(c, s)).filter(c => c.tenant === u.tenant));
}, "org");
route("orgCase", ["PATCH"], "org/cases/{id}", async (req, ctx, u) => {
  const s = await db.getSettings(), c = withTenant(await db.getCase(req.params.id), s);
  if (c.tenant !== u.tenant) return json(404, { error: "Fant ikke saken" });
  const patch = await req.json().catch(() => ({}));
  if (patch.afterPhoto) { await db.putPhoto(c.id, "after", patch.afterPhoto); patch.afterPhoto = true; }
  C.applyUpdate(c, patch, C.tenantOf(s, c.tenant), u.name || u.username, now());
  await db.saveCase(c); return json(200, c);
}, "org");
route("orgSettings", ["GET", "PUT"], "org/settings", async (req, ctx, u) => {
  const s = await db.getSettings();
  if (req.method === "GET") return json(200, { tenants: s.tenants.filter(t => t.id === u.tenant) });
  if (u.role !== "admin") return json(403, { error: "Krever administrator" });
  const n = await db.saveSettings(C.applyOrgSettings(s, u.tenant, await req.json()));
  return json(200, { tenants: n.tenants.filter(t => t.id === u.tenant) });
}, "org");

/* ======================= Superbruker ======================= */
route("manageCases", ["GET"], "manage/cases", async () => {
  const s = await db.getSettings(); return json(200, (await db.listCases()).map(c => withTenant(c, s)));
}, "super");
route("manageCase", ["GET", "PATCH"], "manage/cases/{id}", async (req) => {
  const s = await db.getSettings(), c = withTenant(await db.getCase(req.params.id), s);
  if (req.method === "GET") return json(200, c);
  const patch = await req.json().catch(() => ({}));
  if (patch.afterPhoto) { await db.putPhoto(c.id, "after", patch.afterPhoto); patch.afterPhoto = true; }
  C.applyUpdate(c, patch, C.tenantOf(s, c.tenant) || s.tenants[0], superName(req), now());
  await db.saveCase(c); return json(200, c);
}, "super");
route("manageSettings", ["GET", "PUT"], "manage/settings", async (req) => {
  if (req.method === "GET") return json(200, await db.getSettings());
  return json(200, await db.saveSettings(await req.json()));
}, "super");
route("manageUsers", ["GET", "POST"], "manage/users", async (req) => {
  if (req.method === "GET") return json(200, (await db.listUsers()).map(C.publicUser));
  const d = await req.json().catch(() => ({}));
  const un = C.normUsername(d.username);
  if (!un) return json(400, { error: "Brukernavn må være 3–40 tegn: a–z, 0–9, punktum, bindestrek eller understrek" });
  if (await db.getUser(un)) return json(409, { error: "Brukernavnet er i bruk" });
  if (!C.tenantOf(await db.getSettings(), d.tenant)) return json(400, { error: "Velg organisasjon" });
  if (!C.validPassword(d.password)) return json(400, { error: "Passord må ha minst 8 tegn" });
  const u = { username: un, name: String(d.name || "").trim().slice(0, 80) || un, tenant: d.tenant, role: C.USER_ROLES[d.role] ? d.role : "saksbehandler",
    active: d.active !== false, ver: 1, created: now(), hash: auth.hashPw(d.password) };
  await db.saveUser(u); return json(201, C.publicUser(u));
}, "super");
route("manageUser", ["PATCH", "DELETE"], "manage/users/{username}", async (req) => {
  const un = C.normUsername(req.params.username); const u = un && await db.getUser(un);
  if (req.method === "DELETE") { if (u) await db.deleteUser(un); return { status: 204 }; }
  if (!u) return json(404, { error: "Fant ikke brukeren" });
  const d = await req.json().catch(() => ({})); let bump = false;
  if (d.name !== undefined) u.name = String(d.name).trim().slice(0, 80) || u.username;
  if (d.role && C.USER_ROLES[d.role] && d.role !== u.role) { u.role = d.role; bump = true; }
  if (d.tenant && d.tenant !== u.tenant) { if (!C.tenantOf(await db.getSettings(), d.tenant)) return json(400, { error: "Ukjent organisasjon" }); u.tenant = d.tenant; bump = true; }
  if (typeof d.active === "boolean" && d.active !== (u.active !== false)) { u.active = d.active; bump = true; }
  if (d.password) { if (!C.validPassword(d.password)) return json(400, { error: "Passord må ha minst 8 tegn" }); u.hash = auth.hashPw(d.password); bump = true; }
  if (d.unlock) { u.failed = 0; u.lockedUntil = null; }
  if (bump) u.ver = (u.ver || 1) + 1;   // logger ut eksisterende økter
  await db.saveUser(u); return json(200, C.publicUser(u));
}, "super");
route("manageSeed", ["POST"], "manage/seed", async () => {
  // Legger til demo-organisasjoner og demosaker som mangler. Oppretter ikke brukere.
  const s = await db.getSettings(), have = new Set(s.tenants.map(t => t.id));
  for (const t of C.DEFAULT_SETTINGS.tenants) if (!have.has(t.id)) s.tenants.push(C.clone(t));
  await db.saveSettings(s);
  const existing = new Set((await db.listCases()).map(c => c.id)); let added = 0;
  for (const c of C.seed(Date.now())) if (!existing.has(c.id)) { await db.saveCase(c); added++; }
  return json(200, { ok: true, added });
}, "super");
