/* MeldInn Portal – felles kode.
   window.PORTAL_MODE = "super" (/admin, Entra-innlogging, alle organisasjoner)
                      | "org"   (/portal, brukernavn/passord, én organisasjon) */
(function () {
const C=MeldInnCore, S=MeldInnStore, ic=MeldInnIcon, cic=MeldInnCatIcon, tic=MeldInnTypeIcon;
const MODE=window.PORTAL_MODE==="org"?"org":"super", SUPER=MODE==="super";
S.portal=MODE;
const STATUS_COLORS={"Mottatt":"#5A6B78","Under behandling":"#18364A","Tildelt":"#0F626B","Utført":"#F97821","Løst":"#0F626B"};
const OKEY="meldinn_portal_org";
let ALL=[], SET=null, ME=null, USERS=[], ORG=SUPER?(localStorage.getItem(OKEY)||"all"):null, page="oversikt", sel=null, maps=[];
let F={status:"Åpne",cat:"",sup:"",q:"",sort:"created",dir:-1}, checked=new Set();
let $v;

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=iso=>{ if(!iso) return "–"; const d=new Date(iso); return d.toLocaleDateString("no-NO",{day:"2-digit",month:"2-digit",year:"2-digit"})+" "+d.toLocaleTimeString("no-NO",{hour:"2-digit",minute:"2-digit"}); };
const badge=s=>`<span class="badge st-${s.split(" ")[0]}">${s}</span>`;
const tOf=id=>C.tenantOf(SET,id);
const curT=()=>ORG==="all"?null:tOf(ORG);
const supName=c=>C.supplierName(tOf(c.tenant),c.supplier)||"–";
const scoped=()=>ORG==="all"?ALL:ALL.filter(c=>c.tenant===ORG);
const isOrgAdmin=()=>!SUPER&&ME&&ME.role==="admin";
const canSettings=()=>SUPER||isOrgAdmin();
const appLink=t=>t.type==="kommune"?`${location.origin}/?org=${t.id}`:`${location.origin}/?kode=${t.code}`;
const portalLink=t=>`${location.origin}/portal/?org=${t.id}`;
function toast(m,i){ const t=document.createElement("div"); t.className="toast"; t.innerHTML=ic(i||"check")+esc(m); document.body.appendChild(t); setTimeout(()=>t.remove(),3200); }
async function copy(txt,label){ try{ await navigator.clipboard.writeText(txt); }catch(e){ const a=document.createElement("textarea"); a.value=txt; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); } toast((label||"Kopiert")+" til utklippstavlen","copy"); }
function clearMaps(){ maps.forEach(m=>{try{m.remove()}catch(e){}}); maps=[]; }
function makeMap(el,center,zoom){
  if(typeof L==="undefined"){ document.getElementById(el).innerHTML='<div class="empty">Kartet krever nettilgang.</div>'; return null; }
  const m=L.map(el).setView(center,zoom); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(m);
  maps.push(m); setTimeout(()=>m.invalidateSize(),60); return m;
}
const pinIcon=c=>L.divIcon({className:"",html:`<div class="pin" style="background:${STATUS_COLORS[c.status]}"><i>${cic(c.cat)}</i></div>`,iconSize:[30,30],iconAnchor:[15,30]});
function shrink(file,max){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>{ const img=new Image(); img.onload=()=>{
  const s=Math.min(1,max/Math.max(img.width,img.height)); const cv=document.createElement("canvas"); cv.width=Math.round(img.width*s); cv.height=Math.round(img.height*s);
  cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height); res(cv.toDataURL("image/jpeg",0.75)); }; img.src=r.result; }; r.readAsDataURL(file); }); }
function handleAuthError(e){ if(!SUPER&&e&&e.status===401){ S.logout(); toast("Økten er utløpt – logg inn på nytt","lock"); setTimeout(()=>location.reload(),900); return true; } return false; }

