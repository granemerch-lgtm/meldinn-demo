# MeldInn – demo (PWA)

Installerbar webapp: innbygger melder inn, kommunen behandler, leverandøren ferdigmelder.
Alt ligger i én kodebase som kan kjøres på eget domene **og** pakkes for App Store / Google Play.

## Innhold
| Fil | Formål |
|---|---|
| index.html | Hele appen (HTML/CSS/JS) |
| manifest.webmanifest | Gjør appen installerbar (navn, farger, ikoner) |
| sw.js | Service worker – rask oppstart og offline-skall |
| icons/ | App-ikoner (192, 512, maskable, 1024 for butikkene) |
| capacitor.config.json | Klar for innpakking til iOS/Android |

## Demo-roller (velg øverst til høyre)
1. **Innbygger:** Meld inn → kategori → bilde → bekreft sted (GPS) → send. Duplikatsjekk innen 120 m. Følg saker.
2. **Kommune:** Oversikt med KPI-er og kart, prioritering, tildeling til leverandør, godkjenning, automatisk ruting (Oppsett).
3. **Leverandør:** Oppdragsliste, veibeskrivelse, ferdigmelding med bilde, kostnad og fullmaktskontroll.

Data lagres lokalt i nettleseren (localStorage). «Oppsett → Nullstill demodata» starter på nytt.

## Alternativ A – nettsidebasert på eget domene (raskest)
1. Last opp hele mappen til en statisk webhost med **HTTPS** (påkrevd for kamera, GPS og installasjon).
   Eksempler: Azure Static Web Apps, Netlify, Cloudflare Pages, GitHub Pages eller eget webhotell.
2. Pek f.eks. `demo.meldinn.no` (CNAME) mot hosten.
3. Åpne på mobil:
   - **Android/Chrome:** «Installer»-knapp vises i appen.
   - **iPhone/Safari:** Del → «Legg til på Hjem-skjerm».

## Alternativ B – App Store og Google Play
**Enklest: PWABuilder (Microsoft, gratis)**
1. Publiser først som i alternativ A.
2. Gå til pwabuilder.com, lim inn URL-en → «Package for stores».
3. Last ned Android-pakke (.aab) → last opp i Google Play Console.
4. Last ned iOS-pakke (Xcode-prosjekt) → bygg på Mac → last opp via App Store Connect.

**Alternativ: Capacitor (mer kontroll, native kamera/GPS/push)**
```
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
mkdir www && cp -r index.html manifest.webmanifest sw.js icons www/
npx cap add android && npx cap add ios
npx cap open android   # bygg i Android Studio
npx cap open ios       # bygg i Xcode (krever Mac)
```

**Kontoer som trengs:** Google Play Console (engangsavgift) og Apple Developer Program (årlig avgift).
Apple avviser apper som bare er en «innpakket nettside» – før innsending bør dere legge til
native funksjoner som push-varsler og native kamera/posisjon (Capacitor-plugins).

## Fra demo til pilot (neste steg)
- Backend og database (f.eks. Azure Functions + Azure SQL/Cosmos DB, eller Supabase)
- Innlogging for kommune og leverandør (Entra ID / BankID); innbygger forblir uten konto
- Varsling på SMS/e-post/push
- Personvern: DPIA, databehandleravtale, sletting av bilder etter X dager, sladding av ansikter/skilt
- Integrasjon mot kommunens fagsystem/kartdata
