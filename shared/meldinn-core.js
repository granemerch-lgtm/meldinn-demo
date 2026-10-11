/* MeldInn v4 – felles forretningslogikk (organisasjoner, koder, brukere).
   Brukes av nettleser (app + portaler) og API. Kopi: api/src/lib/meldinn-core.js – hold dem like. */
(function (root) {
  const CATALOG = {
    gatelys: "Gatelys", vei: "Hull i veien", soppel: "Søppel", vegetasjon: "Vegetasjon", skilt: "Skilt / benk",
    lekeplass: "Lekeplass", fellesareal: "Fellesareal", vaskeri: "Vaskeri", garasje: "Garasje / parkering",
    lys_inne: "Lys inne", dor_las: "Dør / lås", "snø": "Snø / is", hms: "HMS-avvik", maskin: "Maskin / utstyr",
    lekkasje: "Lekkasje / utslipp", sikring: "Gjerde / sikring", annet: "Annet"
  };
  const TYPES = { kommune: "Kommune", borettslag: "Borettslag / sameie", industri: "Industri / næring" };
  const USER_ROLES = { admin: "Administrator", saksbehandler: "Saksbehandler" };
  const STATUSES = ["Mottatt", "Under behandling", "Tildelt", "Utført", "Løst"];
  const PRIOS = ["Høy", "Normal", "Lav"];
  const STATUS_PUBLIC_TEXT = {
    "Mottatt": "Mottatt", "Under behandling": "Under behandling",
    "Tildelt": "Sendt til utfører", "Utført": "Arbeidet er utført – venter på kontroll", "Løst": "Løst"
  };
  const DEFAULT_VISIBILITY = {
    showOthers: true, showDescription: true, showPhotos: true, showAfterPhoto: true, showSupplier: false,
    showFollowers: true, showPriority: false, showCost: false, historyMode: "full", exactLocation: true, hideResolvedAfterDays: 30
  };
  const DEFAULT_TENANT = { id: "", name: "", type: "kommune", prefix: "XX", code: "", active: true, center: [59.2096, 9.6090],
    cats: ["annet"], autoroute: false, suppliers: [], visibility: DEFAULT_VISIBILITY };

  const DEFAULT_SETTINGS = {
    tenants: [
      { id: "skien", name: "Skien kommune", type: "kommune", prefix: "SK", active: true, center: [59.2096, 9.6090],
        cats: ["gatelys", "vei", "soppel", "vegetasjon", "skilt", "lekeplass", "annet"], autoroute: false,
        suppliers: [
          { id: "lys", n: "Grenland Lys & Elektro AS", cats: ["gatelys"], ramme: 15000, auto: true },
          { id: "vei", n: "Telemark Veidrift AS", cats: ["vei", "skilt"], ramme: 40000, auto: false },
          { id: "park", n: "Skien Park & Renhold AS", cats: ["soppel", "vegetasjon", "lekeplass", "annet"], ramme: 10000, auto: true }],
        visibility: DEFAULT_VISIBILITY },
      { id: "porsgrunn", name: "Porsgrunn kommune", type: "kommune", prefix: "PG", active: true, center: [59.1405, 9.6561],
        cats: ["gatelys", "vei", "soppel", "vegetasjon", "skilt", "annet"], autoroute: false,
        suppliers: [{ id: "pgvei", n: "Porsgrunn Vei & Park KF", cats: ["vei", "vegetasjon", "skilt", "soppel"], ramme: 25000, auto: false }],
        visibility: Object.assign({}, DEFAULT_VISIBILITY, { showSupplier: true }) },
      { id: "kjorbekk", name: "Borettslaget Kjørbekk Park", type: "borettslag", prefix: "KP", code: "KJP-482-PRK", active: true, center: [59.1985, 9.6205],
        cats: ["fellesareal", "vaskeri", "garasje", "lys_inne", "dor_las", "snø", "soppel", "annet"], autoroute: true,
        suppliers: [{ id: "vakt", n: "Vaktmester Grenland AS", cats: ["fellesareal", "lys_inne", "dor_las", "vaskeri", "garasje", "snø", "soppel", "annet"], ramme: 5000, auto: true }],
        visibility: Object.assign({}, DEFAULT_VISIBILITY, { showSupplier: true, hideResolvedAfterDays: 14 }) },
      { id: "heroya", name: "Herøya Industripark", type: "industri", prefix: "HI", code: "HER-739-YAX", active: true, center: [59.1137, 9.6380],
        cats: ["hms", "maskin", "lekkasje", "sikring", "vei", "lys_inne", "annet"], autoroute: false,
        suppliers: [{ id: "hivedl", n: "Herøya Drift & Vedlikehold", cats: ["maskin", "sikring", "vei", "lys_inne", "annet"], ramme: 50000, auto: false }],
        visibility: Object.assign({}, DEFAULT_VISIBILITY, { showOthers: false, showPhotos: false }) }
    ]
  };
  // Kun for demomodus i nettleseren. API-et oppretter aldri disse automatisk.
  const DEMO_USERS = [
    { username: "kjorbekk.styret", name: "Styret Kjørbekk Park", tenant: "kjorbekk", role: "admin", password: "Demo1234" },
    { username: "heroya.hms", name: "HMS-vakt Herøya", tenant: "heroya", role: "saksbehandler", password: "Demo1234" }
  ];

  /* ---------- Hjelpere ---------- */
  function merge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (base && typeof base === "object") {
      const o = Object.assign({}, base);
      if (over && typeof over === "object") for (const k of Object.keys(over)) o[k] = k in base ? merge(base[k], over[k]) : over[k];
      return o;
    }
    return over === undefined ? base : over;
  }
  const clone = x => JSON.parse(JSON.stringify(x));
  function dist(a, b, c, d) { const R = 6371e3, t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return Math.sqrt(x * x + y * y) * R; }

  /* ---------- Koder (XXX-XXX-XXX) ---------- */
  const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // uten 0/O, 1/I/L
  function randInt(n) {
    const g = typeof crypto !== "undefined" && crypto.getRandomValues ? crypto : null;
    if (g) { const a = new Uint32Array(1); g.getRandomValues(a); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }
  function genCode() { let s = ""; for (let i = 0; i < 9; i++) s += CODE_ALPHA[randInt(CODE_ALPHA.length)]; return s.slice(0, 3) + "-" + s.slice(3, 6) + "-" + s.slice(6); }
  function normCode(x) {
    const s = String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length !== 9 || [...s].some(ch => !CODE_ALPHA.includes(ch))) return null;
    return s.slice(0, 3) + "-" + s.slice(3, 6) + "-" + s.slice(6);
  }
  // Formaterer mens man skriver: "abc12" -> "ABC-12"
  function formatCodeInput(x) { const s = String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9); return s.replace(/(.{3})(?=.)/g, "$1-"); }

  /* ---------- Organisasjoner ---------- */
  function normalizeSettings(s) {
    s = s || {};
    let tenants = Array.isArray(s.tenants) && s.tenants.length ? s.tenants : null;
    if (!tenants) {
      tenants = clone(DEFAULT_SETTINGS.tenants);
      if (s.municipality || s.suppliers || s.visibility) { // gammelt format (v2)
        const t = tenants[0];
        if (s.municipality) t.name = s.municipality;
        if (s.suppliers) t.suppliers = s.suppliers;
        if (s.visibility) t.visibility = s.visibility;
        if (typeof s.autoroute === "boolean") t.autoroute = s.autoroute;
        if (s.center) t.center = s.center;
      }
    }
    const used = new Set();
    return { tenants: tenants.map(t => {
      const n = merge(DEFAULT_TENANT, t);
      n.id = String(n.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "") || "org" + Math.random().toString(36).slice(2, 7);
      n.prefix = String(n.prefix || n.id.slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "XX";
      n.cats = (n.cats || []).filter(c => CATALOG[c]); if (!n.cats.length) n.cats = ["annet"];
      if (!TYPES[n.type]) n.type = "kommune";
      if (n.type === "kommune") n.code = "";
      else { let c = normCode(n.code); while (!c || used.has(c)) c = genCode(); n.code = c; used.add(c); }
      return n;
    }) };
  }
  const tenantOf = (s, id) => s.tenants.find(t => t.id === id) || null;
  const tenantByCode = (s, code) => { const c = normCode(code); return c ? s.tenants.find(t => t.code === c) || null : null; };
  const defaultTenantId = s => (s.tenants.find(t => t.active) || s.tenants[0] || {}).id;
  const caseTenant = (c, s) => c.tenant || defaultTenantId(s);
  const isListed = t => t.active && t.type === "kommune";
  // Kommuner er åpne. Andre organisasjoner krever riktig kode.
  const canAccessPublic = (t, code) => !!t && t.active && (t.type === "kommune" || normCode(code) === t.code);
  function supplierName(t, id) { const x = ((t && t.suppliers) || []).find(v => v.id === id); return x ? x.n : null; }
  function publicTenantInfo(t) {
    return { id: t.id, name: t.name, type: t.type, center: t.center, cats: t.cats.map(k => ({ id: k, n: CATALOG[k] })), visibility: t.visibility };
  }
  const publicTenants = s => s.tenants.filter(isListed).map(publicTenantInfo);
  // Det en organisasjonsadministrator får endre for egen organisasjon
  function applyOrgSettings(s, tenantId, inc) {
    const out = clone(s), t = tenantOf(out, tenantId);
    if (!t || !inc) return out;
    if (inc.visibility) t.visibility = merge(DEFAULT_VISIBILITY, inc.visibility);
    if (Array.isArray(inc.suppliers)) t.suppliers = inc.suppliers.filter(x => x && x.n).map(x => ({
      id: String(x.id || "lev" + Math.random().toString(36).slice(2, 8)).slice(0, 40), n: String(x.n).slice(0, 120),
      cats: (x.cats || []).filter(c => t.cats.includes(c)), ramme: Math.max(0, Number(x.ramme) || 0), auto: !!x.auto }));
    if (typeof inc.autoroute === "boolean") t.autoroute = inc.autoroute;
    return normalizeSettings(out);
  }

  /* ---------- Brukere ---------- */
  function normUsername(u) { const s = String(u || "").trim().toLowerCase(); return /^[a-z0-9._-]{3,40}$/.test(s) ? s : null; }
  const validPassword = pw => typeof pw === "string" && pw.length >= 8 && pw.length <= 200;
  function publicUser(u) {
    if (!u) return null;
    return { username: u.username, name: u.name, tenant: u.tenant, role: u.role, active: u.active !== false,
      created: u.created, lastLogin: u.lastLogin || null, locked: !!(u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) };
  }
  function genPassword() {
    const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = "";
    for (let i = 0; i < 12; i++) s += a[randInt(a.length)];
    return s;
  }

  /* ---------- Saker ---------- */
  function visibleInList(c, t, now) {
    const v = t.visibility;
    if (!v.showOthers) return false;
    if (c.status === "Løst") {
      const ts = Date.parse(c.resolvedAt || c.updated || c.created);
      if ((now - ts) / 864e5 > (v.hideResolvedAfterDays || 0)) return false;
    }
    return true;
  }
  function publicView(c, t) {
    const v = t.visibility, r = v.exactLocation ? 1e5 : 1e3;
    const o = { id: c.id, tenant: c.tenant, tenantName: t.name, tenantType: t.type, cat: c.cat, catName: CATALOG[c.cat] || c.cat,
      status: c.status, created: c.created, updated: c.updated, lat: Math.round(c.lat * r) / r, lng: Math.round(c.lng * r) / r };
    if (v.showDescription) o.desc = c.desc;
    if (v.showPhotos && c.hasPhoto) o.hasPhoto = true;
    if (v.showAfterPhoto && c.hasAfter) o.hasAfter = true;
    if (v.showSupplier && c.supplier) o.supplier = supplierName(t, c.supplier);
    if (v.showFollowers) o.follows = c.follows || 0;
    if (v.showPriority) o.prio = c.prio;
    if (v.showCost && c.cost) o.cost = c.cost;
    o.history = (c.history || []).filter(h => h.kind === "status" || (v.historyMode === "full" && h.kind === "public"))
      .map(h => ({ t: h.t, txt: h.txt, kind: h.kind }));
    return o;
  }
  function createCase(input, id, t, now) {
    const cat = t.cats.includes(input.cat) ? input.cat : (t.cats.includes("annet") ? "annet" : t.cats[0]);
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!isFinite(lat) || !isFinite(lng)) { const e = new Error("Mangler gyldig posisjon"); e.status = 400; throw e; }
    const c = { id, tenant: t.id, cat, lat, lng,
      desc: String(input.desc || "").trim().slice(0, 500) || CATALOG[cat],
      contact: String(input.contact || "").trim().slice(0, 120),
      status: "Mottatt", prio: "Normal", supplier: null, cost: null, follows: 0,
      hasPhoto: !!input.photo, hasAfter: false, created: now, updated: now, resolvedAt: null,
      history: [{ t: now, txt: "Meldt inn", kind: "status" }] };
    if (t.autoroute) {
      const sp = (t.suppliers || []).find(x => x.auto && x.cats.includes(cat));
      if (sp) {
        c.supplier = sp.id; c.status = "Tildelt";
        c.history.push({ t: now, txt: STATUS_PUBLIC_TEXT["Tildelt"], kind: "status" });
        c.history.push({ t: now, txt: "Automatisk rutet til " + sp.n + " (forhåndsavtale)", kind: "internal", by: "System" });
      }
    }
    return c;
  }
  function applyUpdate(c, patch, t, actor, now) {
    const by = actor || "Portal", push = (txt, kind) => c.history.push({ t: now, txt, kind, by });
    if (patch.prio && PRIOS.includes(patch.prio) && patch.prio !== c.prio) { c.prio = patch.prio; push("Prioritet satt til " + c.prio, "internal"); }
    if (patch.supplier !== undefined && patch.supplier !== c.supplier) {
      c.supplier = patch.supplier || null;
      push(c.supplier ? "Tildelt " + supplierName(t, c.supplier) : "Leverandør fjernet", "internal");
      if (c.supplier && !patch.status && ["Mottatt", "Under behandling"].includes(c.status)) patch.status = "Tildelt";
    }
    if (patch.cost !== undefined && patch.cost !== null && patch.cost !== "" && Number(patch.cost) !== c.cost) {
      c.cost = Math.max(0, Number(patch.cost) || 0); push("Kostnad registrert: kr " + c.cost.toLocaleString("no-NO"), "internal");
    }
    if (patch.status && STATUSES.includes(patch.status) && patch.status !== c.status) {
      c.status = patch.status; push(STATUS_PUBLIC_TEXT[c.status], "status"); c.resolvedAt = c.status === "Løst" ? now : null;
    }
    if (patch.publicMessage && String(patch.publicMessage).trim()) push(String(patch.publicMessage).trim().slice(0, 500), "public");
    if (patch.internalNote && String(patch.internalNote).trim()) push("Notat: " + String(patch.internalNote).trim().slice(0, 1000), "internal");
    if (patch.afterPhoto) { c.hasAfter = true; push("Bilde etter utbedring lagt til", "public"); }
    c.updated = now; return c;
  }
  function seed(nowMs) {
    const d = h => new Date(nowMs - h * 3600e3).toISOString();
    const st = (txt, h) => ({ t: d(h), txt, kind: "status" }), inn = (txt, h) => ({ t: d(h), txt, kind: "internal", by: "Demo" }), pub = (txt, h) => ({ t: d(h), txt, kind: "public", by: "Demo" });
    const mk = (id, tenant, cat, lat, lng, desc, status, h, x) => Object.assign({ id, tenant, cat, lat, lng, desc, contact: "", status, prio: "Normal",
      supplier: null, cost: null, follows: 0, hasPhoto: false, hasAfter: false, created: d(h), updated: d(h), resolvedAt: null, history: [st("Meldt inn", h)] }, x || {});
    return [
      mk("SK-1041", "skien", "gatelys", 59.2121, 9.6043, "Gatelyset blinker og slukker om kvelden", "Tildelt", 50, { supplier: "lys", prio: "Høy", follows: 4, updated: d(39),
        history: [st("Meldt inn", 50), inn("Prioritet satt til Høy", 40), inn("Tildelt Grenland Lys & Elektro AS", 39), st("Sendt til utfører", 39), pub("Elektriker er bestilt og kommer i løpet av uken.", 39)] }),
      mk("SK-1042", "skien", "vei", 59.2063, 9.6155, "Dypt hull ved fotgjengerovergangen", "Under behandling", 30, { follows: 7, updated: d(20),
        history: [st("Meldt inn", 30), st("Under behandling", 20), inn("Notat: Sjekk om dette er fylkesvei", 20)] }),
      mk("SK-1043", "skien", "soppel", 59.2100, 9.6000, "Full søppelkasse ved busstopp", "Mottatt", 5, { contact: "kari@example.no" }),
      mk("SK-1044", "skien", "vegetasjon", 59.2152, 9.6120, "Busker sperrer halve fortauet", "Utført", 90, { supplier: "park", cost: 3200, updated: d(10),
        history: [st("Meldt inn", 90), inn("Tildelt Skien Park & Renhold AS", 80), st("Sendt til utfører", 80), st("Arbeidet er utført – venter på kontroll", 10)] }),
      mk("PG-2001", "porsgrunn", "gatelys", 59.1405, 9.6565, "To lys ute i Storgata", "Løst", 120, { supplier: "pgvei", cost: 4800, follows: 2, updated: d(100), resolvedAt: d(100),
        history: [st("Meldt inn", 120), inn("Tildelt Porsgrunn Vei & Park KF", 115), st("Sendt til utfører", 115), st("Løst", 100), pub("Pærene er byttet. Takk for at du meldte fra!", 100)] }),
      mk("PG-2002", "porsgrunn", "vei", 59.1430, 9.6490, "Kumlokk ligger løst i veibanen", "Mottatt", 3, { prio: "Høy" }),
      mk("KP-3001", "kjorbekk", "vaskeri", 59.1986, 9.6207, "Tørketrommel 2 i blokk C virker ikke", "Tildelt", 26, { supplier: "vakt",
        history: [st("Meldt inn", 26), st("Sendt til utfører", 26), inn("Automatisk rutet til Vaktmester Grenland AS (forhåndsavtale)", 26)] }),
      mk("KP-3002", "kjorbekk", "dor_las", 59.1982, 9.6200, "Inngangsdøren blokk A lukker ikke helt", "Mottatt", 4),
      mk("HI-4001", "heroya", "hms", 59.1140, 9.6375, "Manglende rekkverk ved trapp bygg 92", "Under behandling", 8, { prio: "Høy",
        history: [st("Meldt inn", 8), st("Under behandling", 6), inn("Notat: Område sperret midlertidig", 6)] }),
      mk("HI-4002", "heroya", "lekkasje", 59.1131, 9.6392, "Oljesøl ved lasterampe 4", "Mottatt", 1, { prio: "Høy" })
    ];
  }

  const api = { CATALOG, TYPES, USER_ROLES, STATUSES, PRIOS, STATUS_PUBLIC_TEXT, DEFAULT_VISIBILITY, DEFAULT_SETTINGS, DEMO_USERS,
    merge, clone, dist, CODE_ALPHA, genCode, normCode, formatCodeInput,
    normalizeSettings, tenantOf, tenantByCode, defaultTenantId, caseTenant, isListed, canAccessPublic, supplierName,
    publicTenantInfo, publicTenants, applyOrgSettings, normUsername, validPassword, publicUser, genPassword,
    visibleInList, publicView, createCase, applyUpdate, seed };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MeldInnCore = api;
})(typeof self !== "undefined" ? self : this);
