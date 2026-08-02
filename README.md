# Tankboard · TankPuls Live

Eine statische, GitHub-Pages-taugliche Kraftstoffpreisanzeige mit:

- Live-Preisen von TankPuls
- Kartenansicht mit anklickbaren Stationen
- Preisverlauf einer Station
- Sortierung nach Preis, Distanz, Marke und Aktualität
- Farbkennzeichnung nach Signalwert
- Favoriten im Local Storage
- CSV-Export
- Deep Links über Query-Parameter
- Auto-Refresh
- Standort-Button

## Datenquellen

- Preise: TankPuls API
- Kartenkacheln: OpenStreetMap
- PLZ-Geocoding: Nominatim / OpenStreetMap

## Hinweise

Die TankPuls-Dokumentation beschreibt die Endpunkte `stations`, `stations/{id}`, `stations/{id}/history`, `regions/{plz}/summary` und `health`. Ein expliziter Bundesdurchschnitt ist dort nicht dokumentiert; die große Referenzkachel nutzt deshalb den regionalen Vergleichswert aus `regions/{plz}/summary` als offizielle Annäherung.

## Lokal testen

Einfach die Dateien über einen statischen Webserver ausliefern, zum Beispiel:

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen.
