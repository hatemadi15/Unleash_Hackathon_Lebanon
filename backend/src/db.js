const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'db.json');

const defaultState = {
  users: [],
  cafes: [],
  cups: [],
  transactions: [],
  config: [],
  sequences: {
    transaction: 1
  }
};

function ensureDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadDB() {
  ensureDir();
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultState, null, 2));
    return JSON.parse(JSON.stringify(defaultState));
  }
  const raw = fs.readFileSync(dbPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return Object.assign({}, defaultState, parsed);
  } catch (err) {
    console.error('Failed to parse DB file, reinitializing', err);
    fs.writeFileSync(dbPath, JSON.stringify(defaultState, null, 2));
    return JSON.parse(JSON.stringify(defaultState));
  }
}

let db = loadDB();

function saveDB() {
  ensureDir();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function nextId(key) {
  const current = db.sequences[key] || 1;
  db.sequences[key] = current + 1;
  return current;
}

function resetDB() {
  db = JSON.parse(JSON.stringify(defaultState));
  saveDB();
}

module.exports = {
  getDB: () => db,
  saveDB,
  nextId,
  resetDB,
  dbPath
};
