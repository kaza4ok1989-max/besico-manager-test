# BESICO Manager — sichere Testintegration

## Was ist enthalten?
- Originales Reifenlager einschließlich Schnellaufnahme und Lagerliste drucken.
- Neuer Menüpunkt Parkplatz.
- Die Original-Parkplatzanwendung ist unter `public/parking/index.html` eingebettet, mit unveränderten `parking.png` und `chemnitz_karte.png`.
- Beide bestehenden Supabase-Projekte bleiben unverändert; es gibt **keine** Datenmigration und **keine** SQL-Änderung.
- Parkplatz hat weiterhin seine eigene Anmeldung und Berechtigungen.

## Sicher testen
1. Vor der Veröffentlichung beide Supabase-Projekte separat sichern (Datenbankexport; Bilder sind hier im ZIP).
2. Bestehende Repositories `parking` und `reifenlager` nicht überschreiben.
3. Am besten ein neues Repository `besico-manager-test` erstellen und diese Dateien dort hochladen.
4. Der mitgelieferte GitHub-Actions-Workflow setzt den GitHub-Pages-Basispfad automatisch auf den Repository-Namen. In GitHub unter Settings → Pages als Quelle GitHub Actions wählen.
5. In der Testversion alle Standorte und Bilder kontrollieren; Fahrzeugpositionen, Drehungen und Bearbeitung mit dem bisherigen Parkplatz vergleichen.
6. Für Reifenlager-QR-Links bei späterer Produktionsumstellung den Basis-Pfad beachten.

## Einschränkungen
- Die Integration ist bewusst ein eingebettetes Original-Parkplatzfenster, kein Rewrite und noch kein einheitliches Login.
- Parkplatz nutzt seine eigene Supabase-Session; separate Anmeldung kann nötig sein.
- Die vorhandene Parkplatzanwendung aktualisiert sich alle 3 Sekunden.
- Die PWA-Installation ist ein nachfolgender Schritt nach erfolgreichem Funktionstest.
