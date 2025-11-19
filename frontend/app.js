const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="32" fill="%23e0f2f1"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="60" font-family="Arial" fill="%230f766e">☕</text></svg>';

const FALLBACK_CAFES = [
  {
    id: 'cafe-1',
    name: 'Beirut Downtown Café',
    address: 'Downtown Beirut',
    location_lat: 33.895,
    location_lng: 35.478
  },
  {
    id: 'cafe-2',
    name: 'Hamra Coffee Corner',
    address: 'Hamra Street',
    location_lat: 33.897,
    location_lng: 35.48
  },
  {
    id: 'cafe-3',
    name: 'Gemmayzeh Espresso Bar',
    address: 'Gouraud Street, Gemmayzeh',
    location_lat: 33.8987,
    location_lng: 35.5196
  },
  {
    id: 'cafe-4',
    name: 'Mar Mikhael Roastery',
    address: 'Armenia Street, Mar Mikhael',
    location_lat: 33.8974,
    location_lng: 35.5332
  }
];

const ECO_STORAGE_KEY = 'recup_eco_stats';
const ECO_CONFIG = {
  targetCycles: 40,
  co2PerCycleKg: 0.08,
  waterPerCycleL: 0.5,
  landfillCupsPerCycle: 1
};
const ECO_DEFAULT_STATS = {
  customer: { borrows: 0, returns: 0 },
  cafe: { borrows: 0, returns: 0 }
};

const state = {
  token: localStorage.getItem('recup_token') || null,
  user: null,
  cafes: [],
  ecoStats: loadEcoStats()
};

let pendingPhotoClear = false;
let qrScannerInstance = null;
let scannerRunning = false;
let activeQrInput = null;
let lastScan = '';
let cafeMapController = null;

const els = {
  authSection: document.getElementById('authSection'),
  customerSection: document.getElementById('customerSection'),
  staffSection: document.getElementById('staffSection'),
  messages: document.getElementById('messages'),
  customerInfo: document.getElementById('customerInfo'),
  staffInfo: document.getElementById('staffInfo'),
  customerBorrowCafe: document.getElementById('customerBorrowCafe'),
  customerReturnCafe: document.getElementById('customerReturnCafe'),
  staffCafeSelect: document.getElementById('staffCafeSelect'),
  transactionList: document.getElementById('transactionList'),
  logoutBtn: document.getElementById('logoutBtn'),
  inventoryInfo: document.getElementById('inventoryInfo'),
  profileAvatar: document.getElementById('profileAvatar'),
  profileName: document.getElementById('profileName'),
  profileNameInput: document.getElementById('profileNameInput'),
  profileImageInput: document.getElementById('profileImageInput'),
  profileForm: document.getElementById('profileForm'),
  clearProfileImage: document.getElementById('clearProfileImage'),
  scannerSection: document.getElementById('scannerSection'),
  startScannerBtn: document.getElementById('startScannerBtn'),
  stopScannerBtn: document.getElementById('stopScannerBtn'),
  qrScannerStatus: document.getElementById('qrScannerStatus'),
  cafeMap: document.getElementById('cafeMap'),
  cafeList: document.getElementById('cafeList'),
  routeNearestBtn: document.getElementById('routeNearestBtn'),
  nearestDirectionsLink: document.getElementById('nearestDirectionsLink'),
  mapEmptyState: document.getElementById('mapEmptyState'),
  customerEcoMetrics: document.getElementById('customerEcoMetrics'),
  customerEcoNarrative: document.getElementById('customerEcoNarrative'),
  customerTreeFill: document.getElementById('customerTreeFill'),
  customerTreePercent: document.getElementById('customerTreePercent'),
  cafeEcoMetrics: document.getElementById('cafeEcoMetrics'),
  cafeEcoNarrative: document.getElementById('cafeEcoNarrative'),
  cafeTreeFill: document.getElementById('cafeTreeFill'),
  cafeTreePercent: document.getElementById('cafeTreePercent')
};

const qrInputs = Array.from(document.querySelectorAll('[data-qr-input]'));
const defaultScanInput = document.querySelector('[data-scan-default="true"]');
if (els.profileAvatar) {
  els.profileAvatar.src = DEFAULT_AVATAR;
}

function cloneEcoDefaults() {
  return {
    customer: Object.assign({}, ECO_DEFAULT_STATS.customer),
    cafe: Object.assign({}, ECO_DEFAULT_STATS.cafe)
  };
}

function loadEcoStats() {
  try {
    const stored = localStorage.getItem(ECO_STORAGE_KEY);
    if (!stored) {
      return cloneEcoDefaults();
    }
    const parsed = JSON.parse(stored);
    return {
      customer: Object.assign({}, ECO_DEFAULT_STATS.customer, parsed.customer),
      cafe: Object.assign({}, ECO_DEFAULT_STATS.cafe, parsed.cafe)
    };
  } catch (err) {
    console.warn('Unable to load eco stats, resetting to defaults', err);
    return cloneEcoDefaults();
  }
}

function saveEcoStats() {
  try {
    localStorage.setItem(ECO_STORAGE_KEY, JSON.stringify(state.ecoStats));
  } catch (err) {
    console.warn('Unable to persist eco stats', err);
  }
}

