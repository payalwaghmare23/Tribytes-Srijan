const routes = [
  { id: 'A', time: 12, base: 82, tag: 'Fastest', water: 88, blockage: 88, traffic: 82, condition: 78 },
  { id: 'B', time: 18, base: 31, tag: 'Recommended', water: 22, blockage: 20, traffic: 45, condition: 18 },
  { id: 'C', time: 25, base: 44, tag: 'Backup', water: 42, blockage: 15, traffic: 25, condition: 24 }
];
const factors = [['Flood risk', 35], ['Road blockage', 25], ['Road condition', 15], ['Traffic', 10], ['Travel time', 10], ['Distance', 5]];
const state = { water: 1.8, blockage: 30, traffic: 45, rain: 0 };
const journey = { origin: 'Central City', destination: 'Relief Center' };
const liveLocation = { latitude: null, longitude: null, label: '' };
const routeNames = { A: 'Fastest corridor', B: 'Safer central route', C: 'Backup route' };
const routeLinks = {};
const liveRouteLayers = {};
const API_URL = '/api/analyze';
const JOURNEY_API_URL = '/api/journeys';
const LIVE_API_URL = '/api/live-situation';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const googleJourneyUrl = () => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(journey.origin)}&destination=${encodeURIComponent(journey.destination)}&travelmode=driving`;
const googleSearchUrl = query => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
function routeStreetLabel(route, fallback) {
  const steps = route.legs?.flatMap(leg => leg.steps || []).filter(step => step.name);
  const names = [...new Map(steps.sort((a, b) => (b.distance || 0) - (a.distance || 0)).map(step => [step.name, step])).values()].slice(0, 2).map(step => step.name);
  return names.length ? `via ${names.join(' & ')}` : fallback;
}

function scoreRoute(route) {
  const water = Math.max(0, state.water - 1.8) * (route.id === 'A' ? 16 : route.id === 'B' ? 20 : 10);
  const blockage = (state.blockage - 30) * (route.id === 'A' ? 0.17 : route.id === 'B' ? 0.11 : 0.08);
  const traffic = (state.traffic - 45) * (route.id === 'A' ? 0.08 : 0.06);
  const rainfall = Math.min(12, state.rain * (route.id === 'A' ? 1.8 : route.id === 'B' ? 1.1 : 0.8));
  return Math.round(Math.max(5, Math.min(99, route.base + water + blockage + traffic + rainfall)));
}
function riskClass(score) { return score >= 81 ? 'critical' : score >= 61 ? 'high' : score >= 31 ? 'moderate' : 'low'; }
function safetyLabel(score) { return score <= 30 ? 'HIGH' : score <= 60 ? 'MODERATE' : score <= 80 ? 'LOW' : 'CRITICAL'; }
function selectLiveRoute(routeId, layer, popupHtml) {
  Object.entries(liveRouteLayers).forEach(([id, routeLayer]) => routeLayer.setStyle({ weight: id === routeId ? 9 : 4, opacity: id === routeId ? 1 : .45 }));
  document.querySelectorAll('.route-card').forEach(card => card.classList.toggle('map-selected', card.querySelector('h3')?.textContent.trim() === `ROUTE ${routeId}`));
  layer.openPopup();
  layer.bindPopup(popupHtml);
}
function renderRoutes() {
  const scored = routes.map(route => ({ ...route, score: scoreRoute(route) }));
  const accessible = scored.filter(route => state.blockage < 80 || route.id !== 'A');
  const winner = accessible.filter(route => route.score < 81).sort((a, b) => a.score - b.score)[0] || accessible.sort((a, b) => a.score - b.score)[0];
  $('routeGrid').innerHTML = scored.map(route => {
    const isWinner = route.id === winner.id;
    const level = riskClass(route.score);
    const label = isWinner ? 'RECOMMENDED' : route.id === 'A' ? 'AVOID' : 'BACKUP';
    return `<article class="route-card ${isWinner ? 'recommended' : ''} ${label === 'AVOID' ? 'avoid' : label === 'BACKUP' ? 'backup' : ''}">
      <div class="route-card-header"><div><h3>ROUTE ${route.id}</h3><a class="route-name" href="${escapeHtml(routeLinks[route.id] || googleJourneyUrl())}" target="_blank" rel="noreferrer" title="Open this journey in Google Maps">${escapeHtml(routeNames[route.id])} ↗</a><span class="tag">${route.tag}</span></div><span class="status-pill ${label.toLowerCase()}">${label}</span></div>
      <div class="route-time"><strong>${route.time}<small> min</small></strong><div class="route-risk"><small>RISK SCORE</small><strong class="risk-${level === 'low' ? 'low-text' : level}">${route.score}<span>/100</span></strong></div></div>
      ${[['Water level', route.water], ['Blockage', route.blockage], ['Traffic', route.traffic], ['Road condition', route.condition]].map(([name, value]) => `<div class="factor-row"><span>${name}</span><b>${value > 70 ? 'High' : value > 35 ? 'Moderate' : value < 25 ? 'Good' : 'Low'}</b><div class="factor-track"><i style="width:${value}%"></i></div></div>`).join('')}
      <a class="route-map-link" href="${escapeHtml(routeLinks[route.id] || googleJourneyUrl())}" target="_blank" rel="noreferrer">View this journey in Google Maps ↗</a>
    </article>`;
  }).join('');
  updateRecommendation(winner);
  renderSimulationLines(scored, winner);
}
function updateRecommendation(winner) {
  const score = scoreRoute(winner);
  const gap = Math.max(0, Math.round(scoreRoute(routes[0]) - score));
  $('recommendationTitle').textContent = `ROUTE ${winner.id} IS THE SAFEST SUITABLE OPTION`;
  $('recommendationRisk').innerHTML = `${score}<span>/100</span>`;
  $('recommendationTime').innerHTML = `${winner.time}<small> min</small>`;
  $('chosenRouteLabel').textContent = `Route ${winner.id}`;
  $('safeSpeedRoute').textContent = `Route ${winner.id}`;
  $('safeSpeedTime').textContent = `${winner.time} min`;
  $('safeSpeedRisk').textContent = score;
  $('recommendationReason').textContent = winner.id === 'B'
    ? `Route B has lower flood exposure, fewer blocked roads, and better road conditions. Although it is 6 minutes slower than Route A, its overall safety risk is ${gap} points lower.`
    : `Route ${winner.id} is currently the safest accessible option. The engine is prioritizing its lower combined exposure while monitoring changing road conditions.`;
  const values = winner.id === 'A' ? [88, 88, 78, 82, 30, 22] : winner.id === 'B' ? [22, 20, 18, 45, 52, 48] : [42, 15, 24, 25, 70, 66];
  $('factorList').innerHTML = factors.map(([name, weight], index) => `<div class="factor-line"><label>${name} <span>${weight}%</span></label><div class="track"><i style="width:${values[index]}%"></i></div></div>`).join('');
}
function renderSimulationLines(scored, winner) {
  $('simRecommendation').textContent = `Route ${winner.id}`;
  $('simStatus').textContent = winner.id === 'B' ? 'Safest suitable option' : 'New safest suitable option';
  $('simRouteLines').innerHTML = scored.map(route => `<div class="sim-line"><label>Route ${route.id}</label><div><i style="width:${route.score}%;background:${route.id === winner.id ? '#38bdf8' : route.id === 'A' ? '#f87171' : '#fbbf24'}"></i></div><b>${route.score}</b></div>`).join('');
  $('simMessage').textContent = winner.id === 'B' ? 'Route B remains the safest choice under current conditions.' : `Route B is no longer the safest option. Route ${winner.id} is now recommended because its relative risk is lower under this scenario.`;
}
function updateSlider(key, value) {
  state[key] = Number(value);
  $('waterOutput').textContent = `${state.water.toFixed(1)} m`;
  $('blockageOutput').textContent = `${state.blockage}%`;
  $('trafficOutput').textContent = `${state.traffic}%`;
  renderRoutes();
}
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400); }
function resetConditions() { $('waterSlider').value = 1.8; $('blockageSlider').value = 30; $('trafficSlider').value = 45; state.water = 1.8; state.blockage = 30; state.traffic = 45; updateSlider('water', 1.8); toast('Conditions reset to live baseline'); }

async function syncBackend(showToast = false) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, ...journey })
    });
    if (!response.ok) throw new Error('API unavailable');
    const result = await response.json();
    document.querySelector('.system-status').innerHTML = '<span></span> AI API ONLINE';
    if (showToast) toast(`Python risk engine confirmed Route ${result.recommendation.routeId}`);
  } catch {
    document.querySelector('.system-status').innerHTML = '<span></span> LOCAL ENGINE ACTIVE';
  }
}

function setJourneyPoint(point, label, value, editing = false) {
  const content = point.querySelector('div');
  content.replaceChildren();
  const labelElement = document.createElement('small');
  labelElement.textContent = label;
  content.appendChild(labelElement);
  if (editing) {
    const input = document.createElement('input');
    input.className = 'journey-input';
    input.type = 'text';
    input.value = value;
    input.setAttribute('aria-label', label);
    input.style.cssText = 'width:145px;border:1px solid #b7d8e8;border-radius:5px;padding:6px 7px;color:#12304a;font:600 12px inherit;background:#f7fbfe;';
    content.appendChild(input);
  } else {
    const valueElement = document.createElement('strong');
    valueElement.textContent = value;
    content.appendChild(valueElement);
  }
}

async function toggleJourneyEditor() {
  const points = document.querySelectorAll('.journey-point');
  const button = document.querySelector('.edit-journey');
  const editing = button.dataset.editing === 'true';
  if (!editing) {
    setJourneyPoint(points[0], 'Current location', journey.origin, true);
    setJourneyPoint(points[1], 'Destination', journey.destination, true);
    button.dataset.editing = 'true';
    button.textContent = '✓';
    button.setAttribute('aria-label', 'Save journey');
    points[0].querySelector('input').focus();
    return;
  }
  const values = [...document.querySelectorAll('.journey-input')].map(input => input.value.trim());
  if (values.some(value => !value)) {
    toast('Enter both a current location and destination');
    return;
  }
  [journey.origin, journey.destination] = values;
  setJourneyPoint(points[0], 'Current location', journey.origin);
  setJourneyPoint(points[1], 'Destination', journey.destination);
  button.dataset.editing = 'false';
  button.textContent = '✎';
  button.setAttribute('aria-label', 'Edit journey');
  await saveJourney();
  syncGoogleRoutes();
  loadGoogleMap();
  loadLeafletMap();
  syncBackend(true);
  toast(`Journey updated: ${journey.origin} → ${journey.destination}`);
}

async function saveJourney() {
  try {
    await fetch(JOURNEY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(journey)
    });
  } catch {
    // Direct file previews continue to work without the API.
  }
}

async function syncGoogleRoutes() {
  try {
    const response = await fetch(`/api/routes?origin=${encodeURIComponent(journey.origin)}&destination=${encodeURIComponent(journey.destination)}`);
    const result = await response.json();
    if (!response.ok || !result.available) return;
    result.routes.forEach(route => {
      routeNames[route.id] = route.name;
      routeLinks[route.id] = route.mapUrl;
      const match = route.duration?.match(/(\d+)\s*min/);
      const localRoute = routes.find(item => item.id === route.id);
      if (match && localRoute) localRoute.time = Number(match[1]);
    });
    renderRoutes();
    toast('Live Google Maps route names updated');
  } catch {
    // Demo route labels remain available without a Google Maps key.
  }
}

async function loadGoogleMap() {
  try {
    const config = await (await fetch('/api/config')).json();
    const canvas = document.querySelector('.map-canvas');
    if (!canvas) return;
    if (!config.googleMapsKey) {
      canvas.querySelector('.google-map-prompt')?.remove();
      const prompt = document.createElement('div');
      prompt.className = 'google-map-prompt';
      prompt.innerHTML = `<strong>Google Maps route view</strong><span>Add a restricted Google Maps browser key to embed the live map here.</span><a href="${escapeHtml(googleJourneyUrl())}" target="_blank" rel="noreferrer">Open this journey in Google Maps ↗</a>`;
      canvas.appendChild(prompt);
      return;
    }
    canvas.querySelector('#googleMap')?.remove();
    canvas.querySelector('.google-map-prompt')?.remove();
    canvas.classList.remove('google-live');
    const mapNode = document.createElement('div');
    mapNode.id = 'googleMap';
    canvas.prepend(mapNode);
    if (!window.google?.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsKey)}`;
      script.async = true;
      await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
    }
    const map = new google.maps.Map(mapNode, { center: { lat: 19.076, lng: 72.8777 }, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
    const service = new google.maps.DirectionsService();
    const result = await new Promise((resolve, reject) => service.route({ origin: journey.origin, destination: journey.destination, travelMode: 'DRIVING', provideRouteAlternatives: true }, (data, status) => status === 'OK' ? resolve(data) : reject(new Error(status))));
    const colors = ['#dc2626', '#1687d9', '#e87924'];
    result.routes.slice(0, 3).forEach((route, index) => {
      const leg = route.legs[0];
      routeNames[String.fromCharCode(65 + index)] = route.summary || `Google route ${index + 1}`;
      routeLinks[String.fromCharCode(65 + index)] = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(journey.origin)}&destination=${encodeURIComponent(journey.destination)}`;
      const localRoute = routes[index];
      const minutes = leg.duration?.value ? Math.round(leg.duration.value / 60) : null;
      if (minutes && localRoute) localRoute.time = minutes;
      new google.maps.Polyline({ map, path: route.overview_path, strokeColor: colors[index], strokeOpacity: index === 1 ? 1 : .7, strokeWeight: index === 1 ? 6 : 4 });
    });
    new google.maps.Marker({ map, position: result.routes[0].legs[0].start_location, title: journey.origin, label: 'A' });
    new google.maps.Marker({ map, position: result.routes[0].legs[0].end_location, title: journey.destination, label: 'B' });
    canvas.classList.add('google-live');
    renderRoutes();
    toast('Live Google Maps routes loaded');
  } catch {
    if (config.googleMapsKey) {
      const mapNode = document.querySelector('#googleMap');
      if (mapNode) mapNode.innerHTML = `<iframe title="Google Maps route view" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(config.googleMapsKey)}&origin=${encodeURIComponent(journey.origin)}&destination=${encodeURIComponent(journey.destination)}&mode=driving"></iframe>`;
      canvas.classList.add('google-live');
    }
  }
}

