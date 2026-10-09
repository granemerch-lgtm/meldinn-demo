# MeldInn v2 – innbygger-app + kommuneportal

| Adresse | Hvem | Innhold |
|---|---|---|
| `https://demo.2727.no/` | Innbyggere (ingen innlogging) | Meld inn, kart, mine saker |
| `https://demo.2727.no/admin/` | Kommune (Microsoft-innlogging + rollen `kommune`) | Saksliste, status, fordeling, kart, innbyggervisning, leverandører |

Uten database kjører begge sider i **demomodus** (lagres i nettleseren). Når databasen er koblet til, deler appen og portalen de samme dataene.

## Mappestruktur (alt i roten av GitHub-repoet)
```
index.html                 Innbygger-app
admin/index.html           Kommuneportal
shared/                    Felles logikk, ikoner, datalag
api/                       Server (Azure Functions) – lagrer i Azure Storage
icons/                     App-ikoner
staticwebapp.config.json   Tilgangsstyring /admin og /api/manage
sw.js, manifest.webmanifest, ingen-tilgang.html
```
NB: `shared/meldinn-core.js` og `api/src/lib/meldinn-core.js` skal være like.

## Oppsett – trinn for trinn

### 1. Last opp filene til GitHub
1. Slett gamle filer i repoet (behold mappen `.github`).
2. **Add file → Upload files** → dra inn alt innholdet fra zip-filen (mapper inkludert) → **Commit**.

### 2. Slå på API-et i GitHub-workflowen
1. Åpne `.github/workflows/azure-static-web-apps-<navn>.yml` → ✏️.
2. Endre `api_location: ""` til `api_location: "api"`.
3. **Commit**. Følg med under **Actions** til den er grønn.

### 3. Opprett lagring i Azure
1. Azure-portalen → **Storage accounts → Create**.
   - Resource group: `rg-meldinn` · Navn: f.eks. `meldinnstorage` · Region: Norway East · Redundancy: **LRS**.
2. **Review + create → Create**.
3. Åpne kontoen → **Security + networking → Access keys** → kopier **Connection string** (key1).

### 4. Koble lagringen til appen
1. Static Web App `meldinn-demo` → **Settings → Environment variables** → **Production** → **+ Add**.
2. Name: `STORAGE_CONNECTION` · Value: connection string fra trinn 3 → **Apply**.
3. Tabeller og bildemappe opprettes automatisk ved første bruk.

### 5. Gi kommunebrukere tilgang
1. Static Web App → **Settings → Role management** → **+ Invite**.
2. Authorization provider: **Microsoft Entra ID** · Invitee details: brukerens e-post · Domain: `demo.2727.no` · Role: **kommune** · Expiration: f.eks. 168 timer.
3. **Generate** → send lenken til brukeren. Brukeren åpner lenken og logger inn én gang.
4. Fjern tilgang: samme sted → velg bruker → **Delete**.

### 6. Test
1. Åpne `https://demo.2727.no/admin/` → logg inn → trykk **Last inn demodata** nederst til venstre.
2. Meld inn en sak fra mobilen på `https://demo.2727.no/` → den dukker opp i portalen (oppdateres hvert 30. sek, eller trykk **Oppdater**).
3. Toppen av portalen skal **ikke** vise «DEMOMODUS». Gjør den det, sjekk trinn 2 og 4.

## Feilsøking
| Symptom | Løsning |
|---|---|
| «DEMOMODUS» vises etter publisering | `api_location` er ikke satt til `"api"`, eller Actions feilet |
| Feilmelding om `STORAGE_CONNECTION` | Variabelen mangler eller er feil (trinn 4) |
| «Ingen tilgang» etter innlogging | Brukeren har ikke akseptert invitasjonen / mangler rollen `kommune` |
| Gammel versjon på mobil | Øk `CACHE`-versjonen i `sw.js` |

## Før reell bruk (pilot)
- Personvern: DPIA og databehandleravtale. Bilder kan inneholde personopplysninger.
- Sletterutine for gamle saker og bilder.
- Varsling på e-post/SMS til innbygger (kontaktfeltet lagres, men sendes ikke ennå).
- Egen leverandørportal (roller `leverandor`) kan legges til på samme måte som `/admin`.