function calculateEcoMetrics(stats = { borrows: 0, returns: 0 }) {
  const borrows = Number(stats.borrows || 0);
  const returns = Number(stats.returns || 0);
  const completedCycles = Math.max(0, Math.min(borrows, returns));
  const cupsDiverted = completedCycles * ECO_CONFIG.landfillCupsPerCycle;
  const co2SavedKg = completedCycles * ECO_CONFIG.co2PerCycleKg;
  const waterSavedL = completedCycles * ECO_CONFIG.waterPerCycleL;
  const progressPercent = Math.min(100, Math.round((completedCycles / ECO_CONFIG.targetCycles) * 100));
  return {
    cycles: completedCycles,
    cupsDiverted,
    co2SavedKg,
    waterSavedL,
    progressPercent
  };
}

function buildEcoMetricsMarkup(metrics) {
  const items = [
    { label: 'Cycles completed', value: metrics.cycles },
    { label: 'Cups rescued', value: metrics.cupsDiverted },
    { label: 'CO₂ saved', value: `${metrics.co2SavedKg.toFixed(2)} kg` },
    { label: 'Water saved', value: `${metrics.waterSavedL.toFixed(1)} L` }
  ];
  return items
    .map(item => {
      const label = escapeHtml(item.label);
      const value = escapeHtml(String(item.value));
      return `<li class="eco-metric"><span class="eco-metric__label">${label}</span><span class="eco-metric__value">${value}</span></li>`;
    })
    .join('');
}

function buildEcoNarrative(scope, metrics) {
  const actorName = state.user && state.user.name ? state.user.name : scope === 'customer' ? 'You' : 'Your team';
  if (!metrics.cycles) {
    return `${actorName} can grow this tree by completing a full borrow & return cycle.`;
  }
  const cupsText = metrics.cupsDiverted === 1 ? 'cup' : 'cups';
  return `${actorName} kept ${metrics.cupsDiverted} single-use ${cupsText} in circulation and filled this tree to ${metrics.progressPercent}%.`;
}

function updateEcoDashboard(scope, refs) {
  if (!state.ecoStats) {
    state.ecoStats = cloneEcoDefaults();
  }
  const metrics = calculateEcoMetrics(state.ecoStats[scope] || ECO_DEFAULT_STATS[scope]);
  if (refs.metricsEl) {
    refs.metricsEl.innerHTML = buildEcoMetricsMarkup(metrics);
  }
  if (refs.treeFillEl) {
    refs.treeFillEl.style.height = `${metrics.progressPercent}%`;
  }
  if (refs.percentEl) {
    refs.percentEl.textContent = `${metrics.progressPercent}%`;
  }
  if (refs.narrativeEl) {
    refs.narrativeEl.textContent = buildEcoNarrative(scope, metrics);
  }
}

function updateEcoDashboards() {
  updateEcoDashboard('customer', {
    metricsEl: els.customerEcoMetrics,
    narrativeEl: els.customerEcoNarrative,
    treeFillEl: els.customerTreeFill,
    percentEl: els.customerTreePercent
  });
  updateEcoDashboard('cafe', {
    metricsEl: els.cafeEcoMetrics,
    narrativeEl: els.cafeEcoNarrative,
    treeFillEl: els.cafeTreeFill,
    percentEl: els.cafeTreePercent
  });
}

function recordEcoEvent(scope, type) {
  if (!state.ecoStats) {
    state.ecoStats = cloneEcoDefaults();
  }
  if (!state.ecoStats[scope]) {
    state.ecoStats[scope] = { borrows: 0, returns: 0 };
  }
  const key = type === 'borrow' ? 'borrows' : 'returns';
  state.ecoStats[scope][key] = Math.max(0, Number(state.ecoStats[scope][key] || 0) + 1);
  saveEcoStats();
  updateEcoDashboards();
}

updateEcoDashboards();

function showMessage(text, type = 'success') {
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.className = `toast ${type}`;
  els.messages.prepend(toast);
  setTimeout(() => toast.remove(), 5000);
}

function setScannerStatus(text) {
  if (els.qrScannerStatus) {
    els.qrScannerStatus.textContent = text;
  }
}

function focusTrackingSetup() {
  qrInputs.forEach(input => {
    input.addEventListener('focus', () => {
      activeQrInput = input;
      setScannerStatus(`Scanner ready → ${input.id || 'QR input'}`);
    });
    input.addEventListener('click', () => {
      activeQrInput = input;
      setScannerStatus(`Scanner ready → ${input.id || 'QR input'}`);
    });
  });
  if (!activeQrInput) {
    activeQrInput = defaultScanInput || qrInputs[0] || null;
  }
}

function populateCafeSelects() {
  const selects = [els.customerBorrowCafe, els.customerReturnCafe, els.staffCafeSelect];
  selects.forEach(select => {
    if (!select) return;
    select.innerHTML = '';
    state.cafes.forEach(cafe => {
      const option = document.createElement('option');
      option.value = cafe.id;
      option.textContent = cafe.name;
      select.appendChild(option);
    });
  });
}

function hasCafeCoordinates(cafe) {
  return (
    cafe &&
    typeof cafe.location_lat === 'number' &&
    !Number.isNaN(cafe.location_lat) &&
    typeof cafe.location_lng === 'number' &&
    !Number.isNaN(cafe.location_lng)
  );
}

