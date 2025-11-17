const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDB, saveDB, nextId } = require('./db');
const {
  nowISO,
  sendJSON,
  sendText,
  parseBody,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  parseCupIdFromQr
} = require('./utils');
const { setConfigValue, getNumericConfig, getBooleanConfig } = require('./configService');

const PORT = process.env.PORT || 4000;
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

// QR codes encode a URL or bare UUID. Clients are encouraged to extract the
// `cup_id` before calling the API, but `normalizeCupIdSegment` ensures the
// backend can also accept the raw QR payload (when URL-encoded) by stripping
// everything except the final ID segment.
function normalizeCupIdSegment(segment) {
  if (!segment) return null;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch (err) {
    decoded = segment;
  }
  return parseCupIdFromQr(decoded);
}

function serveStatic(req, res, pathname) {
  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/styles.css': 'styles.css'
  };
  const fileName = fileMap[pathname];
  if (!fileName) return false;
  const filePath = path.join(FRONTEND_DIR, fileName);
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(fileName);
  const contentType = ext === '.js'
    ? 'application/javascript'
    : ext === '.css'
    ? 'text/css'
    : 'text/html';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(content);
  return true;
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];
  const payload = verifyToken(token);
  if (!payload) return null;
  const db = getDB();
  return db.users.find(u => u.id === payload.userId) || null;
}

function requireAuth(res, user) {
  if (!user) {
    sendJSON(res, 401, { error: 'Authentication required' });
    return false;
  }
  return true;
}