async function loadJourney() {
  try {
    const response = await fetch(`${JOURNEY_API_URL}/latest`);
    if (!response.ok) return;
    const saved = await response.json();
    if (!saved.origin || !saved.destination) return;
    journey.origin = saved.origin;
    journey.destination = saved.destination;
    const points = document.querySelectorAll('.journey-point');
    setJourneyPoint(points[0], 'Current location', journey.origin);
    setJourneyPoint(points[1], 'Destination', journey.destination);
  } catch {
    // Keep the demo defaults when the backend is unavailable.
  }
}

async function syncLiveSituation() {
  try {
    const response = await fetch(LIVE_API_URL);
    if (!response.ok) throw new Error('Live weather unavailable');
    const live = await response.json();
    const situationValues = document.querySelectorAll('.situation-item strong');
    const situationUpdated = document.querySelector('.situation-updated');
    if (situationValues[0]) situationValues[0].textContent = live.status;
    if (situationValues[4]) situationValues[4].textContent = `${live.weather} · ${live.rainMm} mm`;
    if (situationUpdated) situationUpdated.innerHTML = `<span class="pulse-dot"></span> Live · ${live.observedAt || 'just now'} · ${live.source}`;
    state.rain = Number(live.rainMm || 0);
    renderRoutes();
    await syncBackend();
    document.querySelector('.system-status').innerHTML = `<span></span> LIVE DATA ONLINE${liveLocation.label ? ` · ${escapeHtml(liveLocation.label)}` : ''}`;
  } catch {
    const situationUpdated = document.querySelector('.situation-updated');
    if (situationUpdated) situationUpdated.innerHTML = '<span class="pulse-dot"></span> Live feed unavailable · using prototype data';
  }
}

