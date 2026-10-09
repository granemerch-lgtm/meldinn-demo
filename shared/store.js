/* MeldInn – datalag for nettleseren.
   Bruker API (/api) når det finnes. Ellers demomodus med lokal lagring i nettleseren. */
(function (root) {
  const C = root.MeldInnCore;
  const LK = "meldinn_v2_cases", LS = "meldinn_v2_settings", LP = "meldinn_v2_photos";
  let mode = "local";

  const lget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw new Error("Lagring full – bildet er for stort for demomodus"); } };
  const cases = () => { let x = lget(LK, null); if (!x) { x = C.seed(Date.now()); lset(LK, x); } return x; };
  const settings = () => C.merge(C.DEFAULT_SETTINGS, lget(LS, {}));
  const photos = () => lget(LP, {});
  const now = () => new Date().toISOString();
  function nextId(list) { return "SK-" + (Math.max(1046, ...list.map(c => +c.id.split("-")[1] || 0)) + 1); }
  function find(id) { const l = cases(); const c = l.find(x => x.id === id); if (!c) throw new Error("Fant ikke saken"); return [l, c]; }

  async function j(url, opt) {
    const r = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" }, cache: "no-store" }, opt || {}));
    if (r.status === 401 || r.status === 403) { const e = new Error("Ingen tilgang"); e.status = r.status; throw e; }
    if (!r.ok) { let m = r.status + ""; try { m = (await r.json()).error || m; } catch (e) { } throw new Error(m); }
    return r.status === 204 ? null : r.json();
  }

  const Store = {
    get mode() { return mode; },
    async init() {
      try {
        const r = await fetch("/api/public/settings", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) { mode = "api"; return mode; }
      } catch (e) { }
      mode = "local"; return mode;
    },

    /* ---------- Innbygger ---------- */
    async publicSettings() { return mode === "api" ? j("/api/public/settings") : C.publicSettings(settings()); },
    async listPublic(ids) {
      if (mode === "api") return j("/api/public/cases" + (ids ? "?ids=" + encodeURIComponent(ids.join(",")) : ""));
      const s = settings(), t = Date.now();
      return cases().filter(c => ids ? ids.includes(c.id) : C.visibleInList(c, s, t)).map(c => C.publicView(c, s));
    },
    async getPublic(id) {
      if (mode === "api") return j("/api/public/cases/" + encodeURIComponent(id));
      return C.publicView(find(id)[1], settings());
    },
    async create(data) {
      if (mode === "api") return j("/api/public/cases", { method: "POST", body: JSON.stringify(data) });
      const l = cases(), s = settings(), id = nextId(l);
      const c = C.createCase(data, id, s, now());
      if (data.photo) { const p = photos(); p[id + "-before"] = data.photo; lset(LP, p); }
      l.unshift(c); lset(LK, l); return C.publicView(c, s);
    },
    async follow(id) {
      if (mode === "api") return j("/api/public/cases/" + encodeURIComponent(id) + "/follow", { method: "POST" });
      const [l, c] = find(id); c.follows = (c.follows || 0) + 1; lset(LK, l); return C.publicView(c, settings());
    },
    photoUrl(id, kind) {
      if (mode === "api") return "/api/photo/" + encodeURIComponent(id) + "/" + kind;
      return photos()[id + "-" + kind] || "";
    },

    /* ---------- Kommune ---------- */
    async me() {
      if (mode !== "api") return { name: "Demobruker", roles: ["kommune"] };
      try { const r = await j("/.auth/me"); const p = r && r.clientPrincipal; return p ? { name: p.userDetails, roles: p.userRoles } : null; } catch (e) { return null; }
    },
    async listAll() { return mode === "api" ? j("/api/manage/cases") : cases(); },
    async getCase(id) { return mode === "api" ? j("/api/manage/cases/" + encodeURIComponent(id)) : find(id)[1]; },
    async update(id, patch, actor) {
      if (mode === "api") return j("/api/manage/cases/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
      const [l, c] = find(id);
      if (patch.afterPhoto) { const p = photos(); p[id + "-after"] = patch.afterPhoto; lset(LP, p); }
      C.applyUpdate(c, patch, settings(), actor, now()); lset(LK, l); return c;
    },
    async settings() { return mode === "api" ? j("/api/manage/settings") : settings(); },
    async saveSettings(s) {
      if (mode === "api") return j("/api/manage/settings", { method: "PUT", body: JSON.stringify(s) });
      lset(LS, s); return settings();
    },
    async loadDemo() {
      if (mode === "api") return j("/api/manage/seed", { method: "POST" });
      localStorage.removeItem(LK); localStorage.removeItem(LP); cases(); return { ok: true };
    }
  };
  root.MeldInnStore = Store;
})(self);
