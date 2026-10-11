/* MeldInn v4 – datalag for nettleseren.
   Bruker API (/api) når det finnes, ellers demomodus med lagring i nettleseren.
   Sett MeldInnStore.portal = "super" (Entra-innlogging) eller "org" (brukernavn/passord) i portalene. */
(function (root) {
  const C = root.MeldInnCore;
  const LK = "meldinn_v4_cases", LS = "meldinn_v4_settings", LP = "meldinn_v4_photos", LU = "meldinn_v4_users", TOK = "meldinn_v4_token";
  let mode = "local";
  const lget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw new Error("Lagring full – bildet er for stort for demomodus"); } };
  const fail = (m, status) => { const e = new Error(m); e.status = status; return e; };
  const cases = () => { let x = lget(LK, null); if (!x) { x = C.seed(Date.now()); lset(LK, x); } return x; };
  function settings() { const raw = lget(LS, null), n = C.normalizeSettings(raw); if (JSON.stringify(raw) !== JSON.stringify(n)) lset(LS, n); return n; }
  const photos = () => lget(LP, {});
  const users = () => lget(LU, []);
  const now = () => new Date().toISOString();
  function nextId(list, t) { const nums = list.filter(c => c.id.startsWith(t.prefix + "-")).map(c => +c.id.split("-")[1] || 0); return t.prefix + "-" + (Math.max(1000, ...nums) + 1); }
  function find(id) { const l = cases(); const c = l.find(x => x.id === id); if (!c) throw fail("Fant ikke saken", 404); return [l, c]; }
  const tenantFor = (c, s) => C.tenantOf(s, C.caseTenant(c, s)) || s.tenants[0];

  /* Passord (PBKDF2-SHA256, samme format som API-et) */
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  async function pbkdf2(pw, salt, iter) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
  }
  async function hashPw(pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2$100000$${b64(salt)}$${await pbkdf2(pw, salt, 100000)}`; }
  async function checkPw(pw, h) { const p = String(h || "").split("$"); if (p.length !== 4) return false; return (await pbkdf2(pw, unb64(p[2]), +p[1])) === p[3]; }
  async function seedUsers() {
    if (lget(LU, null)) return;
    const out = [];
    for (const d of C.DEMO_USERS) out.push({ username: d.username, name: d.name, tenant: d.tenant, role: d.role, active: true, ver: 1, created: now(), hash: await hashPw(d.password) });
    lset(LU, out);
  }

  /* Lokal «sesjon» for org-portalen i demomodus */
  function localOrgUser() {
    const tok = lget(TOK, null); if (!tok) return null;
    const u = users().find(x => x.username === tok.u);
    if (!u || u.active === false || u.ver !== tok.v || tok.exp < Date.now()) return null;
    return u;
  }
  function requireOrg() { const u = localOrgUser(); if (!u) throw fail("Ikke innlogget", 401); return u; }
  function requireOrgAdmin() { const u = requireOrg(); if (u.role !== "admin") throw fail("Krever administrator", 403); return u; }

  async function j(url, opt) {
    const headers = { "Content-Type": "application/json" };
    if (Store.portal === "org") { const t = sessionToken(); if (t) headers["X-MeldInn-Token"] = t; }
    const r = await fetch(url, Object.assign({ headers, cache: "no-store" }, opt || {}));
    if (!r.ok) { let m = r.status + ""; try { m = (await r.json()).error || m; } catch (e) { } throw fail(m, r.status); }
    return r.status === 204 ? null : r.json();
  }
  const sessionToken = () => { try { return sessionStorage.getItem(TOK); } catch (e) { return null; } };
  const q = o => { const p = new URLSearchParams(); for (const k in o) if (o[k]) p.set(k, o[k]); const s = p.toString(); return s ? "?" + s : ""; };
  const isOrg = () => Store.portal === "org";
  const base = () => isOrg() ? "/api/org" : "/api/manage";

  const Store = {
    portal: null,
    get mode() { return mode; },
    async init() {
      try { const r = await fetch("/api/public/tenants", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) { mode = "api"; return mode; } } catch (e) { }
      mode = "local"; await seedUsers(); return mode;
    },

    /* ================= App ================= */
    async tenants() { return mode === "api" ? j("/api/public/tenants") : C.publicTenants(settings()); },
    async join(code) {
      if (mode === "api") return j("/api/public/join", { method: "POST", body: JSON.stringify({ code }) });
      const t = C.tenantByCode(settings(), code);
      if (!t || !t.active) throw fail("Ugyldig kode", 404);
      return Object.assign(C.publicTenantInfo(t), { code: t.code });
    },
    async listPublic(tenant, ids, code) {
      if (mode === "api") return j("/api/public/cases" + q({ tenant, code, ids: ids && ids.join(",") }));
      const s = settings(), t0 = Date.now();
      if (!ids) { const t = C.tenantOf(s, tenant); if (!C.canAccessPublic(t, code)) throw fail("Ingen tilgang", 403); }
      return cases().filter(c => {
        const t = tenantFor(c, s); if (!t.active) return false;
        return ids ? ids.includes(c.id) : (t.id === tenant && C.visibleInList(c, t, t0));
      }).map(c => C.publicView(c, tenantFor(c, s)));
    },
    async getPublic(id) {
      if (mode === "api") return j("/api/public/cases/" + encodeURIComponent(id));
      const s = settings(), c = find(id)[1]; return C.publicView(c, tenantFor(c, s));
    },
    async create(data) {
      if (mode === "api") return j("/api/public/cases", { method: "POST", body: JSON.stringify(data) });
      const l = cases(), s = settings(), t = C.tenantOf(s, data.tenant);
      if (!C.canAccessPublic(t, data.code)) throw fail("Ukjent mottaker eller ugyldig kode", 403);
      const id = nextId(l, t), c = C.createCase(data, id, t, now());
      if (data.photo) { const p = photos(); p[id + "-before"] = data.photo; lset(LP, p); }
      l.unshift(c); lset(LK, l); return C.publicView(c, t);
    },
    async follow(id) {
      if (mode === "api") return j("/api/public/cases/" + encodeURIComponent(id) + "/follow", { method: "POST" });
      const [l, c] = find(id); c.follows = (c.follows || 0) + 1; lset(LK, l); return C.publicView(c, tenantFor(c, settings()));
    },
    photoUrl(id, kind) {
      if (mode !== "api") return photos()[id + "-" + kind] || "";
      const t = isOrg() ? sessionToken() : null;
      return "/api/photo/" + encodeURIComponent(id) + "/" + kind + (t ? "?t=" + encodeURIComponent(t) : "");
    },

    /* ================= Portaler ================= */
    async orgInfo(id) {
      if (!id) return null;
      if (mode === "api") { try { return await j("/api/org/info" + q({ org: id })); } catch (e) { return null; } }
      const t = C.tenantOf(settings(), id); return t ? { id: t.id, name: t.name, type: t.type } : null;
    },
    async login(org, username, password) {
      if (mode === "api") {
        const r = await j("/api/org/login", { method: "POST", body: JSON.stringify({ org, username, password }) });
        sessionStorage.setItem(TOK, r.token); return r;
      }
      const un = C.normUsername(username), l = users(), u = l.find(x => x.username === un);
      const bad = () => fail("Feil brukernavn eller passord", 401);
      if (!u) throw bad();
      if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) throw fail("Kontoen er midlertidig låst etter for mange forsøk. Prøv igjen om litt.", 423);
      if (u.active === false || (org && u.tenant !== org) || !(await checkPw(password, u.hash))) {
        if (u.active !== false) { u.failed = (u.failed || 0) + 1; if (u.failed >= 5) { u.lockedUntil = new Date(Date.now() + 10 * 60e3).toISOString(); u.failed = 0; } lset(LU, l); }
        throw bad();
      }
      u.failed = 0; u.lockedUntil = null; u.lastLogin = now(); lset(LU, l);
      lset(TOK, { u: u.username, v: u.ver, exp: Date.now() + 12 * 3600e3 });
      return { user: C.publicUser(u) };
    },
    logout() { try { sessionStorage.removeItem(TOK); } catch (e) { } localStorage.removeItem(TOK); },
    async me() {
      if (isOrg()) {
        if (mode === "api") { if (!sessionToken()) return null; try { const r = await j("/api/org/me"); return Object.assign({ kind: "org" }, r.user, { tenantName: r.tenant.name }); } catch (e) { return null; } }
        const u = localOrgUser(); if (!u) return null;
        const t = C.tenantOf(settings(), u.tenant);
        return Object.assign({ kind: "org" }, C.publicUser(u), { tenantName: t ? t.name : u.tenant });
      }
      if (mode !== "api") return { kind: "super", name: "Demobruker", roles: ["superadmin"] };
      try { const r = await j("/.auth/me"); const p = r && r.clientPrincipal; return p ? { kind: "super", name: p.userDetails, roles: p.userRoles } : null; } catch (e) { return null; }
    },
    async changePassword(oldPw, newPw) {
      if (!C.validPassword(newPw)) throw fail("Nytt passord må ha minst 8 tegn", 400);
      if (mode === "api") { const r = await j("/api/org/password", { method: "POST", body: JSON.stringify({ old: oldPw, new: newPw }) }); if (r && r.token) sessionStorage.setItem(TOK, r.token); return r; }
      const me = requireOrg(), l = users(), u = l.find(x => x.username === me.username);
      if (!(await checkPw(oldPw, u.hash))) throw fail("Nåværende passord er feil", 400);
      u.hash = await hashPw(newPw); u.ver = (u.ver || 1) + 1; lset(LU, l);
      lset(TOK, { u: u.username, v: u.ver, exp: Date.now() + 12 * 3600e3 }); return { ok: true };
    },
    async listAll() {
      if (mode === "api") return j(base() + "/cases");
      const s = settings(), all = cases().map(c => Object.assign({}, c, { tenant: C.caseTenant(c, s) }));
      return isOrg() ? all.filter(c => c.tenant === requireOrg().tenant) : all;
    },
    async update(id, patch, actor) {
      if (mode === "api") return j(base() + "/cases/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
      const [l, c] = find(id), s = settings();
      c.tenant = C.caseTenant(c, s);
      if (isOrg() && c.tenant !== requireOrg().tenant) throw fail("Ingen tilgang", 403);
      if (patch.afterPhoto) { const p = photos(); p[id + "-after"] = patch.afterPhoto; lset(LP, p); }
      C.applyUpdate(c, patch, tenantFor(c, s), actor, now()); lset(LK, l); return c;
    },
    async settings() {
      if (mode === "api") return j(base() + "/settings");
      const s = settings();
      if (isOrg()) { const u = requireOrg(); return { tenants: s.tenants.filter(t => t.id === u.tenant) }; }
      return s;
    },
    async saveSettings(s) {
      if (isOrg()) {
        const tenant = s.tenants[0];
        if (mode === "api") return j("/api/org/settings", { method: "PUT", body: JSON.stringify(tenant) });
        const u = requireOrgAdmin(), n = C.applyOrgSettings(settings(), u.tenant, tenant); lset(LS, n);
        return { tenants: n.tenants.filter(t => t.id === u.tenant) };
      }
      if (mode === "api") return j("/api/manage/settings", { method: "PUT", body: JSON.stringify(s) });
      lset(LS, C.normalizeSettings(s)); return settings();
    },
    async loadDemo() {
      if (mode === "api") return j("/api/manage/seed", { method: "POST" });
      [LK, LP, LS, LU].forEach(k => localStorage.removeItem(k)); cases(); await seedUsers(); return { ok: true };
    },

    /* Brukere (kun superbruker) */
    async users() {
      if (mode === "api") return j("/api/manage/users");
      return users().map(C.publicUser);
    },
    async createUser(d) {
      if (mode === "api") return j("/api/manage/users", { method: "POST", body: JSON.stringify(d) });
      const un = C.normUsername(d.username), l = users(), s = settings();
      if (!un) throw fail("Brukernavn må være 3–40 tegn: a–z, 0–9, punktum, bindestrek eller understrek", 400);
      if (l.some(x => x.username === un)) throw fail("Brukernavnet er i bruk", 409);
      if (!C.tenantOf(s, d.tenant)) throw fail("Velg organisasjon", 400);
      if (!C.validPassword(d.password)) throw fail("Passord må ha minst 8 tegn", 400);
      const u = { username: un, name: String(d.name || "").trim().slice(0, 80) || un, tenant: d.tenant, role: C.USER_ROLES[d.role] ? d.role : "saksbehandler",
        active: d.active !== false, ver: 1, created: now(), hash: await hashPw(d.password) };
      l.push(u); lset(LU, l); return C.publicUser(u);
    },
    async updateUser(username, d) {
      if (mode === "api") return j("/api/manage/users/" + encodeURIComponent(username), { method: "PATCH", body: JSON.stringify(d) });
      const l = users(), u = l.find(x => x.username === username); if (!u) throw fail("Fant ikke brukeren", 404);
      let bump = false;
      if (d.name !== undefined) u.name = String(d.name).trim().slice(0, 80) || u.username;
      if (d.role && C.USER_ROLES[d.role] && d.role !== u.role) { u.role = d.role; bump = true; }
      if (d.tenant && d.tenant !== u.tenant) { if (!C.tenantOf(settings(), d.tenant)) throw fail("Ukjent organisasjon", 400); u.tenant = d.tenant; bump = true; }
      if (typeof d.active === "boolean" && d.active !== u.active) { u.active = d.active; bump = true; }
      if (d.password) { if (!C.validPassword(d.password)) throw fail("Passord må ha minst 8 tegn", 400); u.hash = await hashPw(d.password); bump = true; }
      if (d.unlock) { u.failed = 0; u.lockedUntil = null; }
      if (bump) u.ver = (u.ver || 1) + 1;
      lset(LU, l); return C.publicUser(u);
    },
    async deleteUser(username) {
      if (mode === "api") return j("/api/manage/users/" + encodeURIComponent(username), { method: "DELETE" });
      lset(LU, users().filter(x => x.username !== username)); return null;
    }
  };
  root.MeldInnStore = Store;
})(self);
