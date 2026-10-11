# MeldInn V4 – organisasjonsbrukere og koder

## Hva er nytt
| Del | Endring |
|---|---|
| **App** `/` | Første gang vises **kun kommuner**. Borettslag, sameier og bedrifter legges til med kode `XXX-XXX-XXX`. Lagte organisasjoner vises under «Mine organisasjoner» i velgeren øverst til høyre og kan fjernes. |
| **Direktelenke** | `/?kode=KJP-482-PRK` legger til organisasjonen automatisk (passer til QR-kode). `/?org=skien` åpner en kommune. |
| **Organisasjonsportal** `/portal/` | **Ny.** Innlogging med brukernavn og passord (ikke Entra ID). Brukeren ser kun egen organisasjon. Egen lenke per organisasjon: `/portal/?org=kjorbekk`. |
| **Superbrukerportal** `/admin/` | Ny side **Brukere** (opprett, roller, deaktiver, nytt passord, lås opp, slett). Organisasjoner viser kode, «Ny kode» og lenker. Fortsatt Entra-innlogging. |

## Roller i organisasjonsportalen
| Rolle | Tilgang |
|---|---|
| Administrator | Saker, kart, innbyggervisning, leverandører & ruting – egen organisasjon |
| Saksbehandler | Saker og kart – egen organisasjon |

Kun superbruker kan opprette brukere, endre navn/kategorier og lage ny kode.

## Sikkerhet
- Passord lagres som PBKDF2-hash (100 000 runder, SHA-256), aldri i klartekst.
- Innlogging gir en signert økt som varer i 12 timer.
- 5 feil passord → kontoen låses i 10 minutter (superbruker kan låse opp).
- Bytte av passord, rolle, organisasjon eller deaktivering logger brukeren ut med en gang.
- Ny kode gjør gammel kode ugyldig – også i apper som allerede har lagt den til.

## Oppsett (fra v3)
1. Lag mappen **V4** lokalt, eller erstatt innholdet i GitHub-repoet med filene herfra.
   **icons/** følger ikke med – behold dine egne.
2. Azure → Static Web App → **Environment variables** → legg til:
   - `AUTH_SECRET` = en lang tilfeldig tekst (minst 32 tegn). Anbefalt. Uten den brukes en nøkkel avledet fra lagringen.
3. **Commit** og vent til Actions er grønn.
4. Åpne `/admin/` → **Last inn demodata** (legger til demo-organisasjonene) → **Brukere** → **Ny bruker**.
5. Kopier innloggingsinfoen som vises og send til brukeren.

## Demomodus (uten database)
Innlogging i `/portal/`: `kjorbekk.styret` eller `heroya.hms`, passord `Demo1234`.
Demokoder i appen: `KJP-482-PRK` (Kjørbekk Park) og `HER-739-YAX` (Herøya).
Disse brukerne finnes **kun** i demomodus – API-et oppretter aldri brukere automatisk.

## Filer
```
index.html               App
admin/index.html         Superbrukerportal (Entra)
portal/index.html        Organisasjonsportal (brukernavn/passord)
shared/portal.js|css     Felles kode for begge portalene
shared/meldinn-core.js   Felles logikk (lik kopi i api/src/lib/)
shared/store.js, icons.js
api/src/functions/api.js API
api/src/lib/auth.js      Passord og innloggingsøkter
api/src/lib/db.js        Lagring (ny tabell: users)
staticwebapp.config.json, sw.js, manifest.webmanifest, ingen-tilgang.html
```
