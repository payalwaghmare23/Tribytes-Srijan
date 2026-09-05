# SafeRoute AI

SafeRoute AI is an emergency route decision-support prototype. It ranks routes using flood exposure, blockage, traffic, road condition, time, and distance, then explains the recommendation.

## Run

From this folder:

```powershell
python backend.py
```

Open `http://127.0.0.1:8000`.

## Backend

- Python standard library HTTP server
- SQLite database: `saferoute.db`
- Live weather: Open-Meteo
- `GET /api/health`
- `GET /api/live-situation`
- `GET /api/routes?origin=...&destination=...`
- `GET /api/journeys/latest`
- `GET /api/analyses`
- `POST /api/journeys`
- `POST /api/analyze`

Set the live-weather location with environment variables before starting:

```powershell
$env:SAFEROUTE_LATITUDE="19.0760"
$env:SAFEROUTE_LONGITUDE="72.8777"
$env:SAFEROUTE_LOCATION="Central City"
python backend.py
```

Traffic and road-blockage values are currently prototype inputs. A production deployment should connect them to validated city-specific emergency, traffic, and GIS feeds.

## Google Maps route names

Enable live route names and alternate routes with a Google Cloud API key that has the **Directions API** enabled:

```powershell
$env:SAFEROUTE_GOOGLE_MAPS_KEY="your-google-maps-server-key"
$env:SAFEROUTE_GOOGLE_MAPS_BROWSER_KEY="your-referrer-restricted-browser-key"
python backend.py
```

The server key powers the Directions API. The browser key powers the embedded live map and must be restricted by website referrer. Enable both the **Directions API** and **Maps JavaScript API**. Without keys, the app keeps its demo route labels and prototype map.