/* ================= Rammeverk ================= */
function shell(){
  document.body.innerHTML=`<div class="layout">
    <div class="top">
      <img src="../icons/icon-192.png" alt="">
      <h1>MeldInn Portal</h1>
      ${SUPER?'<span class="role">Superbruker</span>':`<span class="orgname">${tic(tOf(ORG).type)} ${esc(tOf(ORG).name)}</span><span class="role">${esc(C.USER_ROLES[ME.role]||ME.role)}</span>`}
      <span class="sp"></span>
      ${SUPER?`<div class="orgsel" title="Velg organisasjon"><span id="orgic"></span><select id="org"></select></div>`:""}
      <div class="user" id="user"></div>
    </div>
    <nav class="side" id="side"></nav>
    <main class="main" id="view"></main></div>`;
  $v=document.getElementById("view");
  document.getElementById("user").innerHTML=(S.mode==="local"?'<span class="demo">DEMOMODUS</span>':"")+`<span>${ic("user")} ${esc(ME.name)}</span>`+
    (SUPER?(S.mode==="api"?`<a href="/.auth/logout?post_logout_redirect_uri=/admin/">${ic("logout")} Logg ut</a>`:"")
      :`<button class="lnk" id="pwBtn">${ic("key")} Bytt passord</button><button class="lnk" id="outBtn">${ic("logout")} Logg ut</button>`);
  if(SUPER){ const $org=document.getElementById("org");
    $org.onchange=()=>{ ORG=$org.value; localStorage.setItem(OKEY,ORG); sel=null; checked.clear(); F.cat=""; F.sup=""; render(); }; }
  else { document.getElementById("pwBtn").onclick=changePwModal;
    document.getElementById("outBtn").onclick=()=>{ S.logout(); location.reload(); }; }
}
function renderOrgSel(){
  if(!SUPER) return;
  const $org=document.getElementById("org");
  $org.innerHTML=`<option value="all">Alle organisasjoner (${SET.tenants.length})</option>`+
    Object.entries(C.TYPES).map(([k,l])=>{ const ts=SET.tenants.filter(t=>t.type===k); return ts.length?`<optgroup label="${l}">${ts.map(t=>`<option value="${t.id}">${esc(t.name)}${t.active?"":" (inaktiv)"}</option>`).join("")}</optgroup>`:""; }).join("");
  $org.value=ORG; document.getElementById("orgic").innerHTML=curT()?tic(curT().type):ic("grid");
}
function setOrg(id,p){ ORG=id; if(SUPER) localStorage.setItem(OKEY,ORG); sel=null; checked.clear(); if(p) page=p; render(); }
function navItems(){
  const nye=scoped().filter(c=>c.status==="Mottatt").length;
  const it=[["oversikt","Oversikt","grid"],["saker","Saker","list",nye],["kart","Kart","map"]];
  if(canSettings()) it.push(["SEP","Innstillinger"],["synlighet","Innbyggervisning","eye"],["leverandorer","Leverandører & ruting","wrench"]);
  if(SUPER) it.push(["organisasjoner","Organisasjoner","building"],["brukere","Brukere","users"]);
  return it;
}
function renderSide(){
  const items=navItems();
  if(!items.some(([k])=>k===page)) page="oversikt";
  document.getElementById("side").innerHTML=items.map(([k,l,i,n])=>k==="SEP"?`<div class="sep">${l}</div>`:`<button data-k="${k}" class="${k===page?"on":""}">${ic(i)} ${l}${n?`<span class="cnt">${n}</span>`:""}</button>`).join("")+
    `<div class="foot">${S.mode==="api"?"Tilkoblet database":"Demomodus – data lagres kun i denne nettleseren"}${SUPER?`<br><br><button class="btn ghost" id="demoBtn" style="width:100%">${ic("refresh")} ${S.mode==="api"?"Last inn demodata":"Nullstill demodata"}</button>`:""}</div>`;
  document.querySelectorAll(".side [data-k]").forEach(b=>b.onclick=()=>{page=b.dataset.k; sel=null; render();});
  document.getElementById("demoBtn")?.addEventListener("click",async()=>{ if(!confirm(S.mode==="api"?"Legge inn demo-organisasjoner og demosaker? Eksisterende data beholdes.":"Nullstille alle demosaker, organisasjoner og brukere?")) return; await S.loadDemo(); await reload(); toast("Demodata lastet"); });
}
async function reload(){
  try{
    const r=await Promise.all([S.listAll(),S.settings(),SUPER?S.users():Promise.resolve([])]);
    ALL=r[0]; SET=r[1]; USERS=r[2];
  }catch(e){ if(handleAuthError(e)) return; throw e; }
  if(SUPER&&ORG!=="all"&&!tOf(ORG)) ORG="all";
  render();
}
function render(){ clearMaps(); renderOrgSel(); renderSide(); ({oversikt:pOversikt,saker:pSaker,kart:pKart,synlighet:pSynlighet,leverandorer:pLev,organisasjoner:pOrg,brukere:pUsers})[page](); }
function needOrg(title){
  $v.innerHTML=`<h2>${title}</h2><p class="sub">Denne innstillingen gjelder én organisasjon om gangen.</p>
    <div class="pick">${ic("info")} Velg organisasjon:${SET.tenants.map(t=>`<button class="btn ghost" data-o="${t.id}">${tic(t.type)} ${esc(t.name)}</button>`).join("")}</div>`;
  $v.querySelectorAll("[data-o]").forEach(b=>b.onclick=()=>setOrg(b.dataset.o));
}
function modal(html,onMount){
  const bg=document.createElement("div"); bg.className="modal-bg"; bg.innerHTML=`<div class="modal">${html}</div>`;
  document.body.appendChild(bg); const close=()=>bg.remove(); bg.onclick=e=>{ if(e.target===bg) close(); };
  onMount(bg,close);
}
function changePwModal(){
  modal(`<h3>${ic("key")} Bytt passord</h3><div class="form">
    <label class="full">Nåværende passord<input type="password" id="p0" autocomplete="current-password"></label>
    <label class="full">Nytt passord (minst 8 tegn)<input type="password" id="p1" autocomplete="new-password"></label>
    <label class="full">Gjenta nytt passord<input type="password" id="p2" autocomplete="new-password"></label></div>
    <div class="warn" id="pe" style="display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="pc">Avbryt</button><button class="btn o" id="ps">${ic("check")} Lagre</button></div>`,(bg,close)=>{
    bg.querySelector("#pc").onclick=close;
    bg.querySelector("#ps").onclick=async()=>{ const e=bg.querySelector("#pe"), p1=bg.querySelector("#p1").value;
      if(p1!==bg.querySelector("#p2").value){ e.style.display="block"; e.textContent="Passordene er ikke like."; return; }
      try{ await S.changePassword(bg.querySelector("#p0").value,p1); close(); toast("Passordet er endret"); }
      catch(x){ e.style.display="block"; e.textContent=x.message; } };
  });
}