async function syncSatelliteStatus() {
  try {
    const response = await fetch('/api/satellite-status');
    const status = await response.json();
    if (!status.available) return;
    document.querySelector('.map-canvas')?.setAttribute('data-satellite-source', status.provider);
    const badge = document.querySelector('.satellite-live-badge');
    if (badge) badge.textContent = `◉ ${status.serviceName || 'Satellite imagery'} online`;
  } catch {
    // The Leaflet imagery layer can still load directly if the metadata endpoint is unavailable.
  }
}

function updateGoogleJourneyLinks() {
  document.querySelectorAll('.route-map-link').forEach(link => {
    if (!routeLinks[link.closest('.route-card')?.querySelector('h3')?.textContent?.slice(-1)]) link.href = googleJourneyUrl();
  });
}

function bindGoogleMapPoints() {
  document.querySelectorAll('.current-point, .destination-point, .start-marker, .end-marker').forEach(point => {
    point.setAttribute('role', 'link');
    point.setAttribute('tabindex', '0');
    const openDirections = () => window.open(googleJourneyUrl(), '_blank', 'noopener,noreferrer');
    point.addEventListener('click', openDirections);
    point.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openDirections(); });
  });
  document.querySelectorAll('.safe-zone').forEach(point => {
    point.setAttribute('role', 'link');
    point.setAttribute('tabindex', '0');
    const name = point.classList.contains('zone-one') ? 'City Relief Center' : 'Community Hall';
    const openSafeZone = () => window.open(googleSearchUrl(name), '_blank', 'noopener,noreferrer');
    point.addEventListener('click', openSafeZone);
    point.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openSafeZone(); });
  });
}