function buildGoogleMapsLink(cafe) {
  if (hasCafeCoordinates(cafe)) {
    return `https://www.google.com/maps/search/?api=1&query=${cafe.location_lat},${cafe.location_lng}`;
  }
  const query = encodeURIComponent(`${cafe.name || 'ReCup cafe'} ${cafe.address || ''}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function escapeHtml(value) {
  const safeValue = value === undefined || value === null ? '' : String(value);
  return safeValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TILE_SIZE = 256;
const DEFAULT_MAP_CENTER = { lat: 33.8938, lng: 35.5018 };
const DEFAULT_MAP_ZOOM = 12;
const MIN_MAP_ZOOM = 11;
const MAX_MAP_ZOOM = 17;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function projectPoint(lat, lng) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)
  };
}

function unprojectPoint(x, y) {
  const lng = x * 360 - 180;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
  return { lat, lng };
}

class CafeTileMap {
  constructor(container) {
    this.container = container;
    this.center = Object.assign({}, DEFAULT_MAP_CENTER);
    this.zoom = DEFAULT_MAP_ZOOM;
    this.cafes = [];
    this.markerElements = new Map();
    this.markerPositions = new Map();
    this.activeMarkerId = null;
    this.isDragging = false;
    this.dragStart = null;
    this.dragPointerId = null;
    this.setupLayers();
    this.bindEvents();
    this.render();
  }

  setupLayers() {
    this.container.innerHTML = '';
    this.container.classList.add('tile-map');
    this.tilesLayer = document.createElement('div');
    this.tilesLayer.className = 'tile-map__tiles';
    this.markersLayer = document.createElement('div');
    this.markersLayer.className = 'tile-map__markers';
    this.popupEl = document.createElement('div');
    this.popupEl.className = 'tile-map__popup hidden';
    this.container.append(this.tilesLayer, this.markersLayer, this.popupEl);
    this.controls = document.createElement('div');
    this.controls.className = 'tile-map__control';
    const zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.textContent = '+';
    zoomIn.setAttribute('aria-label', 'Zoom in');
    zoomIn.addEventListener('click', () => this.setZoom(this.zoom + 1));
    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.textContent = '−';
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomOut.addEventListener('click', () => this.setZoom(this.zoom - 1));
    this.controls.append(zoomIn, zoomOut);
    this.container.appendChild(this.controls);
  }

  bindEvents() {
    this.container.addEventListener('pointerdown', evt => this.handlePointerDown(evt));
    this.container.addEventListener('pointermove', evt => this.handlePointerMove(evt));
    this.container.addEventListener('pointerup', evt => this.handlePointerUp(evt));
    this.container.addEventListener('pointerleave', evt => this.handlePointerUp(evt));
    this.container.addEventListener(
      'wheel',
      evt => {
        evt.preventDefault();
        const direction = evt.deltaY > 0 ? -1 : 1;
        this.setZoom(this.zoom + direction);
      },
      { passive: false }
    );
    window.addEventListener('resize', () => this.render());
    this.container.addEventListener('click', evt => {
      if (evt.target === this.container) {
        this.clearPopup();
      }
    });
  }

  isInteractiveTarget(target) {
    if (!target) return false;
    return Boolean(
      target.closest('.tile-map__control') ||
        target.closest('.tile-map__popup') ||
        target.closest('.map-marker')
    );
  }

  handlePointerDown(evt) {
    if ((evt.button !== undefined && evt.button !== 0) || this.isInteractiveTarget(evt.target)) {
      return;
    }
    this.isDragging = true;
    this.dragPointerId = evt.pointerId;
    this.container.classList.add('is-dragging');
    if (this.container.setPointerCapture) {
      this.container.setPointerCapture(evt.pointerId);
    }
    const mapSize = this.getMapSize();
    const centerPx = this.getCenterPx(mapSize);
    this.dragStart = {
      x: evt.clientX,
      y: evt.clientY,
      centerPx
    };
  }

  handlePointerMove(evt) {
    if (!this.isDragging || evt.pointerId !== this.dragPointerId) return;
    if (!this.dragStart) return;
    const deltaX = evt.clientX - this.dragStart.x;
    const deltaY = evt.clientY - this.dragStart.y;
    this.panBy(deltaX, deltaY);
  }

  handlePointerUp(evt) {
    if (evt && evt.pointerId && evt.pointerId !== this.dragPointerId) return;
    this.isDragging = false;
    this.dragPointerId = null;
    this.dragStart = null;
    this.container.classList.remove('is-dragging');
    if (evt && this.container.releasePointerCapture) {
      try {
        this.container.releasePointerCapture(evt.pointerId);
      } catch (err) {
        // Ignore release errors when pointer capture is not set.
      }
    }
  }

  getMapSize() {
    return TILE_SIZE * Math.pow(2, this.zoom);
  }

  getCenterPx(mapSize) {
    const projected = projectPoint(this.center.lat, this.center.lng);
    return {
      x: projected.x * mapSize,
      y: projected.y * mapSize
    };
  }

  panBy(deltaX, deltaY) {
    const mapSize = this.getMapSize();
    const startPx = this.dragStart ? this.dragStart.centerPx : this.getCenterPx(mapSize);
    let newX = startPx.x - deltaX;
    let newY = startPx.y - deltaY;
    newX = mod(newX, mapSize);
    newY = clamp(newY, 0, mapSize);
    const xNorm = newX / mapSize;
    const yNorm = newY / mapSize;
    this.center = unprojectPoint(xNorm, yNorm);
    this.render();
  }

  setZoom(value) {
    const clamped = clamp(value, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
    if (clamped === this.zoom) return;
    this.zoom = clamped;
    this.render();
  }

  setCafes(cafes) {
    this.cafes = cafes.slice();
    if (!this.cafes.length) {
      this.center = Object.assign({}, DEFAULT_MAP_CENTER);
      this.zoom = DEFAULT_MAP_ZOOM;
    }
    this.markerElements.clear();
    this.markerPositions = new Map();
    this.render();
  }

  fitToCafes() {
    if (!this.cafes.length) {
      this.center = Object.assign({}, DEFAULT_MAP_CENTER);
      this.zoom = DEFAULT_MAP_ZOOM;
      this.render();
      return;
    }
    const projected = this.cafes.map(cafe => projectPoint(cafe.location_lat, cafe.location_lng));
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    projected.forEach(point => {
      xMin = Math.min(xMin, point.x);
      xMax = Math.max(xMax, point.x);
      yMin = Math.min(yMin, point.y);
      yMax = Math.max(yMax, point.y);
    });
    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 400;
    const padding = 0.08;
    const zoomX = Math.log2(width / (TILE_SIZE * Math.max(xMax - xMin, 0.0001) * (1 + padding)));
    const zoomY = Math.log2(height / (TILE_SIZE * Math.max(yMax - yMin, 0.0001) * (1 + padding)));
    let targetZoom = Math.min(zoomX, zoomY);
    if (!Number.isFinite(targetZoom)) {
      targetZoom = DEFAULT_MAP_ZOOM;
    }
    targetZoom = clamp(Math.floor(targetZoom), MIN_MAP_ZOOM, MAX_MAP_ZOOM);
    const centerX = (xMin + xMax) / 2;
    const centerY = (yMin + yMax) / 2;
    this.center = unprojectPoint(centerX, centerY);
    this.zoom = targetZoom;
    this.render();
  }

  render() {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    if (!this.width || !this.height) return;
    const mapSize = this.getMapSize();
    const centerPx = this.getCenterPx(mapSize);
    this.view = {
      mapSize,
      topLeftX: centerPx.x - this.width / 2,
      topLeftY: centerPx.y - this.height / 2
    };
    this.renderTiles();
    this.renderMarkers();
  }

  renderTiles() {
    if (!this.view) return;
    const { mapSize, topLeftX, topLeftY } = this.view;
    const tileCount = Math.pow(2, this.zoom);
    const xStart = Math.floor(topLeftX / TILE_SIZE) - 1;
    const xEnd = Math.floor((topLeftX + this.width) / TILE_SIZE) + 1;
    const yStart = Math.floor(topLeftY / TILE_SIZE) - 1;
    const yEnd = Math.floor((topLeftY + this.height) / TILE_SIZE) + 1;
    this.tilesLayer.innerHTML = '';
    for (let x = xStart; x <= xEnd; x += 1) {
      for (let y = yStart; y <= yEnd; y += 1) {
        if (y < 0 || y >= tileCount) continue;
        const tile = document.createElement('img');
        const tileX = mod(x, tileCount);
        tile.src = `https://tile.openstreetmap.org/${this.zoom}/${tileX}/${y}.png`;
        tile.alt = '';
        tile.draggable = false;
        tile.loading = 'lazy';
        tile.style.left = `${x * TILE_SIZE - topLeftX}px`;
        tile.style.top = `${y * TILE_SIZE - topLeftY}px`;
        this.tilesLayer.appendChild(tile);
      }
    }
  }

  renderMarkers() {
    if (!this.view) return;
    const { mapSize, topLeftX, topLeftY } = this.view;
    this.markersLayer.innerHTML = '';
    this.markerElements.clear();
    this.markerPositions.clear();
    this.cafes.forEach(cafe => {
      const projected = projectPoint(cafe.location_lat, cafe.location_lng);
      const px = projected.x * mapSize;
      const py = projected.y * mapSize;
      const left = px - topLeftX;
      const top = py - topLeftY;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'map-marker';
      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
      marker.innerHTML = '<span></span>';
      marker.title = cafe.name || 'ReCup café';
      marker.setAttribute('aria-label', `${cafe.name || 'ReCup café'} marker`);
      marker.addEventListener('click', evt => {
        evt.stopPropagation();
        this.focusCafe(cafe.id, { pan: false, showPopup: true });
      });
      if (this.activeMarkerId === cafe.id) {
        marker.classList.add('is-active');
      }
      this.markersLayer.appendChild(marker);
      this.markerElements.set(cafe.id, marker);
      this.markerPositions.set(cafe.id, { left, top });
    });
    if (this.activeMarkerId && !this.markerElements.has(this.activeMarkerId)) {
      this.clearPopup();
    }
  }

  focusCafe(cafeId, options = {}) {
    if (!cafeId) {
      this.clearPopup();
      return;
    }
    const cafe = this.cafes.find(c => c.id === cafeId);
    if (!cafe) return;
    if (options.pan !== false) {
      this.center = { lat: cafe.location_lat, lng: cafe.location_lng };
      this.render();
    }
    this.highlightMarker(cafeId);
    if (options.showPopup !== false) {
      this.showPopup(cafe);
    }
  }

  highlightMarker(cafeId) {
    this.activeMarkerId = cafeId;
    this.markerElements.forEach((el, id) => {
      el.classList.toggle('is-active', id === cafeId);
    });
  }

  showPopup(cafe) {
    if (!this.markerPositions.has(cafe.id)) {
      this.renderMarkers();
    }
    const position = this.markerPositions.get(cafe.id);
    if (!position) return;
    this.popupEl.innerHTML = buildCafePopupHtml(cafe);
    this.popupEl.classList.remove('hidden');
    const popupWidth = this.popupEl.offsetWidth || 240;
    let left = position.left + 12;
    let top = position.top - 16;
    if (left + popupWidth > this.width) {
      left = Math.max(16, this.width - popupWidth - 16);
    }
    if (top < 16) {
      top = position.top + 16;
    }
    this.popupEl.style.left = `${left}px`;
    this.popupEl.style.top = `${top}px`;
  }

  clearPopup() {
    this.activeMarkerId = null;
    this.popupEl.classList.add('hidden');
    this.markerElements.forEach(el => el.classList.remove('is-active'));
  }
}