/* ================= Oversikt ================= */
function shareBox(t){
  return `<div class="share">${t.type==="kommune"
    ?`<div>${ic("link")} <b>Direktelenke til appen</b><br><span class="sub" style="margin:4px 0 0">Kommuner er åpne i appen. Lenken åpner appen med ${esc(t.name)} valgt.</span></div><code>${esc(appLink(t))}</code><button class="btn ghost sm" data-copy="${esc(appLink(t))}">${ic("copy")} Kopier</button>`
    :`<div>${ic("ticket")} <b>Kode for appen</b><br><span class="sub" style="margin:4px 0 0">Del med beboere/ansatte, f.eks. på oppslag eller QR-kode.</span></div><span class="big">${esc(t.code)}</span>
      <button class="btn ghost sm" data-copy="${esc(t.code)}">${ic("copy")} Kopier kode</button><button class="btn ghost sm" data-copy="${esc(appLink(t))}">${ic("link")} Kopier lenke</button>`}</div>`;
}
function bindCopy(root){ (root||$v).querySelectorAll("[data-copy]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); copy(b.dataset.copy); }); }
function pOversikt(){
  const ts=ORG==="all"?SET.tenants:[curT()];
  const cnt=(l,s)=>l.filter(c=>c.status===s).length;
  const sc=scoped();
  $v.innerHTML=`<h2>Oversikt</h2><p class="sub">${ORG==="all"?"Alle organisasjoner som bruker MeldInn. Klikk på et kort for å åpne sakene.":esc(curT().name)}</p>
  <div class="kpis">
    <div class="kpi o"><b>${cnt(sc,"Mottatt")}</b><span>Nye – ikke behandlet</span></div>
    <div class="kpi m"><b>${cnt(sc,"Under behandling")}</b><span>Under behandling</span></div>
    <div class="kpi"><b>${cnt(sc,"Tildelt")}</b><span>Hos leverandør</span></div>
    <div class="kpi o"><b>${cnt(sc,"Utført")}</b><span>Venter på godkjenning</span></div>
    <div class="kpi"><b>${cnt(sc,"Løst")}</b><span>Løst</span></div>
    <div class="kpi m"><b>${sc.filter(c=>c.prio==="Høy"&&c.status!=="Løst").length}</b><span>Åpne med høy prioritet</span></div>
  </div>
  ${!SUPER?shareBox(curT()):""}
  ${SUPER?`<div class="orgcards">${ts.map(t=>{ const l=ALL.filter(c=>c.tenant===t.id), nu=USERS.filter(u=>u.tenant===t.id).length;
    return `<button class="oc ${t.active?"":"off"}" data-o="${t.id}"><div class="h"><span class="ti">${tic(t.type)}</span>${esc(t.name)}</div><div class="t">${C.TYPES[t.type]}${t.active?"":" · skjult i appen"} · ${t.prefix}- · ${nu} bruker${nu===1?"":"e"}${t.code?` · <b>${t.code}</b>`:""}</div>
      <div class="n"><div class="hot"><b>${cnt(l,"Mottatt")}</b>nye</div><div><b>${l.filter(c=>c.status!=="Løst").length}</b>åpne</div><div class="hot"><b>${cnt(l,"Utført")}</b>til godkj.</div><div><b>${cnt(l,"Løst")}</b>løst</div></div></button>`; }).join("")}
    ${ORG==="all"?`<button class="oc" id="newOrg" style="display:flex;align-items:center;justify-content:center;gap:8px;color:var(--petrol);font-weight:700;border:2px dashed var(--petrol-line)">${ic("plus")} Ny organisasjon</button>`:""}</div>`:""}
  <h3>${ic("alert")} Krever handling</h3>
  <div class="tablewrap">${table(sc.filter(c=>c.status==="Mottatt"||c.status==="Utført"||(c.prio==="Høy"&&c.status!=="Løst")).sort((a,b)=>b.created.localeCompare(a.created)),false)}</div>`;
  $v.querySelectorAll(".oc[data-o]").forEach(b=>b.onclick=()=>{ F.status="Åpne"; setOrg(b.dataset.o,"saker"); });
  document.getElementById("newOrg")?.addEventListener("click",()=>{ page="organisasjoner"; sel="org:__new"; render(); });
  $v.querySelectorAll("tr.r").forEach(r=>r.onclick=()=>{ sel=r.dataset.id; F.status="Alle"; page="saker"; render(); });
  bindCopy();
}
function table(l,withChecks){
  if(!l.length) return '<div class="empty">Ingen saker.</div>';
  const cols=[["id","ID"],...(ORG==="all"?[["tenant","Organisasjon"]]:[]),["cat","Kategori"],["desc","Beskrivelse"],["status","Status"],["prio","Prioritet"],["supplier","Leverandør"],["created","Meldt"],["follows","Følgere"]];
  return `<table><thead><tr>${withChecks?`<th style="width:30px"><input type="checkbox" id="all" ${l.every(c=>checked.has(c.id))?"checked":""}></th>`:""}
    ${cols.map(([k,n])=>`<th data-sort="${k}">${n}${withChecks&&F.sort===k?(F.dir>0?" ▲":" ▼"):""}</th>`).join("")}</tr></thead><tbody>${l.map(c=>{ const t=tOf(c.tenant);
    return `<tr class="r ${sel===c.id?"sel":""}" data-id="${c.id}">${withChecks?`<td><input type="checkbox" class="ck" data-id="${c.id}" ${checked.has(c.id)?"checked":""}></td>`:""}
      <td><b>${c.id}</b></td>${ORG==="all"?`<td><span class="org">${t?tic(t.type):""} ${esc(t?t.name:c.tenant)}</span></td>`:""}<td><span class="cat">${cic(c.cat)} ${esc(C.CATALOG[c.cat]||c.cat)}</span></td>
      <td class="desc" title="${esc(c.desc)}">${esc(c.desc)}</td><td>${badge(c.status)}</td><td class="pri-${c.prio}">${c.prio}</td><td>${esc(supName(c))}</td><td>${fmt(c.created)}</td><td>${c.follows||0}</td></tr>`; }).join("")}</tbody></table>`;
}

/* ================= Saker ================= */
function filtered(){
  const q=F.q.toLowerCase(), pr={"Høy":0,"Normal":1,"Lav":2};
  let l=scoped().filter(c=>(F.status==="Alle"||(F.status==="Åpne"?c.status!=="Løst":c.status===F.status))
    &&(!F.cat||c.cat===F.cat)&&(!F.sup||(F.sup==="none"?!c.supplier:c.supplier===F.sup))
    &&(!q||[c.id,c.desc,C.CATALOG[c.cat],supName(c),c.contact,(tOf(c.tenant)||{}).name].join(" ").toLowerCase().includes(q)));
  l.sort((a,b)=>{ let x=a[F.sort],y=b[F.sort]; if(F.sort==="prio"){x=pr[x];y=pr[y];} if(F.sort==="supplier"){x=supName(a);y=supName(b);} if(F.sort==="tenant"){x=(tOf(x)||{}).name;y=(tOf(y)||{}).name;}
    return (x>y?1:x<y?-1:0)*F.dir; });
  return l;
}
function pSaker(){
  const t=curT(), l=filtered();
  const catKeys=t?t.cats:Object.keys(C.CATALOG).filter(k=>ALL.some(c=>c.cat===k));
  const sups=t?t.suppliers:[];
  $v.innerHTML=`<h2>Saker</h2><p class="sub">${t?esc(t.name):"Alle organisasjoner"} · ${l.length} saker i utvalget</p>
  <div class="bar">${["Åpne",...C.STATUSES,"Alle"].map(s=>`<button class="chip ${F.status===s?"on":""}" data-st="${s}">${s}</button>`).join("")}</div>
  <div class="bar">
    <div class="search">${ic("search")}<input id="q" placeholder="Søk i ID, beskrivelse, kontakt…" value="${esc(F.q)}"></div>
    <select id="fc"><option value="">Alle kategorier</option>${catKeys.map(k=>`<option value="${k}" ${F.cat===k?"selected":""}>${C.CATALOG[k]}</option>`).join("")}</select>
    ${t?`<select id="fs"><option value="">Alle leverandører</option><option value="none" ${F.sup==="none"?"selected":""}>Ikke tildelt</option>${sups.map(s=>`<option value="${s.id}" ${F.sup===s.id?"selected":""}>${esc(s.n)}</option>`).join("")}</select>`:""}
    <span style="flex:1"></span>
    <button class="btn ghost" id="csv">${ic("fileDown")} Eksporter CSV</button>
    <button class="btn ghost" id="rf">${ic("refresh")} Oppdater</button>
  </div>
  <div class="bulk ${checked.size?"show":""}"><b>${checked.size} valgt</b>
    <select id="bs"><option value="">Sett status…</option>${C.STATUSES.map(s=>`<option>${s}</option>`).join("")}</select>
    ${t?`<select id="bl"><option value="">Tildel leverandør…</option>${sups.map(s=>`<option value="${s.id}">${esc(s.n)}</option>`).join("")}</select>`:`<span style="opacity:.8;font-size:12px">Velg én organisasjon for å tildele leverandør</span>`}
    <select id="bp"><option value="">Sett prioritet…</option>${C.PRIOS.map(s=>`<option>${s}</option>`).join("")}</select>
    <button class="btn o" id="bgo">Utfør</button><button class="btn m" id="bx">Fjern valg</button></div>
  <div class="split ${sel?"":"nodetail"}"><div class="tablewrap">${table(l,true)}</div>${sel?`<div class="panel" id="panel"></div>`:""}</div>`;
  $v.querySelectorAll("[data-st]").forEach(b=>b.onclick=()=>{F.status=b.dataset.st;pSaker();});
  const q=document.getElementById("q"); q.oninput=()=>{F.q=q.value; clearTimeout(q._t); q._t=setTimeout(()=>{pSaker(); const n=document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length,n.value.length);},250);};
  document.getElementById("fc").onchange=e=>{F.cat=e.target.value;pSaker();};
  document.getElementById("fs")?.addEventListener("change",e=>{F.sup=e.target.value;pSaker();});
  document.getElementById("rf").onclick=async()=>{await reload(); toast("Oppdatert");};
  document.getElementById("csv").onclick=()=>exportCsv(l);
  $v.querySelectorAll("th[data-sort]").forEach(h=>h.onclick=()=>{ const k=h.dataset.sort; F.dir=F.sort===k?-F.dir:1; F.sort=k; pSaker(); });
  $v.querySelectorAll("tr.r").forEach(r=>r.onclick=e=>{ if(e.target.type==="checkbox") return; sel=r.dataset.id; pSaker(); });
  $v.querySelectorAll(".ck").forEach(b=>b.onchange=()=>{ b.checked?checked.add(b.dataset.id):checked.delete(b.dataset.id); pSaker(); });
  const all=document.getElementById("all"); if(all) all.onchange=()=>{ l.forEach(c=>all.checked?checked.add(c.id):checked.delete(c.id)); pSaker(); };
  document.getElementById("bx").onclick=()=>{checked.clear();pSaker();};
  document.getElementById("bgo").onclick=async()=>{
    const p={}, s=document.getElementById("bs").value, l2=document.getElementById("bl")?.value, pr=document.getElementById("bp").value;
    if(s)p.status=s; if(l2)p.supplier=l2; if(pr)p.prio=pr; if(!Object.keys(p).length) return toast("Velg en handling","info");
    try{ for(const id of checked) await S.update(id,Object.assign({},p),ME.name); }catch(e){ if(!handleAuthError(e)) toast(e.message,"info"); return; }
    toast(`Oppdaterte ${checked.size} saker`); checked.clear(); await reload();
  };
  if(sel) renderPanel();
}
function exportCsv(l){
  const head=["ID","Organisasjon","Kategori","Beskrivelse","Status","Prioritet","Leverandør","Kostnad","Meldt","Løst","Følgere","Kontakt","Lat","Lng"];
  const rows=l.map(c=>[c.id,(tOf(c.tenant)||{}).name||c.tenant,C.CATALOG[c.cat]||c.cat,c.desc,c.status,c.prio,supName(c),c.cost||"",c.created,c.resolvedAt||"",c.follows||0,c.contact||"",c.lat,c.lng]);
  const csv="\uFEFF"+[head,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\r\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="meldinn-saker.csv"; a.click();
}
function renderPanel(){
  const c=ALL.find(x=>x.id===sel), P=document.getElementById("panel"); if(!c){sel=null;return pSaker();}
  const t=tOf(c.tenant)||{suppliers:[],name:c.tenant,type:""}, sp=t.suppliers.find(s=>s.id===c.supplier);
  const before=c.hasPhoto?S.photoUrl(c.id,"before"):"", after=c.hasAfter?S.photoUrl(c.id,"after"):"";
  P.innerHTML=`<div class="hd">${cic(c.cat)}<h3>${c.id} · ${esc(C.CATALOG[c.cat]||c.cat)}</h3>${badge(c.status)}<button class="x" id="cl" title="Lukk">${ic("x")}</button></div>
    ${SUPER?`<div class="org" style="color:var(--marine-muted);margin-bottom:8px">${tic(t.type)} ${esc(t.name)}</div>`:""}
    <div>${esc(c.desc)}</div>
    ${before||after?`<div class="photos">${before?`<figure><a href="${before}" target="_blank"><img src="${before}" alt=""></a><figcaption>Fra innmelder</figcaption></figure>`:""}${after?`<figure><a href="${after}" target="_blank"><img src="${after}" alt=""></a><figcaption>Etter utbedring</figcaption></figure>`:""}</div>`:""}
    <div id="minimap"></div>
    <dl class="kv"><dt>Meldt</dt><dd>${fmt(c.created)}</dd><dt>Sist endret</dt><dd>${fmt(c.updated)}</dd>
      <dt>Kontakt</dt><dd>${c.contact?esc(c.contact):'<span style="color:var(--marine-muted)">Ikke oppgitt</span>'}</dd>
      <dt>Følgere</dt><dd>${c.follows||0}</dd><dt>Posisjon</dt><dd><a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</a></dd></dl>
    ${c.status==="Utført"?`<div class="warn" style="display:flex;gap:8px;align-items:center;justify-content:space-between">Leverandør har meldt jobben utført.<span><button class="btn" id="ok">${ic("checkCircle")} Godkjenn</button> <button class="btn ghost" id="rej">${ic("undo")} Avvis</button></span></div>`:""}
    <div class="sec"><h3>Behandle</h3>
    <div class="form">
      <label>Status<select id="st">${C.STATUSES.map(s=>`<option ${s===c.status?"selected":""}>${s}</option>`).join("")}</select></label>
      <label>Prioritet<select id="pr">${C.PRIOS.map(s=>`<option ${s===c.prio?"selected":""}>${s}</option>`).join("")}</select></label>
      <label class="full">Leverandør<select id="su"><option value="">– Ikke tildelt –</option>${t.suppliers.map(s=>`<option value="${s.id}" ${s.id===c.supplier?"selected":""}>${esc(s.n)}${s.cats.includes(c.cat)?" (avtale for kategorien)":""}</option>`).join("")}</select></label>
      <label>Kostnad (kr)<input type="number" id="co" min="0" value="${c.cost??""}"></label>
      <label>Fullmakt<input type="text" disabled value="${sp?"inntil kr "+sp.ramme.toLocaleString("no-NO"):"–"}"></label>
      <div class="full warn" id="over" style="display:none">Kostnaden er over leverandørens fullmakt.</div>
      <label class="full">Melding til innmelder (vises i appen)<textarea id="pm" placeholder="F.eks. «Vaktmester kommer onsdag.»"></textarea></label>
      <label class="full">Internt notat (vises ikke i appen)<textarea id="in" placeholder="Kun synlig i portalen"></textarea></label>
      <label class="full">Bilde etter utbedring<input type="file" id="af" accept="image/*"></label>
    </div>
    <button class="btn o" id="save" style="width:100%;justify-content:center">${ic("check")} Lagre endringer</button></div>
    <div class="sec"><h3>Historikk</h3><ul class="hist">${c.history.slice().reverse().map(h=>`<li class="${h.kind}">${esc(h.txt)}<span class="tag ${h.kind}">${{status:"Status",public:"Til innmelder",internal:"Intern"}[h.kind]}</span><small>${fmt(h.t)}${h.by?" · "+esc(h.by):""}</small></li>`).join("")}</ul></div>`;
  document.getElementById("cl").onclick=()=>{sel=null;pSaker();};
  const co=document.getElementById("co"), su=document.getElementById("su");
  const chk=()=>{ const s=t.suppliers.find(x=>x.id===su.value); document.getElementById("over").style.display=s&&+co.value>s.ramme?"block":"none"; };
  co.oninput=chk; su.onchange=chk; chk();
  const m=makeMap("minimap",[c.lat,c.lng],16); if(m) L.marker([c.lat,c.lng],{icon:pinIcon(c)}).addTo(m);
  const save=async(extra)=>{
    const p=Object.assign({status:document.getElementById("st").value,prio:document.getElementById("pr").value,supplier:su.value||null,
      cost:co.value===""?undefined:+co.value,publicMessage:document.getElementById("pm").value,internalNote:document.getElementById("in").value},extra||{});
    const f=document.getElementById("af").files[0]; if(f) p.afterPhoto=await shrink(f,1200);
    if(p.status===c.status) delete p.status;
    try{ await S.update(c.id,p,ME.name); }catch(e){ if(!handleAuthError(e)) toast(e.message,"info"); return; }
    toast("Lagret"); await reload();
  };
  document.getElementById("save").onclick=()=>save();
  document.getElementById("ok")?.addEventListener("click",()=>save({status:"Løst"}));
  document.getElementById("rej")?.addEventListener("click",()=>save({status:"Tildelt",internalNote:"Sendt tilbake til leverandør"}));
}

/* ================= Kart ================= */
function pKart(){
  const t=curT();
  $v.innerHTML=`<h2>Kart – åpne saker</h2><p class="sub">${t?esc(t.name):"Alle organisasjoner"}</p><div id="bigmap"></div>`;
  const open=scoped().filter(c=>c.status!=="Løst");
  const m=makeMap("bigmap",t?t.center:SET.tenants[0].center,t?14:11); if(!m) return;
  open.forEach(c=>L.marker([c.lat,c.lng],{icon:pinIcon(c)}).addTo(m)
    .bindTooltip(`${c.id} · ${C.CATALOG[c.cat]} · ${c.status}`).on("click",()=>{sel=c.id;page="saker";F.status="Alle";render();}));
  if(!t&&open.length>1) m.fitBounds(open.map(c=>[c.lat,c.lng]),{padding:[40,40]});
}

/* ================= Innbyggervisning (per organisasjon) ================= */
const VIS_OPTS=[
  ["showOthers","Vis andres saker","Brukere ser alle meldte saker på kart og kan følge dem. Hindrer dobbeltmeldinger."],
  ["showDescription","Vis beskrivelse","Teksten innmelderen skrev."],
  ["showPhotos","Vis innsendte bilder","Bilder kan inneholde personer eller bilskilt."],
  ["showAfterPhoto","Vis bilde etter utbedring",""],
  ["showSupplier","Vis leverandørnavn",""],
  ["showFollowers","Vis antall følgere",""],
  ["showPriority","Vis prioritet",""],
  ["showCost","Vis kostnad","Normalt av."],
  ["exactLocation","Vis nøyaktig posisjon","Av = posisjon avrundes til ca. 100 m."]
];
async function saveTenant(t){ const n=C.clone(SET); n.tenants=n.tenants.map(x=>x.id===t.id?t:x); SET=await S.saveSettings(n); }
function pSynlighet(){
  const t0=curT(); if(!t0) return needOrg("Innbyggervisning");
  const v=t0.visibility;
  $v.innerHTML=`<h2>Innbyggervisning</h2><p class="sub">${tic(t0.type)} ${esc(t0.name)} · Hva brukerne ser i appen. Kontaktinfo og interne notater vises aldri.</p>
  <div class="cards"><div class="card">
    ${VIS_OPTS.map(([k,n,d])=>`<div class="tg"><div class="t"><b>${n}</b>${d?`<span>${d}</span>`:""}</div><label class="switch"><input type="checkbox" data-v="${k}" ${v[k]?"checked":""}><i></i></label></div>`).join("")}
    <div class="tg"><div class="t"><b>Historikk</b><span>Hva brukeren ser av saksforløpet</span></div>
      <select id="hm"><option value="full" ${v.historyMode==="full"?"selected":""}>Status + meldinger</option><option value="status" ${v.historyMode==="status"?"selected":""}>Kun statusendringer</option></select></div>
    <div class="tg"><div class="t"><b>Skjul løste saker etter</b><span>Fra kart og liste. Egne saker vises fortsatt.</span></div>
      <input type="number" id="hd" min="0" style="width:80px" value="${v.hideResolvedAfterDays}"> dager</div>
    <div style="margin-top:12px"><button class="btn o" id="sv">${ic("check")} Lagre</button></div>
  </div>
  <div class="card"><h3>${ic("eye")} Forhåndsvisning – slik ser brukeren en sak</h3><div class="preview" id="pv"></div></div></div>`;
  const read=()=>{ const n=C.clone(t0); $v.querySelectorAll("[data-v]").forEach(i=>n.visibility[i.dataset.v]=i.checked);
    n.visibility.historyMode=document.getElementById("hm").value; n.visibility.hideResolvedAfterDays=Math.max(0,+document.getElementById("hd").value||0); return n; };
  const prev=()=>{ const n=read(), mine=ALL.filter(c=>c.tenant===n.id), sample=mine.find(c=>c.history.length>2)||mine[0], pv=document.getElementById("pv");
    if(!sample){pv.innerHTML="Ingen saker å vise for denne organisasjonen.";return;} const p=C.publicView(sample,n);
    pv.innerHTML=`<div class="pc"><div style="display:flex;justify-content:space-between"><b>${p.id} · ${esc(p.catName)}</b>${badge(p.status)}</div>
      ${p.desc?`<p>${esc(p.desc)}</p>`:'<p style="color:var(--marine-muted)"><i>Beskrivelse skjult</i></p>'}
      <dl class="kv"><dt>Mottaker</dt><dd>${esc(p.tenantName)}</dd>${p.supplier?`<dt>Utføres av</dt><dd>${esc(p.supplier)}</dd>`:""}${p.prio?`<dt>Prioritet</dt><dd>${p.prio}</dd>`:""}${p.cost?`<dt>Kostnad</dt><dd>kr ${p.cost.toLocaleString("no-NO")}</dd>`:""}${p.follows!==undefined?`<dt>Følgere</dt><dd>${p.follows}</dd>`:""}<dt>Posisjon</dt><dd>${p.lat}, ${p.lng}</dd></dl>
      <ul class="hist">${p.history.slice().reverse().map(h=>`<li class="${h.kind}">${esc(h.txt)}<small>${fmt(h.t)}</small></li>`).join("")}</ul></div>
      <p style="color:var(--marine-muted);margin:8px 0 0">Skjult for bruker: ${(sample.history.length-p.history.length)} interne historikkpunkter${sample.contact?", kontaktinfo":""}.</p>`; };
  $v.querySelectorAll("input,select").forEach(i=>i.addEventListener("change",prev)); prev();
  document.getElementById("sv").onclick=async()=>{ try{ await saveTenant(read()); toast("Innbyggervisning lagret"); }catch(e){ if(!handleAuthError(e)) toast(e.message,"info"); } };
}

/* ================= Leverandører (per organisasjon) ================= */
function pLev(){
  const t0=curT(); if(!t0) return needOrg("Leverandører & ruting");
  const t=C.clone(t0), sups=t.suppliers;
  const draw=()=>{
    $v.innerHTML=`<h2>Leverandører & ruting</h2><p class="sub">${tic(t.type)} ${esc(t.name)}</p>
    <div class="card" style="margin-bottom:16px">
      <div class="tg"><div class="t"><b>Automatisk ruting</b><span>Nye meldinger går rett til leverandør med avtale for kategorien (merket «Auto»).</span></div>
        <label class="switch"><input type="checkbox" id="ar" ${t.autoroute?"checked":""}><i></i></label></div>
    </div>
    <div class="card"><div class="sup" style="font-weight:700;color:var(--marine-muted)"><span>Navn</span><span>Kategorier</span><span>Fullmakt (kr)</span><span>Auto</span><span></span></div>
      ${sups.map((s,i)=>`<div class="sup" data-i="${i}">
        <input type="text" class="sn" value="${esc(s.n)}">
        <div class="cats">${t.cats.map(k=>`<label><input type="checkbox" class="sc" value="${k}" ${s.cats.includes(k)?"checked":""}>${C.CATALOG[k]}</label>`).join("")}</div>
        <input type="number" class="sr" min="0" value="${s.ramme}">
        <label class="switch"><input type="checkbox" class="sa" ${s.auto?"checked":""}><i></i></label>
        <button class="btn ghost sd" title="Fjern" style="padding:6px">${ic("x")}</button></div>`).join("")||'<div class="empty">Ingen leverandører ennå.</div>'}
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" id="add">${ic("plus")} Legg til leverandør</button><span style="flex:1"></span><button class="btn o" id="sv">${ic("check")} Lagre</button></div>
    </div>`;
    const sync=()=>{ t.autoroute=document.getElementById("ar").checked; $v.querySelectorAll(".sup[data-i]").forEach(r=>{ const s=sups[+r.dataset.i];
      s.n=r.querySelector(".sn").value.trim(); s.ramme=+r.querySelector(".sr").value||0; s.auto=r.querySelector(".sa").checked;
      s.cats=[...r.querySelectorAll(".sc:checked")].map(x=>x.value); }); };
    $v.querySelectorAll(".sd").forEach(b=>b.onclick=()=>{ sync(); const i=+b.closest(".sup").dataset.i;
      if(ALL.some(c=>c.tenant===t.id&&c.supplier===sups[i].id&&c.status!=="Løst")&&!confirm("Leverandøren har åpne saker. Fjerne likevel?")) return; sups.splice(i,1); draw(); });
    document.getElementById("add").onclick=()=>{ sync(); sups.push({id:"lev"+Date.now().toString(36),n:"Ny leverandør",cats:[],ramme:10000,auto:false}); draw(); };
    document.getElementById("sv").onclick=async()=>{ sync(); t.suppliers=sups.filter(s=>s.n); try{ await saveTenant(t); toast("Lagret"); }catch(e){ if(!handleAuthError(e)) toast(e.message,"info"); } };
  };
  draw();
}

/* ================= Organisasjoner (superbruker) ================= */
function pOrg(){
  $v.innerHTML=`<h2>Organisasjoner</h2><p class="sub">Kommuner vises åpent i appen. Borettslag, sameier og bedrifter legges til i appen med kode.</p>
  <div class="split ${sel&&sel.startsWith("org:")?"":"nodetail"}"><div class="tablewrap"><table><thead><tr><th>Navn</th><th>Type</th><th>Prefiks</th><th>I appen</th><th>Kode</th><th>Brukere</th><th>Saker</th></tr></thead><tbody>
    ${SET.tenants.map(t=>`<tr class="r ${sel==="org:"+t.id?"sel":""}" data-t="${t.id}"><td><span class="org">${tic(t.type)} <b>${esc(t.name)}</b></span></td><td>${C.TYPES[t.type]}</td><td>${t.prefix}-</td>
      <td>${!t.active?"<span style='color:var(--err)'>Skjult</span>":t.type==="kommune"?"Åpen liste":"Med kode"}</td><td>${t.code?`<code>${t.code}</code>`:"–"}</td>
      <td>${USERS.filter(u=>u.tenant===t.id).length}</td><td>${ALL.filter(c=>c.tenant===t.id).length}</td></tr>`).join("")}</tbody></table>
    <div style="padding:12px"><button class="btn o" id="addOrg">${ic("plus")} Ny organisasjon</button></div></div>
    ${sel&&sel.startsWith("org:")?`<div class="panel" id="opanel"></div>`:""}</div>`;
  $v.querySelectorAll("tr.r").forEach(r=>r.onclick=()=>{ sel="org:"+r.dataset.t; pOrg(); });
  document.getElementById("addOrg").onclick=()=>{ sel="org:__new"; pOrg(); };
  if(sel&&sel.startsWith("org:")) orgPanel(sel.slice(4));
}
function orgPanel(id){
  const isNew=id==="__new";
  const t=isNew?Object.assign(C.normalizeSettings({tenants:[{id:"ny",name:"",type:"borettslag",cats:["fellesareal","soppel","annet"]}]}).tenants[0],{id:"",prefix:""}):C.clone(tOf(id));
  const P=document.getElementById("opanel");
  const draw=()=>{
    const hasCode=t.type!=="kommune";
    P.innerHTML=`<div class="hd"><h3>${isNew?"Ny organisasjon":esc(t.name)}</h3><button class="x" id="cl">${ic("x")}</button></div>
    <div class="form">
      <label class="full">Navn<input type="text" id="on" value="${esc(t.name)}" placeholder="F.eks. Borettslaget Solsiden"></label>
      <label>Type<select id="ot">${Object.entries(C.TYPES).map(([k,l])=>`<option value="${k}" ${t.type===k?"selected":""}>${l}</option>`).join("")}</select></label>
      <label>Saksprefiks<input type="text" id="op" maxlength="4" value="${esc(t.prefix)}" placeholder="F.eks. SO"></label>
      <label>ID (brukes i lenker)<input type="text" id="oi" value="${esc(t.id)}" ${isNew?"":"disabled"} placeholder="f.eks. solsiden"></label>
      <label>Aktiv<span style="padding-top:6px"><label class="switch"><input type="checkbox" id="oa" ${t.active?"checked":""}><i></i></label></span></label>
      ${hasCode?`<label class="full">Kode for appen<span class="inrow"><input type="text" id="oc" value="${esc(t.code||"")}" readonly style="font-family:ui-monospace,Consolas,monospace;font-weight:700;letter-spacing:2px">
        <button class="btn ghost sm" id="newCode" title="Lag ny kode">${ic("refresh")} Ny kode</button>${t.code?`<button class="btn ghost sm" data-copy="${esc(t.code)}">${ic("copy")}</button>`:""}</span>
        <span style="font-weight:400">${isNew?"Lages automatisk når du oppretter.":"Ny kode gjør at gammel kode slutter å virke – også i apper som allerede har lagt den til."}</span></label>`
        :`<div class="full okbox" style="margin:0">${ic("info")} Kommuner vises i den åpne listen i appen og trenger ingen kode.</div>`}
      <label>Kartsenter breddegrad<input type="number" step="0.0001" id="olat" value="${t.center[0]}"></label>
      <label>Kartsenter lengdegrad<input type="number" step="0.0001" id="olng" value="${t.center[1]}"></label>
      <label class="full">Kategorier brukeren kan velge<div class="cats">${Object.entries(C.CATALOG).map(([k,n])=>`<label class="big"><input type="checkbox" class="oc2" value="${k}" ${t.cats.includes(k)?"checked":""}>${cic(k)} ${n}</label>`).join("")}</div></label>
    </div>
    ${isNew?"":`<div class="sec"><h3>${ic("link")} Lenker</h3><dl class="kv">
      <dt>App</dt><dd><code>${esc(appLink(t))}</code> <button class="btn ghost sm" data-copy="${esc(appLink(t))}">${ic("copy")}</button></dd>
      <dt>Portal</dt><dd><code>${esc(portalLink(t))}</code> <button class="btn ghost sm" data-copy="${esc(portalLink(t))}">${ic("copy")}</button></dd>
      <dt>Brukere</dt><dd>${USERS.filter(u=>u.tenant===t.id).length} <button class="btn ghost sm" id="goUsers">${ic("users")} Administrer</button></dd></dl></div>`}
    <button class="btn o" id="osv" style="width:100%;justify-content:center;margin-top:10px">${ic("check")} ${isNew?"Opprett":"Lagre"}</button>`;
    bindCopy(P);
    const rd=()=>{ t.name=document.getElementById("on").value; t.type=document.getElementById("ot").value; t.prefix=document.getElementById("op").value.trim().toUpperCase();
      if(isNew) t.id=document.getElementById("oi").value.trim(); t.active=document.getElementById("oa").checked;
      t.center=[+document.getElementById("olat").value||59.2,+document.getElementById("olng").value||9.6]; t.cats=[...P.querySelectorAll(".oc2:checked")].map(x=>x.value); };
    document.getElementById("cl").onclick=()=>{sel=null;pOrg();};
    document.getElementById("ot").onchange=()=>{ rd(); if(t.type!=="kommune"&&!t.code&&!isNew) t.code=C.genCode(); draw(); };
    document.getElementById("newCode")?.addEventListener("click",e=>{ e.preventDefault(); if(isNew) return toast("Koden lages når du oppretter","info");
      if(!confirm("Lage ny kode? Den gamle koden slutter å virke når du lagrer.")) return; rd(); t.code=C.genCode(); draw(); toast("Ny kode laget – trykk Lagre for å ta den i bruk","info"); });
    document.getElementById("goUsers")?.addEventListener("click",()=>{ ORG=t.id; page="brukere"; sel=null; render(); });
    document.getElementById("on").oninput=e=>{ if(isNew){ const v=e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/æ/g,"ae").replace(/ø/g,"o").replace(/å/g,"a").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30);
      document.getElementById("oi").value=v; if(!document.getElementById("op")._touched) document.getElementById("op").value=v.replace(/-/g,"").slice(0,2).toUpperCase(); } };
    document.getElementById("op").oninput=e=>e.target._touched=true;
    document.getElementById("osv").onclick=async()=>{
      rd(); t.name=t.name.trim();
      if(!t.name) return toast("Navn mangler","info");
      if(!t.cats.length) return toast("Velg minst én kategori","info");
      if(isNew&&(!t.id||tOf(t.id))) return toast("ID mangler eller er i bruk","info");
      if(SET.tenants.some(x=>x.id!==t.id&&x.prefix===t.prefix)) return toast("Prefikset er i bruk av en annen organisasjon","info");
      const s=C.clone(SET); if(isNew){ t.code=""; s.tenants.push(t); } else s.tenants=s.tenants.map(x=>x.id===t.id?t:x);
      SET=await S.saveSettings(s); sel="org:"+t.id; toast(isNew?"Organisasjon opprettet":"Lagret"); render();
    };
  };
  draw();
}