function renderArchitecture() {
  if (document.querySelector('.architecture-section')) return;
  const footer = document.querySelector('footer');
  if (!footer) return;
  footer.insertAdjacentHTML('beforebegin', `<section class="architecture-section" id="architecture"><div class="section-label"><span>09</span> TECHNICAL ARCHITECTURE</div><h2>From context to safer action.</h2><div class="architecture-flow"><div class="architecture-node primary-node"><span>◉</span><strong>User</strong><small>Needs a safe decision</small></div><i class="architecture-arrow">→</i><div class="architecture-node"><span>▣</span><strong>SafeRoute AI<br>Web App</strong><small>Journey interface</small></div><i class="architecture-arrow">→</i><div class="architecture-node"><span>⌖</span><strong>Location &amp;<br>Destination</strong><small>Trip context</small></div><i class="architecture-arrow">→</i><div class="architecture-node"><span>▤</span><strong>Map / Road<br>Data</strong><small>Routes and access</small></div><i class="architecture-arrow">→</i><div class="architecture-node data-node"><span>≋</span><strong>Disaster Data<br>+ Traffic Data</strong><small>Changing conditions</small></div><i class="architecture-arrow">→</i><div class="architecture-node engine-node"><span>✦</span><strong>AI Risk<br>Assessment Engine</strong><small>Explainable analysis<div class="architecture-factors"><b>Flood / Water Level</b><b>Road Blockage</b><b>Traffic</b><b>Distance</b><b>Disaster Severity</b><b>User Reports</b></div></small></div><i class="architecture-arrow">→</i><div class="architecture-node"><span>◎</span><strong>Route Safety<br>Scoring</strong><small>Compare and rank</small></div><i class="architecture-arrow">→</i><div class="architecture-output"><strong>Recommended<br>Safest Route</strong><div><b class="safe-output">🟢 Safe Route</b><b class="moderate-output">🟡 Moderate-Risk Route</b><b class="unsafe-output">🔴 Unsafe Route</b></div></div></div></section>`);
}