function ensureCafeMap() {
  if (!els.cafeMap) return null;
  if (!cafeMapController) {
    cafeMapController = new CafeTileMap(els.cafeMap);
  }
  return cafeMapController;
}

function buildCafePopupHtml(cafe) {
  const safeName = escapeHtml(cafe.name || 'ReCup café');
  const safeAddress = escapeHtml(cafe.address || 'Address coming soon');
  const mapsLink = buildGoogleMapsLink(cafe);
  const directionsLink = buildDirectionsUrl(null, cafe);
  return `
    <div class="map-popup">
      <strong>${safeName}</strong>
      <p>${safeAddress}</p>
      <div class="map-popup__actions">
        <a href="${mapsLink}" target="_blank" rel="noopener">Open in Google Maps</a>
        <a href="${directionsLink}" target="_blank" rel="noopener">Directions</a>
      </div>
    </div>
  `;
}

function updateCafeMap() {
  const map = ensureCafeMap();
  const cafesWithCoords = state.cafes.filter(hasCafeCoordinates);
  if (els.mapEmptyState) {
    els.mapEmptyState.classList.toggle('hidden', Boolean(cafesWithCoords.length));
  }
  if (!map) return;
  map.setCafes(cafesWithCoords);
  if (cafesWithCoords.length) {
    map.fitToCafes();
  } else {
    map.clearPopup();
  }
}

