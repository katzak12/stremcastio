# StremCastio: updatelijst

Wensen voor latere versies. Bovenaan = eerst.

## Gepland

- **"Probleem melden"-knop**: kopieert versie en diagnose (Instellingen → Info) in één tik, zodat een gebruiker dat kan sturen in plaats van screenshots.
- **Ondertitel onthouden per serie**: na een keuze bij aflevering 1 kiest de app bij de volgende afleveringen vanzelf dezelfde soort ondertitel (zelfde bron/release-groep).

## Klaar

- **Cast-knop in Stremio** (0.6.0): een kleine Stremio-add-on op de relay; elke stream krijgt "Cast to TV", dat StremCastio direct opent.
- **Gekopieerde link herkennen** (0.6.0) en **update-melding** (0.6.0).

- **Real-Debrid voor gesproken taal en geluid** (0.4.0): zonder instellen via de Torrentio-link, of "Koppel Real-Debrid" met een code. Origineel bestand als het kan, Real-Debrid als het moet.

- **Eigen relay per gebruiker ("koppel je Cloudflare-account")**: klaar in 0.3.2.
  Een "Deploy to Cloudflare"-knop in de README en in de app (Instellingen → Relay). De gebruiker logt in bij
  Cloudflare, klikt op Deploy en krijgt de relay in zijn eigen (gratis) account. Daarna komt het relay-adres in de
  app; het mooist als de app dat adres zelf herkent en invult. Zo gaat niemands film via jouw account.
  Geen tokens in de app: een "inloggen met Cloudflare" voor gewone apps bestaat niet, en tokens laten plakken is
  onhandig en minder veilig.