function requireRole(res, user, roles) {
  if (!roles.includes(user.role)) {
    sendJSON(res, 403, { error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function findCupById(cupId) {
  const db = getDB();
  return db.cups.find(c => c.id === cupId);
}

function findUserByEmail(email) {
  const db = getDB();
  return db.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
}

function findOpenBorrowByCup(cupId) {
  const db = getDB();
  return db.transactions.find(
    tx => tx.type === 'BORROW' && tx.cup_id === cupId && tx.status === 'OPEN'
  );
}

function createTransaction(tx) {
  const db = getDB();
  const id = nextId('transaction');
  const now = nowISO();
  const record = Object.assign({
    id,
    created_at: now,
    updated_at: now
  }, tx);
  db.transactions.push(record);
  saveDB();
  return record;
}

function updateTransaction(tx, patch) {
  Object.assign(tx, patch, { updated_at: nowISO() });
  saveDB();
}

function handleBorrow({ req, res, cupId: cupIdSegment, currentUser }) {
  const db = getDB();
  const cupId = normalizeCupIdSegment(cupIdSegment);
  if (!cupId) {
    sendJSON(res, 400, { error: 'Invalid cup identifier' });
    return;
  }
  const cup = findCupById(cupId);
  if (!cup) {
    sendJSON(res, 404, { error: 'Cup not found' });
    return;
  }
  parseBody(req)
    .then(body => {
      const cafeId = body.cafe_id;
      if (!cafeId) {
        sendJSON(res, 400, { error: 'cafe_id is required' });
        return;
      }
      const cafe = db.cafes.find(c => c.id === cafeId);
      if (!cafe) {
        sendJSON(res, 404, { error: 'Cafe not found' });
        return;
      }
      if (cup.status !== 'AVAILABLE') {
        sendJSON(res, 409, { error: 'Cup is not available' });
        return;
      }
      if (cup.current_cafe_id && cup.current_cafe_id !== cafeId) {
        sendJSON(res, 409, { error: 'Cup is assigned to a different cafe' });
        return;
      }
      if (!requireAuth(res, currentUser)) return;
      let borrower = currentUser;
      if (currentUser.role === 'CAFE_STAFF' || currentUser.role === 'ADMIN') {
        if (body.user_id) {
          borrower = db.users.find(u => u.id === body.user_id);
        } else if (body.customer_email) {
          borrower = findUserByEmail(body.customer_email);
        }
        if (!borrower) {
          sendJSON(res, 404, { error: 'Target customer not found' });
          return;
        }
      }
      if (borrower.role !== 'CUSTOMER') {
        sendJSON(res, 400, { error: 'Target user must be a customer' });
        return;
      }
      if (borrower.is_blocked) {
        sendJSON(res, 403, { error: 'User is blocked' });
        return;
      }
      const maxActive = getNumericConfig('max_active_borrows', 1);
      if (borrower.active_borrow_count >= maxActive) {
        sendJSON(res, 409, { error: 'User reached borrow limit' });
        return;
      }
      const depositAmount = getNumericConfig('deposit_amount', 3);
      const maxDuration = getNumericConfig('max_borrow_duration_hours', 72);
      const dueAt = new Date(Date.now() + maxDuration * 60 * 60 * 1000).toISOString();
      const borrowTx = createTransaction({
        type: 'BORROW',
        user_id: borrower.id,
        cup_id: cup.id,
        from_cafe_id: cafeId,
        to_cafe_id: null,
        related_transaction_id: null,
        status: 'OPEN',
        deposit_amount: depositAmount,
        due_at: dueAt
      });
      cup.status = 'BORROWED';
      cup.current_cafe_id = null;
      cup.current_holder_user_id = borrower.id;
      cup.updated_at = nowISO();
      borrower.active_borrow_count = (borrower.active_borrow_count || 0) + 1;
      borrower.deposit_balance = (borrower.deposit_balance || 0) - depositAmount;
      borrower.updated_at = nowISO();
      saveDB();
      sendJSON(res, 200, {
        message: 'Cup borrowed',
        cup,
        borrow: borrowTx,
        user: sanitizeUser(borrower)
      });
    })
    .catch(() => {
      sendJSON(res, 400, { error: 'Invalid JSON body' });
    });
}

function handleReturn({ req, res, cupId: cupIdSegment, currentUser }) {
  const db = getDB();
  const cupId = normalizeCupIdSegment(cupIdSegment);
  if (!cupId) {
    sendJSON(res, 400, { error: 'Invalid cup identifier' });
    return;
  }
  const cup = findCupById(cupId);
  if (!cup) {
    sendJSON(res, 404, { error: 'Cup not found' });
    return;
  }
  if (cup.status !== 'BORROWED') {
    sendJSON(res, 409, { error: 'Cup is not borrowed' });
    return;
  }
  parseBody(req)
    .then(body => {
      const cafeId = body.cafe_id;
      if (!cafeId) {
        sendJSON(res, 400, { error: 'cafe_id is required' });
        return;
      }
      const cafe = db.cafes.find(c => c.id === cafeId);
      if (!cafe) {
        sendJSON(res, 404, { error: 'Cafe not found' });
        return;
      }
      if (!requireAuth(res, currentUser)) return;
      const borrowTx = findOpenBorrowByCup(cup.id);
      if (!borrowTx) {
        sendJSON(res, 404, { error: 'No open borrow found for this cup' });
        return;
      }
      const borrower = db.users.find(u => u.id === borrowTx.user_id);
      if (!borrower) {
        sendJSON(res, 404, { error: 'Borrowing user not found' });
        return;
      }
      const mustReturnSameCafe = getBooleanConfig('must_return_same_cafe', false);
      if (mustReturnSameCafe && borrowTx.from_cafe_id !== cafeId) {
        sendJSON(res, 409, { error: 'Cup must be returned to the originating cafe' });
        return;
      }
      const rewardPointsPerReturn = getNumericConfig('reward_points_per_return', 10);
      const depositAmount = borrowTx.deposit_amount || getNumericConfig('deposit_amount', 3);
      const now = new Date();
      const dueDate = borrowTx.due_at ? new Date(borrowTx.due_at) : null;
      const onTime = !dueDate || now <= dueDate;
      // Edge case 1 (forgetting cup) resolves here: once the borrower scans the
      // QR at any partner café, we return the deposit and reward them as long as
      // `/admin/process-overdue-borrows` has not already marked the cup LOST.
      // Simplification: even if late, we still refund deposit and rewards.
      borrower.deposit_balance = (borrower.deposit_balance || 0) + depositAmount;
      borrower.reward_points = (borrower.reward_points || 0) + rewardPointsPerReturn;
      borrower.active_borrow_count = Math.max((borrower.active_borrow_count || 1) - 1, 0);
      borrower.updated_at = nowISO();
      updateTransaction(borrowTx, { status: onTime ? 'CLOSED' : 'LATE', updated_at: nowISO() });
      const returnTx = createTransaction({
        type: 'RETURN',
        user_id: borrower.id,
        cup_id: cup.id,
        from_cafe_id: borrowTx.from_cafe_id,
        to_cafe_id: cafeId,
        related_transaction_id: borrowTx.id,
        status: 'CLOSED',
        deposit_amount: depositAmount,
        due_at: null
      });
      cup.status = 'AVAILABLE';
      cup.current_cafe_id = cafeId;
      cup.current_holder_user_id = null;
      cup.updated_at = nowISO();
      saveDB();
      sendJSON(res, 200, {
        message: 'Cup returned',
        cup,
        return_transaction: returnTx,
        user: sanitizeUser(borrower)
      });
    })
    .catch(() => {
      sendJSON(res, 400, { error: 'Invalid JSON body' });
    });
}

function handlePurchase({ req, res, cupId: cupIdSegment, currentUser }) {
  if (!requireAuth(res, currentUser)) return;
  const db = getDB();
  const cupId = normalizeCupIdSegment(cupIdSegment);
  if (!cupId) {
    sendJSON(res, 400, { error: 'Invalid cup identifier' });
    return;
  }
  const cup = findCupById(cupId);
  if (!cup) {
    sendJSON(res, 404, { error: 'Cup not found' });
    return;
  }
  if (cup.status !== 'BORROWED') {
    sendJSON(res, 409, { error: 'Cup is not currently borrowed' });
    return;
  }
  if (cup.current_holder_user_id !== currentUser.id) {
    sendJSON(res, 403, { error: 'Only the holder can purchase the cup' });
    return;
  }
  const borrowTx = findOpenBorrowByCup(cup.id);
  if (!borrowTx || borrowTx.user_id !== currentUser.id) {
    sendJSON(res, 404, { error: 'Borrow transaction not found' });
    return;
  }
  updateTransaction(borrowTx, { status: 'CLOSED' });
  // Edge case 3 – “keep cup”: we convert the open borrow into a purchase and
  // keep the deposit as the sale price so the cup leaves circulation.
  cup.status = 'SOLD';
  cup.ownership_type = 'SOLD_TO_USER';
  cup.current_cafe_id = null;
  cup.updated_at = nowISO();
  currentUser.active_borrow_count = Math.max((currentUser.active_borrow_count || 1) - 1, 0);
  currentUser.updated_at = nowISO();
  createTransaction({
    type: 'PURCHASE',
    user_id: currentUser.id,
    cup_id: cup.id,
    from_cafe_id: borrowTx.from_cafe_id,
    to_cafe_id: null,
    related_transaction_id: borrowTx.id,
    status: 'CLOSED',
    deposit_amount: borrowTx.deposit_amount,
    due_at: null
  });
  saveDB();
  sendJSON(res, 200, {
    message: 'Cup purchased and removed from network',
    cup,
    user: sanitizeUser(currentUser)
  });
}

function sanitizeUser(user) {
  if (!user) return null;
  const clone = Object.assign({}, user);
  delete clone.password_hash;
  return clone;
}

function processOverdueBorrows() {
  const db = getDB();
  const now = new Date();
  const processed = [];
  const replacementCost = getNumericConfig('replacement_cost', getNumericConfig('deposit_amount', 3));
  db.transactions.forEach(tx => {
    if (tx.type === 'BORROW' && tx.status === 'OPEN' && tx.due_at) {
      const dueDate = new Date(tx.due_at);
      if (now > dueDate) {
        // Edge case 2 – overdue cups: a manual admin action can mark them as
        // LOST which frees the borrow slot and keeps the deposit as a
        // replacement fee until the cup resurfaces.
        tx.status = 'LATE';
        tx.updated_at = nowISO();
        const cup = findCupById(tx.cup_id);
        if (cup) {
          cup.status = 'LOST';
          cup.current_holder_user_id = null;
          cup.current_cafe_id = null;
          cup.updated_at = nowISO();
        }
        const user = db.users.find(u => u.id === tx.user_id);
        if (user) {
          user.active_borrow_count = Math.max((user.active_borrow_count || 1) - 1, 0);
          // Deposit remains withheld to simulate replacement cost.
          user.updated_at = nowISO();
        }
        createTransaction({
          type: 'MARK_LOST',
          user_id: tx.user_id,
          cup_id: tx.cup_id,
          from_cafe_id: tx.from_cafe_id,
          to_cafe_id: null,
          related_transaction_id: tx.id,
          status: 'CLOSED',
          deposit_amount: replacementCost,
          due_at: null
        });
        processed.push(tx.id);
      }
    }
  });
  saveDB();
  return processed;
}

function listTransactionsForUser(userId, limit = 20) {
  const db = getDB();
  return db.transactions
    .filter(tx => tx.user_id === userId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    sendText(res, 200, 'ok');
    return;
  }

  if (serveStatic(req, res, pathname)) {
    return;
  }

  const currentUser = getAuthUser(req);
  const db = getDB();

  try {
    if (req.method === 'POST' && pathname === '/auth/register') {
      parseBody(req)
        .then(body => {
          const { email, password, name } = body;
          if (!email || !password) {
            sendJSON(res, 400, { error: 'Email and password are required' });
            return;
          }
          if (findUserByEmail(email)) {
            sendJSON(res, 409, { error: 'User already exists' });
            return;
          }
          const newUser = {
            id: crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}`,
            name: name || '',
            email: email.toLowerCase(),
            password_hash: hashPassword(password),
            role: 'CUSTOMER',
            deposit_balance: 0,
            reward_points: 0,
            active_borrow_count: 0,
            is_blocked: false,
            created_at: nowISO(),
            updated_at: nowISO()
          };
          db.users.push(newUser);
          saveDB();
          const token = createToken({ userId: newUser.id });
          sendJSON(res, 201, { token, user: sanitizeUser(newUser) });
        })
        .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (req.method === 'POST' && pathname === '/auth/login') {
      parseBody(req)
        .then(body => {
          const { email, password } = body;
          if (!email || !password) {
            sendJSON(res, 400, { error: 'Email and password are required' });
            return;
          }
          const user = findUserByEmail(email);
          if (!user || !verifyPassword(password, user.password_hash)) {
            sendJSON(res, 401, { error: 'Invalid credentials' });
            return;
          }
          const token = createToken({ userId: user.id });
          sendJSON(res, 200, { token, user: sanitizeUser(user) });
        })
        .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (req.method === 'GET' && pathname === '/auth/me') {
      if (!requireAuth(res, currentUser)) return;
      sendJSON(res, 200, { user: sanitizeUser(currentUser) });
      return;
    }

    if (req.method === 'GET' && pathname === '/user/profile') {
      if (!requireAuth(res, currentUser)) return;
      sendJSON(res, 200, { user: sanitizeUser(currentUser) });
      return;
    }

    if (req.method === 'GET' && pathname === '/user/transactions') {
      if (!requireAuth(res, currentUser)) return;
      const limit = Number(url.searchParams.get('limit')) || 20;
      const transactions = listTransactionsForUser(currentUser.id, limit);
      sendJSON(res, 200, { transactions });
      return;
    }

    if (pathname === '/admin/config') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      if (req.method === 'GET') {
        sendJSON(res, 200, { config: db.config });
        return;
      }
      if (req.method === 'PUT') {
        parseBody(req)
          .then(body => {
            Object.keys(body || {}).forEach(key => {
              setConfigValue(key, String(body[key]));
            });
            sendJSON(res, 200, { config: db.config });
          })
          .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
        return;
      }
    }

    if (pathname === '/admin/cafes' && req.method === 'POST') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      parseBody(req)
        .then(body => {
          const { name, address, location_lat, location_lng, contact_email } = body;
          if (!name) {
            sendJSON(res, 400, { error: 'Name is required' });
            return;
          }
          const cafe = {
            id: `cafe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            address: address || '',
            location_lat: location_lat || null,
            location_lng: location_lng || null,
            contact_email: contact_email || '',
            created_at: nowISO(),
            updated_at: nowISO()
          };
          db.cafes.push(cafe);
          saveDB();
          sendJSON(res, 201, { cafe });
        })
        .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (pathname === '/admin/cafes' && req.method === 'GET') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      sendJSON(res, 200, { cafes: db.cafes });
      return;
    }

    if (pathname === '/admin/cups' && req.method === 'POST') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      parseBody(req)
        .then(body => {
          const { initial_cafe_id } = body;
          const cupId = crypto.randomUUID ? crypto.randomUUID() : `cup-${Date.now()}`;
          const now = nowISO();
          const cup = {
            id: cupId,
            status: 'AVAILABLE',
            ownership_type: 'NETWORK',
            current_cafe_id: initial_cafe_id || null,
            current_holder_user_id: null,
            created_at: now,
            updated_at: now
          };
          db.cups.push(cup);
          saveDB();
          sendJSON(res, 201, { cup });
        })
        .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (pathname === '/admin/cups/bulk-create' && req.method === 'POST') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      parseBody(req)
        .then(body => {
          const count = Number(body.count) || 1;
          const initialCafe = body.initial_cafe_id || null;
          const created = [];
          for (let i = 0; i < count; i += 1) {
            const cupId = crypto.randomUUID ? crypto.randomUUID() : `cup-${Date.now()}-${i}`;
            const now = nowISO();
            const cup = {
              id: cupId,
              status: 'AVAILABLE',
              ownership_type: 'NETWORK',
              current_cafe_id: initialCafe,
              current_holder_user_id: null,
              created_at: now,
              updated_at: now
            };
            db.cups.push(cup);
            created.push(cupId);
          }
          saveDB();
          sendJSON(res, 201, { cup_ids: created });
        })
        .catch(() => sendJSON(res, 400, { error: 'Invalid JSON body' }));
      return;
    }

    if (pathname === '/admin/process-overdue-borrows' && req.method === 'POST') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      const processed = processOverdueBorrows();
      sendJSON(res, 200, { processed_count: processed.length, borrow_transaction_ids: processed });
      return;
    }

    if (pathname === '/cafes' && req.method === 'GET') {
      sendJSON(res, 200, { cafes: db.cafes });
      return;
    }

    if (pathname.startsWith('/cafes/') && pathname.endsWith('/inventory') && req.method === 'GET') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['CAFE_STAFF', 'ADMIN'])) return;
      const cafeId = pathname.split('/')[2];
      const cafe = db.cafes.find(c => c.id === cafeId);
      if (!cafe) {
        sendJSON(res, 404, { error: 'Cafe not found' });
        return;
      }
      const cups = db.cups.filter(c => c.status === 'AVAILABLE' && c.current_cafe_id === cafeId);
      sendJSON(res, 200, { cafe, available_count: cups.length, cup_ids: cups.map(c => c.id) });
      return;
    }

    if (pathname.startsWith('/cups/') && req.method === 'GET') {
      if (!requireAuth(res, currentUser)) return;
      const rawCupId = pathname.split('/')[2];
      const cupId = normalizeCupIdSegment(rawCupId);
      if (!cupId) {
        sendJSON(res, 400, { error: 'Invalid cup identifier' });
        return;
      }
      const cup = findCupById(cupId);
      if (!cup) {
        sendJSON(res, 404, { error: 'Cup not found' });
        return;
      }
      const lastTx = db.transactions
        .filter(tx => tx.cup_id === cupId)
        .sort((a, b) => b.id - a.id)[0] || null;
      sendJSON(res, 200, { cup, last_transaction: lastTx });
      return;
    }

    if (pathname.startsWith('/cups/') && pathname.endsWith('/borrow') && req.method === 'POST') {
      const cupId = pathname.split('/')[2];
      handleBorrow({ req, res, cupId, currentUser });
      return;
    }

    if (pathname.startsWith('/cups/') && pathname.endsWith('/return') && req.method === 'POST') {
      const cupId = pathname.split('/')[2];
      handleReturn({ req, res, cupId, currentUser });
      return;
    }

    if (pathname.startsWith('/cups/') && pathname.endsWith('/purchase') && req.method === 'POST') {
      const cupId = pathname.split('/')[2];
      handlePurchase({ req, res, cupId, currentUser });
      return;
    }

    if (pathname.startsWith('/cups/') && pathname.endsWith('/mark-damaged') && req.method === 'POST') {
      if (!requireAuth(res, currentUser)) return;
      if (!requireRole(res, currentUser, ['ADMIN'])) return;
      const rawCupId = pathname.split('/')[2];
      const cupId = normalizeCupIdSegment(rawCupId);
      if (!cupId) {
        sendJSON(res, 400, { error: 'Invalid cup identifier' });
        return;
      }
      const cup = findCupById(cupId);
      if (!cup) {
        sendJSON(res, 404, { error: 'Cup not found' });
        return;
      }
      cup.status = 'DAMAGED';
      cup.current_cafe_id = null;
      cup.current_holder_user_id = null;
      cup.updated_at = nowISO();
      saveDB();
      sendJSON(res, 200, { cup });
      return;
    }

    if (pathname.startsWith('/cups/')) {
      sendJSON(res, 404, { error: 'Unknown cups endpoint' });
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Server error', err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`ReCup Lebanon API running on http://localhost:${PORT}`);
});
