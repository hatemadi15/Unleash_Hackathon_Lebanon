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
  qrScannerStatus: document.getElementById('qrScannerStatus')
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
    select.innerHTML = '';
    state.cafes.forEach(cafe => {
      const option = document.createElement('option');
      option.value = cafe.id;
      option.textContent = cafe.name;
      select.appendChild(option);
    });
  });
}

async function fetchCafes() {
  try {
    const res = await fetch('/cafes');
    const data = await res.json();
    state.cafes = data.cafes || [];
    populateCafeSelects();
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