function openDirectionsToCafe(cafe) {
  const url = buildGoogleMapsLink(cafe);
  window.open(url, '_blank');
}

function renderCafeList() {
  if (!els.cafeList) return;
  els.cafeList.innerHTML = '';
  state.cafes.forEach(cafe => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.addEventListener('mouseenter', () => highlightMapMarker(cafe.id));
    li.addEventListener('focusin', () => highlightMapMarker(cafe.id));
    li.addEventListener('mouseleave', () => highlightMapMarker(null));
    li.addEventListener('focusout', () => highlightMapMarker(null));
    const title = document.createElement('strong');
    title.textContent = cafe.name;
    const meta = document.createElement('div');
    meta.className = 'cafe-meta';
    meta.textContent = cafe.address || 'Address coming soon';
    const actions = document.createElement('div');
    actions.className = 'cafe-actions';
    const link = document.createElement('a');
    link.href = buildGoogleMapsLink(cafe);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open in Google Maps';
    actions.appendChild(link);
    if (hasCafeCoordinates(cafe)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost';
      button.textContent = 'Route here';
      button.addEventListener('click', () => openDirectionsToCafe(cafe));
      actions.appendChild(button);
    }
    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(actions);
    els.cafeList.appendChild(li);
  });
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildDirectionsUrl(origin, cafe) {
  const destination = hasCafeCoordinates(cafe)
    ? `${cafe.location_lat},${cafe.location_lng}`
    : encodeURIComponent(cafe.address || cafe.name || 'ReCup cafe');
  if (origin) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

function routeToNearestCafe() {
  if (!navigator.geolocation) {
    showMessage('Your browser does not support geolocation', 'error');
    return;
  }
  const cafesWithCoords = state.cafes.filter(hasCafeCoordinates);
  if (!cafesWithCoords.length) {
    showMessage('Cafés do not have map coordinates yet', 'error');
    return;
  }
  if (els.routeNearestBtn) {
    els.routeNearestBtn.disabled = true;
    els.routeNearestBtn.textContent = 'Locating…';
  }
  navigator.geolocation.getCurrentPosition(
    position => {
      const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
      const nearest = cafesWithCoords.reduce((closest, cafe) => {
        const distance = haversineDistance(origin.lat, origin.lng, cafe.location_lat, cafe.location_lng);
        if (!closest || distance < closest.distance) {
          return { cafe, distance };
        }
        return closest;
      }, null);
      if (nearest) {
        const url = buildDirectionsUrl(origin, nearest.cafe);
        if (els.nearestDirectionsLink) {
          els.nearestDirectionsLink.href = url;
          els.nearestDirectionsLink.textContent = `Directions to ${nearest.cafe.name}`;
        }
        highlightMapMarker(nearest.cafe.id);
        window.open(url, '_blank');
        showMessage(`Nearest café: ${nearest.cafe.name} (${nearest.distance.toFixed(2)} km away)`);
      }
      if (els.routeNearestBtn) {
        els.routeNearestBtn.disabled = false;
        els.routeNearestBtn.textContent = 'Route to nearest café';
      }
    },
    () => {
      showMessage('Location permission denied', 'error');
      if (els.routeNearestBtn) {
        els.routeNearestBtn.disabled = false;
        els.routeNearestBtn.textContent = 'Route to nearest café';
      }
    }
  );
}

function highlightMapMarker(cafeId) {
  const map = ensureCafeMap();
  if (!map) return;
  if (!cafeId) {
    map.clearPopup();
    return;
  }
  map.focusCafe(cafeId, { pan: true, showPopup: true });
}

async function fetchCafes() {
  let cafes = [];
  let usedFallback = false;
  try {
    const res = await fetch('/cafes');
    const data = await res.json();
    cafes = data.cafes || [];
  } catch (err) {
    console.error('Failed to load cafes', err);
    cafes = FALLBACK_CAFES;
    usedFallback = true;
    showMessage('Unable to load cafés right now. Showing seeded map view.', 'error');
  } finally {
    if (!cafes.length) {
      cafes = FALLBACK_CAFES;
      usedFallback = true;
    }
    state.cafes = cafes.map(cafe => Object.assign({}, cafe));
    populateCafeSelects();
    updateCafeMap();
    renderCafeList();
    if (els.nearestDirectionsLink) {
      const fallbackCafe = state.cafes[0];
      els.nearestDirectionsLink.href = fallbackCafe ? buildGoogleMapsLink(fallbackCafe) : 'https://maps.google.com';
      els.nearestDirectionsLink.textContent = fallbackCafe
        ? `Google Maps: ${fallbackCafe.name}`
        : 'Google Maps link';
    }
    if (usedFallback) {
      console.warn('Using fallback cafe dataset for map rendering.');
    }
  }
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(path, Object.assign({}, options, { headers }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && data.error ? data.error : 'Request failed';
    throw new Error(message);
  }
  return data;
}

function updateUI() {
  const loggedIn = Boolean(state.user);
  if (els.scannerSection) {
    if (loggedIn) {
      els.scannerSection.classList.remove('hidden');
    } else {
      els.scannerSection.classList.add('hidden');
      stopScanner();
      setScannerStatus('Scanner idle');
    }
  }
  if (state.user) {
    els.authSection.classList.add('hidden');
    els.logoutBtn.classList.remove('hidden');
    if (state.user.role === 'CUSTOMER') {
      els.customerSection.classList.remove('hidden');
      els.staffSection.classList.add('hidden');
      updateProfileCard();
    } else if (state.user.role === 'CAFE_STAFF' || state.user.role === 'ADMIN') {
      els.staffSection.classList.remove('hidden');
      els.customerSection.classList.add('hidden');
      els.staffInfo.textContent = `${state.user.name || state.user.email} (${state.user.role})`;
      if (els.profileAvatar) {
        els.profileAvatar.src = DEFAULT_AVATAR;
      }
    } else {
      els.customerSection.classList.add('hidden');
      els.staffSection.classList.add('hidden');
    }
  } else {
    els.authSection.classList.remove('hidden');
    els.customerSection.classList.add('hidden');
    els.staffSection.classList.add('hidden');
    els.logoutBtn.classList.add('hidden');
    els.customerInfo.innerHTML = '';
    els.staffInfo.textContent = '';
    els.transactionList.innerHTML = '';
    pendingPhotoClear = false;
    if (els.profileAvatar) {
      els.profileAvatar.src = DEFAULT_AVATAR;
    }
  }
  updateEcoDashboards();
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem('recup_token', token);
  } else {
    localStorage.removeItem('recup_token');
  }
  updateUI();
}

function formatProfile(user) {
  const stats = [
    { label: 'Balance', value: `$${(user.deposit_balance || 0).toFixed(2)}` },
    { label: 'Points', value: user.reward_points || 0 },
    { label: 'Active borrows', value: user.active_borrow_count || 0 }
  ];
  return stats
    .map(stat => {
      const label = escapeHtml(stat.label);
      const value = escapeHtml(stat.value);
      return `<span class="stat-chip"><span class="stat-chip__label">${label}</span><span class="stat-chip__value">${value}</span></span>`;
    })
    .join('');
}

function setAvatarSrc(src) {
  if (els.profileAvatar) {
    els.profileAvatar.src = src || DEFAULT_AVATAR;
  }
}

function updateProfileCard() {
  if (!state.user || state.user.role !== 'CUSTOMER') return;
  setAvatarSrc(state.user.profile_image || DEFAULT_AVATAR);
  if (els.profileName) {
    els.profileName.textContent = state.user.name || 'ReCup customer';
  }
  if (els.profileNameInput) {
    els.profileNameInput.value = state.user.name || '';
  }
  if (els.customerInfo) {
    els.customerInfo.innerHTML = formatProfile(state.user);
  }
  pendingPhotoClear = false;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

async function loadProfile() {
  if (!state.token) return;
  try {
    const data = await apiFetch('/user/profile');
    state.user = data.user;
    if (state.user.role === 'CUSTOMER') {
      updateProfileCard();
    } else {
      els.staffInfo.textContent = `${state.user.name || state.user.email} (${state.user.role})`;
    }
  } catch (err) {
    showMessage(err.message, 'error');
  }
  updateUI();
}

async function loadTransactions() {
  if (!state.token || !state.user || state.user.role !== 'CUSTOMER') return;
  try {
    const data = await apiFetch('/user/transactions?limit=10');
    els.transactionList.innerHTML = '';
    data.transactions.forEach(tx => {
      const li = document.createElement('li');
      li.textContent = `${tx.type} • Cup ${tx.cup_id} • ${new Date(tx.created_at).toLocaleString()}`;
      els.transactionList.appendChild(li);
    });
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function handleProfileSubmit(evt) {
  evt.preventDefault();
  if (!state.user || state.user.role !== 'CUSTOMER') {
    showMessage('Only customers can edit this profile', 'error');
    return;
  }
  const payload = { name: (els.profileNameInput.value || '').trim() };
  if (!payload.name) {
    payload.name = state.user.name || '';
  }
  if (pendingPhotoClear) {
    payload.profile_image = '';
  } else if (els.profileImageInput && els.profileImageInput.files && els.profileImageInput.files[0]) {
    try {
      payload.profile_image = await fileToDataUrl(els.profileImageInput.files[0]);
    } catch (err) {
      showMessage('Failed to read photo', 'error');
      return;
    }
  }
  try {
    const data = await apiFetch('/user/profile', { method: 'PUT', body: JSON.stringify(payload) });
    state.user = data.user;
    updateProfileCard();
    showMessage('Profile updated');
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    pendingPhotoClear = false;
    if (els.profileImageInput) {
      els.profileImageInput.value = '';
    }
  }
}

async function handleProfileImageChange(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  pendingPhotoClear = false;
  try {
    const preview = await fileToDataUrl(file);
    setAvatarSrc(preview);
  } catch (err) {
    showMessage('Could not preview file', 'error');
  }
}

function handleClearProfileImage() {
  pendingPhotoClear = true;
  setAvatarSrc(DEFAULT_AVATAR);
  if (els.profileImageInput) {
    els.profileImageInput.value = '';
  }
  showMessage('Photo will be removed after saving');
}

function extractCupId(value) {
  if (!value) return '';
  const trimmed = value.trim();
  try {
    // QRs encode `https://recup.app/cup/<cup_id>` per the spec. Allow users to
    // paste the full URL and keep only the identifier portion.
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1];
  } catch (err) {
    return trimmed;
  }
}

async function startScanner() {
  if (scannerRunning) {
    setScannerStatus('Scanner already running');
    return;
  }
  if (typeof window.Html5Qrcode === 'undefined') {
    setScannerStatus('Scanner library is loading…');
    showMessage('Scanner library not ready yet', 'error');
    return;
  }
  if (!qrScannerInstance) {
    qrScannerInstance = new Html5Qrcode('qrScanner');
  }
  try {
    await qrScannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      handleScanSuccess,
      handleScanFailure
    );
    scannerRunning = true;
    setScannerStatus('Scanner active – point your camera at a QR');
  } catch (err) {
    console.error('Scanner failed', err);
    showMessage('Camera permission denied', 'error');
    setScannerStatus('Camera unavailable');
  }
}

async function stopScanner() {
  if (qrScannerInstance && scannerRunning) {
    try {
      await qrScannerInstance.stop();
    } catch (err) {
      console.warn('Failed to stop scanner', err);
    }
  }
  scannerRunning = false;
  setScannerStatus('Scanner idle');
}

function handleScanSuccess(decodedText) {
  if (!decodedText || decodedText === lastScan) return;
  lastScan = decodedText;
  setTimeout(() => {
    lastScan = '';
  }, 1200);
  const normalized = extractCupId(decodedText);
  if (!normalized) return;
  const target = activeQrInput || defaultScanInput;
  if (target) {
    target.value = normalized;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  showMessage(`Captured cup ${normalized}`);
  setScannerStatus(`Last scan → ${normalized}`);
}

function handleScanFailure() {
  // html5-qrcode continuously calls this on decode errors; no action needed.
}

function getSelectedCafe(selectElement) {
  return selectElement && selectElement.value ? selectElement.value : null;
}

async function handleCustomerBorrow(evt) {
  evt.preventDefault();
  const cafeId = getSelectedCafe(els.customerBorrowCafe);
  const cupId = extractCupId(document.getElementById('customerBorrowQr').value);
  if (!cafeId || !cupId) {
    showMessage('Cafe and cup are required', 'error');
    return;
  }
  try {
    await apiFetch(`/cups/${encodeURIComponent(cupId)}/borrow`, {
      method: 'POST',
      body: JSON.stringify({ cafe_id: cafeId })
    });
    showMessage('Cup borrowed successfully');
    recordEcoEvent('customer', 'borrow');
    await loadProfile();
    await loadTransactions();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function handleCustomerReturn(evt) {
  evt.preventDefault();
  const cafeId = getSelectedCafe(els.customerReturnCafe);
  const cupId = extractCupId(document.getElementById('customerReturnQr').value);
  if (!cafeId || !cupId) {
    showMessage('Cafe and cup are required', 'error');
    return;
  }
  try {
    await apiFetch(`/cups/${encodeURIComponent(cupId)}/return`, {
      method: 'POST',
      body: JSON.stringify({ cafe_id: cafeId })
    });
    showMessage('Cup returned successfully');
    recordEcoEvent('customer', 'return');
    await loadProfile();
    await loadTransactions();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function handleCustomerPurchase(evt) {
  evt.preventDefault();
  const cupId = extractCupId(document.getElementById('customerPurchaseQr').value);
  if (!cupId) {
    showMessage('Cup ID required', 'error');
    return;
  }
  try {
    await apiFetch(`/cups/${encodeURIComponent(cupId)}/purchase`, { method: 'POST', body: JSON.stringify({}) });
    showMessage('Cup kept successfully');
    await loadProfile();
    await loadTransactions();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function handleStaffBorrow(evt) {
  evt.preventDefault();
  const cafeId = getSelectedCafe(els.staffCafeSelect);
  const cupId = extractCupId(document.getElementById('staffBorrowQr').value);
  const email = document.getElementById('staffCustomerEmail').value;
  if (!cafeId || !cupId || !email) {
    showMessage('Cafe, cup, and customer email required', 'error');
    return;
  }
  try {
    await apiFetch(`/cups/${encodeURIComponent(cupId)}/borrow`, {
      method: 'POST',
      body: JSON.stringify({ cafe_id: cafeId, customer_email: email })
    });
    showMessage('Borrow recorded');
    recordEcoEvent('cafe', 'borrow');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function handleStaffReturn(evt) {
  evt.preventDefault();
  const cafeId = getSelectedCafe(els.staffCafeSelect);
  const cupId = extractCupId(document.getElementById('staffReturnQr').value);
  if (!cafeId || !cupId) {
    showMessage('Cafe and cup required', 'error');
    return;
  }
  try {
    await apiFetch(`/cups/${encodeURIComponent(cupId)}/return`, {
      method: 'POST',
      body: JSON.stringify({ cafe_id: cafeId })
    });
    showMessage('Return accepted');
    recordEcoEvent('cafe', 'return');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function refreshInventory() {
  const cafeId = getSelectedCafe(els.staffCafeSelect);
  if (!cafeId) {
    showMessage('Select a cafe', 'error');
    return;
  }
  try {
    const data = await apiFetch(`/cafes/${encodeURIComponent(cafeId)}/inventory`);
    els.inventoryInfo.textContent = `${data.available_count} available cups`;
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function attachEventListeners() {
  document.getElementById('registerForm').addEventListener('submit', async evt => {
    evt.preventDefault();
    const form = evt.target;
    const payload = {
      name: form.name.value,
      email: form.email.value,
      password: form.password.value
    };
    try {
      const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      showMessage('Registered! Logged in as customer.');
      setAuth(data.token, data.user);
      await loadProfile();
      await loadTransactions();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  document.getElementById('loginForm').addEventListener('submit', async evt => {
    evt.preventDefault();
    const form = evt.target;
    const payload = {
      email: form.email.value,
      password: form.password.value
    };
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      showMessage('Logged in successfully');
      setAuth(data.token, data.user);
      await loadProfile();
      await loadTransactions();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  document.getElementById('refreshProfile').addEventListener('click', async () => {
    await loadProfile();
    await loadTransactions();
  });

  document.getElementById('customerBorrowForm').addEventListener('submit', handleCustomerBorrow);
  document.getElementById('customerReturnForm').addEventListener('submit', handleCustomerReturn);
  document.getElementById('customerPurchaseForm').addEventListener('submit', handleCustomerPurchase);
  document.getElementById('staffBorrowForm').addEventListener('submit', handleStaffBorrow);
  document.getElementById('staffReturnForm').addEventListener('submit', handleStaffReturn);
  document.getElementById('refreshInventory').addEventListener('click', refreshInventory);
  if (els.profileForm) {
    els.profileForm.addEventListener('submit', handleProfileSubmit);
  }
  if (els.profileImageInput) {
    els.profileImageInput.addEventListener('change', handleProfileImageChange);
  }
  if (els.clearProfileImage) {
    els.clearProfileImage.addEventListener('click', handleClearProfileImage);
  }
  if (els.startScannerBtn) {
    els.startScannerBtn.addEventListener('click', () => startScanner());
  }
  if (els.stopScannerBtn) {
    els.stopScannerBtn.addEventListener('click', () => stopScanner());
  }
  if (els.routeNearestBtn) {
    els.routeNearestBtn.addEventListener('click', routeToNearestCafe);
  }
  els.logoutBtn.addEventListener('click', () => {
    setAuth(null, null);
    state.user = null;
    els.inventoryInfo.textContent = '';
    showMessage('Logged out');
  });
}

async function bootstrap() {
  await fetchCafes();
  focusTrackingSetup();
  attachEventListeners();
  if (state.token) {
    try {
      const data = await apiFetch('/auth/me');
      state.user = data.user;
      updateUI();
      await loadProfile();
      await loadTransactions();
    } catch (err) {
      setAuth(null, null);
    }
  } else {
    updateUI();
  }
}

bootstrap();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopScanner();
  }
});
