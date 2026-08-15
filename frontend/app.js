const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="32" fill="%23e0f2f1"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="60" font-family="Arial" fill="%230f766e">☕</text></svg>';

const state = {
  token: localStorage.getItem('recup_token') || null,
  user: null,
  cafes: []
};

const MAP_VIEWBOX = { width: 800, height: 500 };
const MAP_DEFAULT_BOUNDS = {
  lat: { min: 33.0, max: 34.6 },
  lng: { min: 35.0, max: 36.8 }
};

let pendingPhotoClear = false;
let qrScannerInstance = null;
let scannerRunning = false;
let activeQrInput = null;
let lastScan = '';
let mapRenderer = null;

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
  nearestDirectionsLink: document.getElementById('nearestDirectionsLink')
};

const qrInputs = Array.from(document.querySelectorAll('[data-qr-input]'));
const defaultScanInput = document.querySelector('[data-scan-default="true"]');
if (els.profileAvatar) {
  els.profileAvatar.src = DEFAULT_AVATAR;
}

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

function ensureMapRenderer() {
  if (!els.cafeMap) return null;
  if (!mapRenderer) {
    mapRenderer = createMiniMapRenderer(els.cafeMap);
  }
  return mapRenderer;
}

function updateCafeMap() {
  const renderer = ensureMapRenderer();
  if (!renderer) return;
  renderer.updateMarkers(state.cafes.filter(hasCafeCoordinates));
}

function createMiniMapRenderer(container) {
  const mapRoot = container;
  mapRoot.innerHTML = '';
  mapRoot.classList.add('mini-map');

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`);
  svg.classList.add('mini-map__canvas');

  const defs = document.createElementNS(svgNS, 'defs');
  const gradient = document.createElementNS(svgNS, 'linearGradient');
  gradient.setAttribute('id', 'miniMapGradient');
  gradient.setAttribute('x1', '0%');
  gradient.setAttribute('y1', '0%');
  gradient.setAttribute('x2', '0%');
  gradient.setAttribute('y2', '100%');

  const stop1 = document.createElementNS(svgNS, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', '#c7f9cc');
  stop1.setAttribute('stop-opacity', '0.9');
  gradient.appendChild(stop1);

  const stop2 = document.createElementNS(svgNS, 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', '#80ed99');
  stop2.setAttribute('stop-opacity', '0.9');
  gradient.appendChild(stop2);

  defs.appendChild(gradient);
  svg.appendChild(defs);

  const background = document.createElementNS(svgNS, 'rect');
  background.setAttribute('width', MAP_VIEWBOX.width);
  background.setAttribute('height', MAP_VIEWBOX.height);
  background.setAttribute('fill', 'url(#miniMapGradient)');
  svg.appendChild(background);

  const gridGroup = document.createElementNS(svgNS, 'g');
  gridGroup.setAttribute('stroke', 'rgba(15, 23, 42, 0.08)');
  gridGroup.setAttribute('stroke-width', '1');
  const columns = 6;
  const rows = 4;
  for (let i = 1; i < columns; i += 1) {
    const line = document.createElementNS(svgNS, 'line');
    const x = (MAP_VIEWBOX.width / columns) * i;
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', MAP_VIEWBOX.height);
    gridGroup.appendChild(line);
  }
  for (let j = 1; j < rows; j += 1) {
    const line = document.createElementNS(svgNS, 'line');
    const y = (MAP_VIEWBOX.height / rows) * j;
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', MAP_VIEWBOX.width);
    line.setAttribute('y2', y);
    gridGroup.appendChild(line);
  }
  svg.appendChild(gridGroup);

  const markerLayer = document.createElement('div');
  markerLayer.className = 'mini-map__markers';

  const emptyState = document.createElement('p');
  emptyState.className = 'mini-map__empty';
  emptyState.textContent = 'Add café coordinates to populate this map.';

  mapRoot.appendChild(svg);
  mapRoot.appendChild(markerLayer);
  mapRoot.appendChild(emptyState);

  let bounds = MAP_DEFAULT_BOUNDS;
  let markerMap = new Map();

  function latLngToPoint(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const latSpan = bounds.lat.max - bounds.lat.min || 1;
    const lngSpan = bounds.lng.max - bounds.lng.min || 1;
    const clampedLat = Math.min(Math.max(lat, bounds.lat.min), bounds.lat.max);
    const clampedLng = Math.min(Math.max(lng, bounds.lng.min), bounds.lng.max);
    const xRatio = (clampedLng - bounds.lng.min) / lngSpan;
    const yRatio = (clampedLat - bounds.lat.min) / latSpan;
    return {
      x: xRatio * MAP_VIEWBOX.width,
      y: MAP_VIEWBOX.height - yRatio * MAP_VIEWBOX.height
    };
  }

  function updateBounds(cafes) {
    if (!cafes.length) {
      bounds = MAP_DEFAULT_BOUNDS;
      return;
    }
    const latValues = cafes.map(c => c.location_lat);
    const lngValues = cafes.map(c => c.location_lng);
    const paddingLat = 0.05;
    const paddingLng = 0.05;
    bounds = {
      lat: {
        min: Math.min(...latValues) - paddingLat,
        max: Math.max(...latValues) + paddingLat
      },
      lng: {
        min: Math.min(...lngValues) - paddingLng,
        max: Math.max(...lngValues) + paddingLng
      }
    };
  }

  function renderMarkers(cafes) {
    markerLayer.innerHTML = '';
    markerMap = new Map();
    cafes.forEach(cafe => {
      const point = latLngToPoint(cafe.location_lat, cafe.location_lng);
      if (!point) return;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'mini-map__marker';
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      marker.title = cafe.name || 'ReCup café';
      marker.dataset.cafeId = cafe.id;
      marker.addEventListener('click', () => openDirectionsToCafe(cafe));
      markerLayer.appendChild(marker);
      markerMap.set(cafe.id, marker);
    });
    emptyState.style.display = cafes.length ? 'none' : 'block';
  }

  return {
    updateMarkers(cafes) {
      updateBounds(cafes);
      renderMarkers(cafes);
    },
    highlight(cafeId) {
      markerMap.forEach((marker, id) => {
        marker.classList.toggle('is-active', Boolean(cafeId && id === cafeId));
      });
    }
  };
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
  if (mapRenderer) {
    mapRenderer.highlight(cafeId);
  }
}

async function fetchCafes() {
  try {
    const res = await fetch('/cafes');
    const data = await res.json();
    state.cafes = data.cafes || [];
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
  } catch (err) {
    console.error('Failed to load cafes', err);
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
    els.customerInfo.textContent = '';
    els.staffInfo.textContent = '';
    els.transactionList.innerHTML = '';
    pendingPhotoClear = false;
    if (els.profileAvatar) {
      els.profileAvatar.src = DEFAULT_AVATAR;
    }
  }
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
  return `Balance: $${(user.deposit_balance || 0).toFixed(2)} • Points: ${user.reward_points || 0} • Active borrows: ${user.active_borrow_count || 0}`;
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
    els.customerInfo.textContent = formatProfile(state.user);
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
