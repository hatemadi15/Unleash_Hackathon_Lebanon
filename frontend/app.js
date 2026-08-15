const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="32" fill="%23e0f2f1"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="60" font-family="Arial" fill="%230f766e">☕</text></svg>';

const state = {
  token: localStorage.getItem('recup_token') || null,
  user: null,
  cafes: []
};

let pendingPhotoClear = false;
let qrScannerInstance = null;
let scannerRunning = false;
let activeQrInput = null;
let lastScan = '';
let leafletMap = null;
let markerLayer = null;
let markerRefs = new Map();
let activeMarkerId = null;

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
  mapEmptyState: document.getElementById('mapEmptyState')
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

function escapeHtml(value) {
  const safeValue = value === undefined || value === null ? '' : String(value);
  return safeValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureLeafletMap() {
  if (!els.cafeMap) return null;
  if (leafletMap) return leafletMap;
  if (typeof L === 'undefined') {
    console.warn('Leaflet has not loaded yet');
    return null;
  }
  leafletMap = L.map(els.cafeMap, {
    zoomControl: true,
    scrollWheelZoom: false,
    attributionControl: true
  });
  const defaultView = [33.8938, 35.5018];
  leafletMap.setView(defaultView, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMap);
  markerLayer = L.layerGroup().addTo(leafletMap);
  return leafletMap;
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
  const map = ensureLeafletMap();
  const cafesWithCoords = state.cafes.filter(hasCafeCoordinates);
  if (els.mapEmptyState) {
    els.mapEmptyState.classList.toggle('hidden', Boolean(cafesWithCoords.length));
  }
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markerRefs = new Map();
  activeMarkerId = null;
  if (!cafesWithCoords.length) {
    map.setView([33.8938, 35.5018], 11);
    return;
  }
  const bounds = L.latLngBounds([]);
  cafesWithCoords.forEach(cafe => {
    const coords = [cafe.location_lat, cafe.location_lng];
    bounds.extend(coords);
    const marker = L.marker(coords, { title: cafe.name || 'ReCup café' });
    marker.bindPopup(buildCafePopupHtml(cafe));
    marker.on('click', () => {
      activeMarkerId = cafe.id;
    });
    marker.on('popupclose', () => {
      if (activeMarkerId === cafe.id) {
        activeMarkerId = null;
      }
    });
    marker.addTo(markerLayer);
    markerRefs.set(cafe.id, marker);
  });
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.25));
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
  if (!leafletMap || !markerRefs.size) return;
  if (!cafeId) {
    if (activeMarkerId && markerRefs.get(activeMarkerId)) {
      markerRefs.get(activeMarkerId).closePopup();
    }
    activeMarkerId = null;
    return;
  }
  const marker = markerRefs.get(cafeId);
  if (marker) {
    marker.openPopup();
    const point = marker.getLatLng();
    if (point) {
      leafletMap.panTo(point, { animate: true });
    }
    activeMarkerId = cafeId;
  }
}

async function fetchCafes() {
  let cafes = [];
  try {
    const res = await fetch('/cafes');
    const data = await res.json();
    cafes = data.cafes || [];
  } catch (err) {
    console.error('Failed to load cafes', err);
    showMessage('Unable to load cafés right now. Showing default map view.', 'error');
  } finally {
    state.cafes = cafes;
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
