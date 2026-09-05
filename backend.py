"""SafeRoute AI prototype backend.

Run with: python backend.py
Then open: http://127.0.0.1:8000
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, quote, urlparse


HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).parent
DATABASE = ROOT / "saferoute.db"
LATITUDE = float(os.getenv("SAFEROUTE_LATITUDE", "19.0760"))
LONGITUDE = float(os.getenv("SAFEROUTE_LONGITUDE", "72.8777"))
LOCATION_NAME = os.getenv("SAFEROUTE_LOCATION", "Central City")
GOOGLE_MAPS_KEY = os.getenv("SAFEROUTE_GOOGLE_MAPS_KEY", "")
GOOGLE_MAPS_BROWSER_KEY = os.getenv("SAFEROUTE_GOOGLE_MAPS_BROWSER_KEY", "")

ROUTES = [
    {"id": "A", "time": 12, "base": 82, "tag": "Fastest", "water": 88, "blockage": 88, "traffic": 82, "condition": 78},
    {"id": "B", "time": 18, "base": 31, "tag": "Recommended", "water": 22, "blockage": 20, "traffic": 45, "condition": 18},
    {"id": "C", "time": 25, "base": 44, "tag": "Backup", "water": 42, "blockage": 15, "traffic": 25, "condition": 24},
]


def db_connection():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with db_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS journeys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                journey_id INTEGER,
                water REAL NOT NULL,
                blockage REAL NOT NULL,
                traffic REAL NOT NULL,
                recommended_route TEXT NOT NULL,
                risk_score INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (journey_id) REFERENCES journeys (id)
            );
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(analyses)")}
        if "rain" not in columns:
            connection.execute("ALTER TABLE analyses ADD COLUMN rain REAL NOT NULL DEFAULT 0")


def save_journey(origin, destination):
    created_at = datetime.now(timezone.utc).isoformat()
    with db_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO journeys (origin, destination, created_at) VALUES (?, ?, ?)",
            (origin.strip(), destination.strip(), created_at),
        )
        return {"id": cursor.lastrowid, "origin": origin.strip(), "destination": destination.strip(), "createdAt": created_at}


def save_analysis(result, journey_id=None):
    conditions = result["conditions"]
    recommendation = result["recommendation"]
    with db_connection() as connection:
        connection.execute(
            "INSERT INTO analyses (journey_id, water, blockage, traffic, rain, recommended_route, risk_score, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (journey_id, conditions["water"], conditions["blockage"], conditions["traffic"], conditions.get("rain", 0), recommendation["routeId"], recommendation["riskScore"], json.dumps(result), datetime.now(timezone.utc).isoformat()),
        )


def latest_journey():
    with db_connection() as connection:
        row = connection.execute("SELECT id, origin, destination, created_at FROM journeys ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return None
    return {"id": row["id"], "origin": row["origin"], "destination": row["destination"], "createdAt": row["created_at"]}


def recent_analyses(limit=10):
    with db_connection() as connection:
        rows = connection.execute("SELECT id, journey_id, recommended_route, risk_score, water, blockage, traffic, rain, created_at FROM analyses ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


def score_route(route, conditions):
    """Apply the transparent prototype scoring model to one route."""
    water_delta = max(0, conditions["water"] - 1.8)
    water_weight = {"A": 16, "B": 20, "C": 10}[route["id"]]
    blockage_weight = {"A": 0.17, "B": 0.11, "C": 0.08}[route["id"]]
    traffic_weight = 0.08 if route["id"] == "A" else 0.06
    rainfall_weight = {"A": 1.8, "B": 1.1, "C": 0.8}[route["id"]]
    score = route["base"]
    score += water_delta * water_weight
    score += (conditions["blockage"] - 30) * blockage_weight
    score += (conditions["traffic"] - 45) * traffic_weight
    score += min(12, conditions.get("rain", 0) * rainfall_weight)
    return round(max(5, min(99, score)))


def analyze(conditions):
    normalized = {
        "water": float(conditions.get("water", 1.8)),
        "blockage": float(conditions.get("blockage", 30)),
        "traffic": float(conditions.get("traffic", 45)),
        "rain": float(conditions.get("rain", 0)),
    }
    scored = [{**route, "score": score_route(route, normalized)} for route in ROUTES]
    accessible = [route for route in scored if normalized["blockage"] < 80 or route["id"] != "A"]
    suitable = [route for route in accessible if route["score"] < 81]
    winner = min(suitable or accessible, key=lambda route: route["score"])
    return {
        "conditions": normalized,
        "dataSources": {
            "weather": "Open-Meteo live weather",
            "routing": "OSRM live road routing",
            "satelliteImagery": "Esri World Imagery satellite tiles available for visual verification",
            "satelliteRiskClassification": "not enabled without a validated flood-classification model",
        },
        "routes": scored,
        "recommendation": {
            "routeId": winner["id"],
            "riskScore": winner["score"],
            "estimatedMinutes": winner["time"],
            "status": "RECOMMENDED" if winner["id"] == "B" else "UPDATED RECOMMENDATION",
            "reason": (
                "Route B remains the safest choice under current conditions."
                if winner["id"] == "B"
                else f"Route B is no longer the safest option. Route {winner['id']} is now recommended because its relative risk is lower under this scenario."
            ),
        },
    }


def satellite_status():
    return {
        "available": True,
        "provider": "Esri World Imagery",
        "purpose": "Live satellite basemap and visual route verification",
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "usedForRiskScore": False,
        "note": "Connect a validated flood segmentation model before using satellite imagery as a numeric risk input.",
    }


def weather_description(code):
    descriptions = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle",
        55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
        71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
        81: "Rain showers", 82: "Heavy rain showers", 95: "Thunderstorm",
        96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
    }
    return descriptions.get(code, "Changing conditions")


def get_live_situation():
    query = (
        f"https://api.open-meteo.com/v1/forecast?latitude={LATITUDE}"
        f"&longitude={LONGITUDE}&current=temperature_2m,precipitation,rain"
        f",weather_code,wind_speed_10m&timezone=auto"
    )
    request = Request(query, headers={"User-Agent": "SafeRoute-AI-Prototype/1.0"})
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    current = payload["current"]
    rainfall = float(current.get("rain", 0))
    return {
        "source": "Open-Meteo current weather",
        "location": LOCATION_NAME,
        "coordinates": {"latitude": LATITUDE, "longitude": LONGITUDE},
        "observedAt": current.get("time"),
        "temperatureC": current.get("temperature_2m"),
        "rainMm": rainfall,
        "weather": weather_description(int(current.get("weather_code", -1))),
        "windKmh": current.get("wind_speed_10m"),
        "status": "HEAVY RAIN" if rainfall >= 4 else "RAIN WATCH" if rainfall > 0 else "MONITORING",
    }


def get_google_routes(origin, destination):
    """Return live Google driving alternatives for any globally geocodable places."""
    if not GOOGLE_MAPS_KEY:
        return {"available": False, "provider": "Google Maps", "routes": [], "message": "Set SAFEROUTE_GOOGLE_MAPS_KEY to enable live route names."}
    query = (
        "https://maps.googleapis.com/maps/api/directions/json?"
        f"origin={quote(origin)}&destination={quote(destination)}&alternatives=true&mode=driving&key={quote(GOOGLE_MAPS_KEY)}"
    )
    request = Request(query, headers={"User-Agent": "SafeRoute-AI-Prototype/1.0"})
    with urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("status") != "OK":
        raise ValueError(payload.get("error_message") or payload.get("status", "Google Maps request failed"))
    routes = []
    for index, route in enumerate(payload.get("routes", [])[:3]):
        legs = route.get("legs", [])
        if not legs:
            continue
        leg = legs[0]
        routes.append({
            "id": chr(65 + index),
            "name": route.get("summary") or f"Google route {index + 1}",
            "distance": leg.get("distance", {}).get("text"),
            "duration": leg.get("duration", {}).get("text"),
            "mapUrl": "https://www.google.com/maps/dir/?api=1&origin=" + quote(origin) + "&destination=" + quote(destination),
            "polyline": route.get("overview_polyline", {}).get("points"),
        })
    return {"available": True, "provider": "Google Maps", "routes": routes}


def get_osrm_routes(origin, destination):
    geocode_url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q="
    headers = {"User-Agent": "SafeRoute-AI-Prototype/1.0"}
    points = []
    for place in (origin, destination):
        request = Request(geocode_url + quote(place), headers=headers)
        with urlopen(request, timeout=8) as response:
            matches = json.loads(response.read().decode("utf-8"))
        if not matches:
            raise ValueError(f"Could not locate {place}")
        points.append((float(matches[0]["lon"]), float(matches[0]["lat"])))
    coordinates = ";".join(f"{longitude},{latitude}" for longitude, latitude in points)
    request = Request(
        f"https://router.project-osrm.org/route/v1/driving/{coordinates}?alternatives=true&overview=full&steps=true&geometries=geojson",
        headers=headers,
    )
    with urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("code") != "Ok":
        raise ValueError(payload.get("message", "Live route service failed"))
    routes = []
    for index, route in enumerate(payload.get("routes", [])[:3]):
        steps = [step for leg in route.get("legs", []) for step in leg.get("steps", []) if step.get("name")]
        steps.sort(key=lambda step: step.get("distance", 0), reverse=True)
        street_names = list(dict.fromkeys(step["name"] for step in steps))[:2]
        summary = "via " + " & ".join(street_names) if street_names else f"Live OSRM route {index + 1}"
        routes.append({
            "id": chr(65 + index),
            "name": summary,
            "distance": f"{route['distance'] / 1000:.1f} km",
            "duration": f"{round(route['duration'] / 60)} min",
            "geometry": route.get("geometry"),
            "mapUrl": "https://www.google.com/maps/dir/?api=1&origin=" + quote(origin) + "&destination=" + quote(destination),
        })
    return {"available": True, "provider": "OpenStreetMap / OSRM", "routes": routes}
class SafeRouteHandler(SimpleHTTPRequestHandler):
    """Serve the prototype and its small JSON API from one local process."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"status": "online", "service": "SafeRoute AI risk engine", "database": str(DATABASE.name)})
            return
        if path == "/api/config":
            self.send_json({"googleMapsKey": GOOGLE_MAPS_BROWSER_KEY})
            return
        if path == "/api/journeys/latest":
            self.send_json(latest_journey() or {"origin": "Central City", "destination": "Relief Center"})
            return
        if path == "/api/analyses":
            self.send_json(recent_analyses())
            return
        if path == "/api/live-situation":
            try:
                self.send_json(get_live_situation())
            except (OSError, KeyError, ValueError, json.JSONDecodeError) as error:
                self.send_json({"status": "unavailable", "error": str(error)}, status=503)
            return
        if path == "/api/satellite-status":
            self.send_json(satellite_status())
            return
        if path == "/api/routes":
            query = parse_qs(urlparse(self.path).query)
            origin = query.get("origin", [""])[0].strip()
            destination = query.get("destination", [""])[0].strip()
            if not origin or not destination:
                self.send_json({"error": "origin and destination are required"}, status=400)
                return
            try:
                result = get_google_routes(origin, destination) if GOOGLE_MAPS_KEY else get_osrm_routes(origin, destination)
                self.send_json(result)
            except (OSError, KeyError, ValueError, json.JSONDecodeError) as error:
                self.send_json({"available": False, "provider": "Google Maps", "routes": [], "message": str(error)}, status=502)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in {"/api/analyze", "/api/journeys"}:
            self.send_error(404, "Endpoint not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/journeys":
                origin = str(payload.get("origin", "")).strip()
                destination = str(payload.get("destination", "")).strip()
                if not origin or not destination:
                    self.send_json({"error": "origin and destination are required"}, status=400)
                    return
                self.send_json(save_journey(origin, destination), status=201)
                return
            result = analyze(payload)
            journey_id = None
            if payload.get("origin") and payload.get("destination"):
                journey = save_journey(str(payload["origin"]), str(payload["destination"]))
                journey_id = journey["id"]
            save_analysis(result, journey_id)
            self.send_json(result)
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_json({"error": "Expected JSON conditions: water, blockage, traffic"}, status=400)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), SafeRouteHandler)
    print(f"SafeRoute AI backend running at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SafeRoute AI backend")
        server.server_close()