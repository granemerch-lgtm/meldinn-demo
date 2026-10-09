/* MeldInn – felles forretningslogikk.
   Brukes av både nettleser (innbygger-app og kommuneportal) og API (Azure Functions).
   NB: Kopi av denne filen ligger i api/src/lib/meldinn-core.js – hold dem like. */
(function (root) {
  const CATS = {
    gatelys: "Gatelys", vei: "Hull i veien", soppel: "Søppel",
    vegetasjon: "Vegetasjon", skilt: "Skilt / benk", annet: "Annet"
  };
  const STATUSES = ["Mottatt", "Under behandling", "Tildelt", "Utført", "Løst"];
  const PRIOS = ["Høy", "Normal", "Lav"];
  // Tekst innbyggeren ser i historikken ved statusendring
  const STATUS_PUBLIC_TEXT = {
    "Mottatt": "Mottatt", "Under behandling": "Under behandling hos kommunen",
    "Tildelt": "Sendt til utfører", "Utført": "Arbeidet er utført – venter på kontroll", "Løst": "Løst"
  };

  const DEFAULT_SETTINGS = {
    municipality: "Skien kommune",
    center: [59.2096, 9.6090],
    autoroute: false,
    suppliers: [
      { id: "lys", n: "Grenland Lys & Elektro AS", cats: ["gatelys"], ramme: 15000, auto: true },
      { id: "vei", n: "Telemark Veidrift AS", cats: ["vei", "skilt"], ramme: 40000, auto: false },
      { id: "park", n: "Skien Park & Renhold AS", cats: ["soppel", "vegetasjon", "annet"], ramme: 10000, auto: true }
    ],
    visibility: {
      showOthers: true,          // Vis andres saker på kart/liste (duplikatsjekk)
      showDescription: true,     // Vis beskrivelsen innbyggeren skrev
      showPhotos: true,          // Vis innsendt bilde
      showAfterPhoto: true,      // Vis bilde etter utbedring
      showSupplier: false,       // Vis navn på leverandør
      showFollowers: true,       // Vis antall som følger saken
      showPriority: false,       // Vis prioritet
      showCost: false,           // Vis kostnad
      historyMode: "full",       // "full" = status + meldinger fra kommunen, "status" = kun statusendringer
      exactLocation: true,       // false = posisjon avrundes til ca. 100 m
      hideResolvedAfterDays: 30  // Løste saker skjules fra kart etter X dager (0 = skjul straks)
    }
  };

  function merge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (base && typeof base === "object") {
      const o = Object.assign({}, base);
      if (over && typeof over === "object") for (const k of Object.keys(over)) o[k] = k in base ? merge(base[k], over[k]) : over[k];
      return o;
    }
    return over === undefined ? base : over;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function dist(a, b, c, d) { const R = 6371e3, t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return Math.sqrt(x * x + y * y) * R; }
  function supplierName(s, id) { const x = (s.suppliers || []).find(v => v.id === id); return x ? x.n : null; }

  function publicSettings(s) {
    return { municipality: s.municipality, center: s.center, visibility: s.visibility };
  }

  function visibleInList(c, s, now) {
    const v = s.visibility;
    if (!v.showOthers) return false;
    if (c.status === "Løst") {
      const t = Date.parse(c.resolvedAt || c.updated || c.created);
      if ((now - t) / 864e5 > (v.hideResolvedAfterDays || 0)) return false;
    }
    return true;
  }

  // Det innbyggeren får se – filtreres på serveren, ikke bare skjules i appen
  function publicView(c, s) {
    const v = s.visibility, r = v.exactLocation ? 1e5 : 1e3;
    const o = { id: c.id, cat: c.cat, status: c.status, created: c.created, updated: c.updated,
      lat: Math.round(c.lat * r) / r, lng: Math.round(c.lng * r) / r };
    if (v.showDescription) o.desc = c.desc;
    if (v.showPhotos && c.hasPhoto) o.hasPhoto = true;
    if (v.showAfterPhoto && c.hasAfter) o.hasAfter = true;
    if (v.showSupplier && c.supplier) o.supplier = supplierName(s, c.supplier);
    if (v.showFollowers) o.follows = c.follows || 0;
    if (v.showPriority) o.prio = c.prio;
    if (v.showCost && c.cost) o.cost = c.cost;
    o.history = (c.history || [])
      .filter(h => h.kind === "status" || (v.historyMode === "full" && h.kind === "public"))
      .map(h => ({ t: h.t, txt: h.txt, kind: h.kind }));
    return o;
  }

  function createCase(input, id, s, now) {
    const cat = CATS[input.cat] ? input.cat : "annet";
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!isFinite(lat) || !isFinite(lng)) { const e = new Error("Mangler gyldig posisjon"); e.status = 400; throw e; }
    const c = {
      id, cat, lat, lng,
      desc: String(input.desc || "").trim().slice(0, 500) || CATS[cat],
      contact: String(input.contact || "").trim().slice(0, 120),
      status: "Mottatt", prio: "Normal", supplier: null, cost: null, follows: 0,
      hasPhoto: !!input.photo, hasAfter: false, created: now, updated: now, resolvedAt: null,
      history: [{ t: now, txt: "Meldt inn", kind: "status" }]
    };
    if (s.autoroute) {
      const sp = (s.suppliers || []).find(x => x.auto && x.cats.includes(cat));
      if (sp) {
        c.supplier = sp.id; c.status = "Tildelt";
        c.history.push({ t: now, txt: STATUS_PUBLIC_TEXT["Tildelt"], kind: "status" });
        c.history.push({ t: now, txt: "Automatisk rutet til " + sp.n + " (forhåndsavtale)", kind: "internal", by: "System" });
      }
    }
    return c;
  }

  // Endringer fra kommunen. patch: {status, prio, supplier, cost, internalNote, publicMessage}
  function applyUpdate(c, patch, s, actor, now) {
    const by = actor || "Kommune";
    const push = (txt, kind) => c.history.push({ t: now, txt, kind, by });
    if (patch.prio && PRIOS.includes(patch.prio) && patch.prio !== c.prio) { c.prio = patch.prio; push("Prioritet satt til " + c.prio, "internal"); }
    if (patch.supplier !== undefined && patch.supplier !== c.supplier) {
      c.supplier = patch.supplier || null;
      push(c.supplier ? "Tildelt " + supplierName(s, c.supplier) : "Leverandør fjernet", "internal");
      if (c.supplier && !patch.status && ["Mottatt", "Under behandling"].includes(c.status)) patch.status = "Tildelt";
    }
    if (patch.cost !== undefined && patch.cost !== null && patch.cost !== "" && Number(patch.cost) !== c.cost) {
      c.cost = Math.max(0, Number(patch.cost) || 0); push("Kostnad registrert: kr " + c.cost.toLocaleString("no-NO"), "internal");
    }
    if (patch.status && STATUSES.includes(patch.status) && patch.status !== c.status) {
      c.status = patch.status; push(STATUS_PUBLIC_TEXT[c.status], "status");
      c.resolvedAt = c.status === "Løst" ? now : null;
    }
    if (patch.publicMessage && String(patch.publicMessage).trim()) push(String(patch.publicMessage).trim().slice(0, 500), "public");
    if (patch.internalNote && String(patch.internalNote).trim()) push("Notat: " + String(patch.internalNote).trim().slice(0, 1000), "internal");
    if (patch.afterPhoto) { c.hasAfter = true; push("Bilde etter utbedring lagt til", "public"); }
    c.updated = now;
    return c;
  }

  function seed(nowMs) {
    const d = h => new Date(nowMs - h * 3600e3).toISOString();
    const st = (txt, h) => ({ t: d(h), txt, kind: "status" });
    const inn = (txt, h) => ({ t: d(h), txt, kind: "internal", by: "Demo" });
    const pub = (txt, h) => ({ t: d(h), txt, kind: "public", by: "Demo" });
    const mk = (id, cat, lat, lng, desc, status, h, x) => Object.assign({ id, cat, lat, lng, desc, contact: "", status, prio: "Normal",
      supplier: null, cost: null, follows: 0, hasPhoto: false, hasAfter: false, created: d(h), updated: d(h), resolvedAt: null,
      history: [st("Meldt inn", h)] }, x || {});
    return [
      mk("SK-1041", "gatelys", 59.2121, 9.6043, "Gatelyset blinker og slukker om kvelden", "Tildelt", 50, { supplier: "lys", prio: "Høy", follows: 4, updated: d(39),
        history: [st("Meldt inn", 50), inn("Prioritet satt til Høy", 40), inn("Tildelt Grenland Lys & Elektro AS", 39), st("Sendt til utfører", 39), pub("Elektriker er bestilt og kommer i løpet av uken.", 39)] }),
      mk("SK-1042", "vei", 59.2063, 9.6155, "Dypt hull ved fotgjengerovergangen", "Under behandling", 30, { follows: 7, updated: d(20),
        history: [st("Meldt inn", 30), st("Under behandling hos kommunen", 20), inn("Notat: Sjekk om dette er fylkesvei", 20)] }),
      mk("SK-1043", "soppel", 59.2100, 9.6000, "Full søppelkasse ved busstopp", "Mottatt", 5, { contact: "kari@example.no" }),
      mk("SK-1044", "vegetasjon", 59.2152, 9.6120, "Busker sperrer halve fortauet", "Utført", 90, { supplier: "park", cost: 3200, updated: d(10),
        history: [st("Meldt inn", 90), inn("Tildelt Skien Park & Renhold AS", 80), st("Sendt til utfører", 80), inn("Kostnad registrert: kr 3 200", 10), st("Arbeidet er utført – venter på kontroll", 10)] }),
      mk("SK-1045", "gatelys", 59.1405, 9.6565, "To lys ute i Storgata", "Løst", 200, { supplier: "lys", cost: 4800, follows: 2, updated: d(149), resolvedAt: d(149),
        history: [st("Meldt inn", 200), inn("Tildelt Grenland Lys & Elektro AS", 190), st("Sendt til utfører", 190), st("Arbeidet er utført – venter på kontroll", 150), st("Løst", 149), pub("Pærene er byttet. Takk for at du meldte fra!", 149)] }),
      mk("SK-1046", "skilt", 59.2080, 9.6080, "Benk i parken er knekt", "Mottatt", 2)
    ];
  }

  const api = { CATS, STATUSES, PRIOS, STATUS_PUBLIC_TEXT, DEFAULT_SETTINGS, merge, clone, dist, supplierName,
    publicSettings, visibleInList, publicView, createCase, applyUpdate, seed };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MeldInnCore = api;
})(typeof self !== "undefined" ? self : this);