async function getLiveLocation() {
  if (!navigator.geolocation) throw new Error('Geolocation is not supported');
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }));
  liveLocation.latitude = position.coords.latitude;
  liveLocation.longitude = position.coords.longitude;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${liveLocation.latitude}&lon=${liveLocation.longitude}`, { headers: { Accept: 'application/json' } });
    const place = await response.json();
    liveLocation.label = place.display_name?.split(',').slice(0, 2).join(',') || `${liveLocation.latitude.toFixed(4)}, ${liveLocation.longitude.toFixed(4)}`;
  } catch {
    liveLocation.label = `${liveLocation.latitude.toFixed(4)}, ${liveLocation.longitude.toFixed(4)}`;
  }
  const status = document.querySelector('.system-status');
  if (status) status.innerHTML = `<span></span> LIVE DATA ONLINE · ${escapeHtml(liveLocation.label)}`;
  const updated = document.querySelector('.situation-updated');
  if (updated) updated.innerHTML = `<span class="pulse-dot"></span> Live location · ${escapeHtml(liveLocation.label)}`;
  return liveLocation;
}

async function useLiveLocation() {
  try {
    const location = await getLiveLocation();
    journey.origin = location.label;
    const point = document.querySelectorAll('.journey-point')[0];
    setJourneyPoint(point, 'Current location', journey.origin);
    await saveJourney();
    renderRoutes();
    await loadLeafletMap();
    toast('Live location set as route origin');
  } catch {
    toast('Allow location access to use your live position');
  }
}

async function loadLeafletMap() {
  try {
    if (!window.L) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(stylesheet);
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const canvas = document.querySelector('.map-canvas');
    if (!canvas) return;
    const geocode = async place => {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, { headers: { Accept: 'application/json' } });
      const matches = await response.json();
      if (!matches[0]) throw new Error(`Could not locate ${place}`);
      return [Number(matches[0].lat), Number(matches[0].lon)];
    };
    const [origin, destination] = await Promise.all([geocode(journey.origin), geocode(journey.destination)]);
    const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}?alternatives=true&overview=full&steps=true&geometries=geojson`);
    const routeData = await routeResponse.json();
    if (!routeData.routes?.length) throw new Error('No routes found');
    canvas.querySelector('#leafletMap')?.remove();
    const mapNode = document.createElement('div');
    mapNode.id = 'leafletMap';
    canvas.prepend(mapNode);
    canvas.classList.add('leaflet-live');
    Object.keys(liveRouteLayers).forEach(routeId => delete liveRouteLayers[routeId]);
    const map = L.map(mapNode, { zoomControl: true }).setView(origin, 12);
    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' });
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri, Maxar, Earthstar Geographics' });
    streetLayer.addTo(map);
    L.control.layers({ 'Street map': streetLayer, 'Satellite imagery': satelliteLayer }, null, { collapsed: false, position: 'topright' }).addTo(map);
    const colors = ['#dc2626', '#1687d9', '#e87924'];
    const visibleRoutes = routeData.routes.slice(0, 3);
    const routeScores = routes.slice(0, visibleRoutes.length).map(route => scoreRoute(route));
    const safestIndex = visibleRoutes.length === 1 ? 0 : routeScores.indexOf(Math.min(...routeScores));
    visibleRoutes.forEach((route, index) => {
      const routeId = visibleRoutes.length === 1 ? 'B' : String.fromCharCode(65 + index);
      const isSafest = index === safestIndex;
      const layer = L.geoJSON(route.geometry, { style: { color: isSafest ? '#1687d9' : colors[index], weight: isSafest ? 8 : 5, opacity: isSafest ? 1 : .78 } }).addTo(map);
      const minutes = Math.round(route.duration / 60);
      const distance = (route.distance / 1000).toFixed(1);
      const displayedScore = scoreRoute(routes.find(item => item.id === routeId) || routes[index]);
      const routeName = routeStreetLabel(route, `Live OSRM route · ${distance} km`);
      const popupHtml = `<div class="route-popup"><strong>Route ${routeId}${isSafest ? ' · SAFEST SUITABLE' : ''}</strong><span>${escapeHtml(routeName)}</span><span>Risk score: <b>${displayedScore}/100</b></span><span>Estimated time: <b>${minutes} min</b></span><span>Safety level: <b>${safetyLabel(displayedScore)}</b></span></div>`;
      layer.bindPopup(popupHtml);
      liveRouteLayers[routeId] = layer;
      layer.on('click', () => selectLiveRoute(routeId, layer, popupHtml));
      routeNames[routeId] = routeName;
      const localRoute = routes.find(item => item.id === routeId);
      if (localRoute) localRoute.time = minutes;
    });
    L.marker(origin).addTo(map).bindPopup(`<div class="route-popup"><strong>📍 You Are Here</strong><span>${escapeHtml(journey.origin)}</span><span>Live location / route origin</span></div>`);
    L.marker(destination).addTo(map).bindPopup(`<div class="route-popup"><strong>✚ Relief Center</strong><span>${escapeHtml(journey.destination)}</span><span>Emergency destination</span></div>`);
    map.fitBounds(L.latLngBounds([origin, destination]), { padding: [30, 30] });
    if (visibleRoutes.length < 3) {
      const note = document.createElement('div');
      note.className = 'route-availability-note';
      note.textContent = `OSRM returned ${visibleRoutes.length} real road route${visibleRoutes.length === 1 ? '' : 's'} for this journey.`;
      mapNode.appendChild(note);
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'gis-toolbar';
    toolbar.innerHTML = '<button type="button" data-map-action="refresh">↻ Refresh live data</button><button type="button" data-map-action="google">Open in Google Maps ↗</button>';
    mapNode.appendChild(toolbar);
    toolbar.querySelector('[data-map-action="refresh"]').addEventListener('click', async event => {
      event.currentTarget.textContent = 'Refreshing...';
      await Promise.all([syncLiveSituation(), loadLeafletMap()]);
    });
    toolbar.querySelector('[data-map-action="google"]').addEventListener('click', () => window.open(googleJourneyUrl(), '_blank', 'noopener,noreferrer'));
    renderRoutes();
    toast(`Safest real route shown: Route ${String.fromCharCode(65 + safestIndex)}`);
  } catch {
    // Keep the existing prototype map when geocoding or routing is unavailable.
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  renderArchitecture();
  [['waterSlider', 'water'], ['blockageSlider', 'blockage'], ['trafficSlider', 'traffic']].forEach(([id, key]) => $(id).addEventListener('input', event => { updateSlider(key, event.target.value); syncBackend(); }));
  $('resetConditions').addEventListener('click', resetConditions);
  document.querySelector('.edit-journey').addEventListener('click', toggleJourneyEditor);
  const liveLocationButton = document.createElement('button');
  liveLocationButton.className = 'live-location-button';
  liveLocationButton.type = 'button';
  liveLocationButton.textContent = '◎ Use my live location';
  liveLocationButton.addEventListener('click', useLiveLocation);
  document.querySelector('.journey-card').appendChild(liveLocationButton);
  $('analyzeBtn').addEventListener('click', () => { $('routes').scrollIntoView({ behavior: 'smooth' }); toast('Routes analyzed with current emergency conditions'); });
  $('scenarioBtn').addEventListener('click', () => $('simulator').scrollIntoView({ behavior: 'smooth' }));
  $('recalculateBtn').addEventListener('click', () => { renderRoutes(); syncBackend(true); });
  $('menuBtn').addEventListener('click', () => document.querySelector('.main-nav').classList.toggle('open'));
  renderRoutes();
  updateGoogleJourneyLinks();
  bindGoogleMapPoints();
  await loadJourney();
  renderRoutes();
  syncGoogleRoutes();
  loadGoogleMap();
  loadLeafletMap();
  syncBackend();
  syncLiveSituation();
  getLiveLocation().catch(() => {});
  window.setInterval(syncLiveSituation, 300000);
});