/* ================= Brukere (superbruker) ================= */
function pUsers(){
  const list=USERS.filter(u=>ORG==="all"||u.tenant===ORG).sort((a,b)=>(a.tenant+a.username).localeCompare(b.tenant+b.username));
  const st=u=>u.locked?'<span class="ub lock">Låst</span>':u.active?'<span class="ub on">Aktiv</span>':'<span class="ub off">Deaktivert</span>';
  const showPanel=sel&&sel.startsWith("user:");
  $v.innerHTML=`<h2>Brukere</h2><p class="sub">Innlogging med brukernavn og passord til organisasjonsportalen (<code>/portal/</code>). ${ORG==="all"?"Alle organisasjoner.":esc(curT().name)}</p>
  <div class="split ${showPanel?"":"nodetail"}"><div class="tablewrap">${list.length?`<table><thead><tr><th>Brukernavn</th><th>Navn</th>${ORG==="all"?"<th>Organisasjon</th>":""}<th>Rolle</th><th>Status</th><th>Sist innlogget</th></tr></thead><tbody>
    ${list.map(u=>{ const t=tOf(u.tenant); return `<tr class="r ${sel==="user:"+u.username?"sel":""}" data-u="${esc(u.username)}"><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td>${ORG==="all"?`<td><span class="org">${t?tic(t.type):""} ${esc(t?t.name:u.tenant)}</span></td>`:""}<td>${esc(C.USER_ROLES[u.role]||u.role)}</td><td>${st(u)}</td><td>${fmt(u.lastLogin)}</td></tr>`; }).join("")}
    </tbody></table>`:'<div class="empty">Ingen brukere ennå.</div>'}
    <div style="padding:12px"><button class="btn o" id="addU">${ic("plus")} Ny bruker</button></div></div>${showPanel?`<div class="panel" id="upanel"></div>`:""}</div>
  <div class="card" style="margin-top:16px"><h3>${ic("info")} Roller</h3><dl class="kv" style="grid-template-columns:130px 1fr">
    <dt>Administrator</dt><dd>Saker, kart, innbyggervisning og leverandører for egen organisasjon.</dd>
    <dt>Saksbehandler</dt><dd>Saker og kart for egen organisasjon.</dd></dl>
    <p class="sub" style="margin:8px 0 0">Brukere ser aldri andre organisasjoner. Kun superbruker kan opprette brukere og endre koder.</p></div>`;
  $v.querySelectorAll("tr.r").forEach(r=>r.onclick=()=>{ sel="user:"+r.dataset.u; pUsers(); });
  document.getElementById("addU").onclick=()=>{ sel="user:__new"; pUsers(); };
  if(showPanel) userPanel(sel.slice(5));
}
function credText(u,pw){
  const t=tOf(u.tenant);
  return `MeldInn Portal – ${t?t.name:u.tenant}\nInnlogging: ${t?portalLink(t):location.origin+"/portal/"}\nBrukernavn: ${u.username}\nPassord: ${pw}\n\nBytt passord etter første innlogging (øverst til høyre).`;
}
function userPanel(username){
  const isNew=username==="__new";
  const u=isNew?{username:"",name:"",tenant:ORG!=="all"?ORG:"",role:"saksbehandler",active:true}:C.clone(USERS.find(x=>x.username===username)||{});
  if(!isNew&&!u.username){ sel=null; return pUsers(); }
  const P=document.getElementById("upanel");
  P.innerHTML=`<div class="hd"><h3>${isNew?"Ny bruker":esc(u.username)}</h3><button class="x" id="cl">${ic("x")}</button></div>
    <div class="form">
      ${isNew?`<label class="full">Brukernavn<input type="text" id="un" autocomplete="off" placeholder="f.eks. solsiden.styret"><span style="font-weight:400">3–40 tegn: a–z, 0–9, punktum, bindestrek, understrek</span></label>`:""}
      <label class="full">Navn<input type="text" id="nm" value="${esc(u.name)}" placeholder="F.eks. Kari Nordmann"></label>
      <label class="full">Organisasjon<select id="tn"><option value="">Velg…</option>${SET.tenants.map(t=>`<option value="${t.id}" ${u.tenant===t.id?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label>Rolle<select id="rl">${Object.entries(C.USER_ROLES).map(([k,l])=>`<option value="${k}" ${u.role===k?"selected":""}>${l}</option>`).join("")}</select></label>
      <label>Aktiv<span style="padding-top:6px"><label class="switch"><input type="checkbox" id="ac" ${u.active?"checked":""}><i></i></label></span></label>
      <label class="full">${isNew?"Passord":"Sett nytt passord (valgfritt)"}<span class="inrow"><input type="text" id="pw" autocomplete="off" placeholder="${isNew?"Minst 8 tegn":"La stå tomt for å beholde"}"><button class="btn ghost sm" id="gen">${ic("key")} Generer</button></span></label>
    </div>
    ${!isNew&&u.locked?`<div class="warn" style="display:flex;justify-content:space-between;align-items:center">Kontoen er låst etter for mange feil forsøk.<button class="btn sm" id="unl">${ic("lock")} Lås opp</button></div>`:""}
    ${!isNew?`<dl class="kv"><dt>Opprettet</dt><dd>${fmt(u.created)}</dd><dt>Sist innlogget</dt><dd>${fmt(u.lastLogin)}</dd></dl>`:""}
    <div id="cred"></div>
    <div style="display:flex;gap:8px;margin-top:10px">${!isNew?`<button class="btn r" id="del">${ic("trash")} Slett</button>`:""}<span style="flex:1"></span><button class="btn o" id="sv">${ic("check")} ${isNew?"Opprett bruker":"Lagre"}</button></div>
    <p class="sub" style="margin-top:10px">Endring av passord, rolle, organisasjon eller deaktivering logger brukeren ut av portalen med en gang.</p>`;
  document.getElementById("cl").onclick=()=>{sel=null;pUsers();};
  document.getElementById("gen").onclick=e=>{ e.preventDefault(); document.getElementById("pw").value=C.genPassword(); };
  const showCred=(usr,pw)=>{ const txt=credText(usr,pw); document.getElementById("cred").innerHTML=`<div class="okbox"><b>${ic("checkCircle")} Innloggingsinfo – send til brukeren</b><pre>${esc(txt)}</pre><button class="btn sm" id="cp">${ic("copy")} Kopier</button></div>`;
    document.getElementById("cp").onclick=()=>copy(txt,"Innloggingsinfo"); };
  document.getElementById("sv").onclick=async()=>{
    const d={name:document.getElementById("nm").value.trim(),tenant:document.getElementById("tn").value,role:document.getElementById("rl").value,active:document.getElementById("ac").checked};
    const pw=document.getElementById("pw").value;
    if(!d.tenant) return toast("Velg organisasjon","info");
    try{
      let res;
      if(isNew){ d.username=document.getElementById("un").value.trim().toLowerCase(); d.password=pw; res=await S.createUser(d); }
      else { if(pw) d.password=pw; res=await S.updateUser(u.username,d); }
      USERS=await S.users(); sel="user:"+res.username; pUsers(); toast(isNew?"Bruker opprettet":"Lagret");
      if(pw) showCred(res,pw);
    }catch(e){ toast(e.message,"info"); }
  };
  document.getElementById("unl")?.addEventListener("click",async()=>{ await S.updateUser(u.username,{unlock:true}); USERS=await S.users(); pUsers(); toast("Låst opp"); });
  document.getElementById("del")?.addEventListener("click",async()=>{ if(!confirm(`Slette ${u.username}? Brukeren mister tilgang med en gang.`)) return;
    await S.deleteUser(u.username); USERS=await S.users(); sel=null; pUsers(); toast("Bruker slettet"); });
}

/* ================= Innlogging (organisasjonsportal) ================= */
async function loginScreen(){
  const orgId=new URLSearchParams(location.search).get("org");
  const info=await S.orgInfo(orgId);
  document.body.innerHTML=`<div class="login"><form class="box" id="lf" autocomplete="on">
    <div class="brand"><img src="../icons/icon-192.png" alt=""><b>MeldInn Portal</b></div>
    <div class="sub" style="margin:0">Logg inn for å behandle saker.</div>
    ${info?`<div class="org">${tic(info.type)} ${esc(info.name)}</div>`:""}
    <label>Brukernavn<input type="text" id="lu" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label>Passord<input type="password" id="lp" autocomplete="current-password" required></label>
    <button class="btn o" id="lb" type="submit">${ic("lock")} Logg inn</button>
    <div class="err" id="le"></div>
    <div class="help">Glemt passord? Kontakt den som ga deg tilgang.${S.mode==="local"?`<br><br><span class="demo">DEMOMODUS</span> Prøv <code>kjorbekk.styret</code> eller <code>heroya.hms</code>, passord <code>Demo1234</code>`:""}</div>
  </form></div>`;
  document.getElementById("lu").focus();
  document.getElementById("lf").onsubmit=async e=>{ e.preventDefault();
    const b=document.getElementById("lb"), err=document.getElementById("le"); b.disabled=true; err.textContent="";
    try{ await S.login(info?info.id:null,document.getElementById("lu").value,document.getElementById("lp").value); await start(); }
    catch(x){ err.textContent=x.message; b.disabled=false; } };
}

/* ================= Oppstart ================= */
async function start(){
  ME=await S.me();
  if(!SUPER){
    if(!ME) return loginScreen();
    ORG=ME.tenant;
  } else if(!ME||!(ME.roles||[]).some(r=>["superadmin","kommune"].includes(r))){
    document.body.innerHTML=`<div class="empty">${ic("lock")} Du har ikke tilgang. <a href="/.auth/login/aad?post_login_redirect_uri=/admin/">Logg inn</a></div>`; return;
  }
  try{ const r=await Promise.all([S.listAll(),S.settings(),SUPER?S.users():Promise.resolve([])]); ALL=r[0]; SET=r[1]; USERS=r[2]; }
  catch(e){ if(!SUPER&&e.status===401){ S.logout(); return loginScreen(); } document.body.innerHTML=`<div class="empty">Kunne ikke laste data: ${esc(e.message)}</div>`; return; }
  if(SUPER&&ORG!=="all"&&!tOf(ORG)) ORG="all";
  shell(); render();
  setInterval(async()=>{ if(["saker","oversikt"].includes(page)&&!document.querySelector("#panel textarea:focus,#panel input:focus,#q:focus")){ try{ ALL=await S.listAll(); renderSide(); }catch(e){ handleAuthError(e); } } },30000);
}
(async()=>{ await S.init(); await start(); })();
})();
