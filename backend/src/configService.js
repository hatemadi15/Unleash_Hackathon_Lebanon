const { getDB, saveDB } = require('./db');

function getConfigValue(key, fallback = null) {
  const db = getDB();
  const row = db.config.find(item => item.key === key);
  if (!row) return fallback;
  return row.value;
}

function setConfigValue(key, value) {
  const db = getDB();
  const existing = db.config.find(item => item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    db.config.push({ key, value });
  }
  saveDB();
}

function getNumericConfig(key, fallback) {
  const value = getConfigValue(key, null);
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return num;
}

function getBooleanConfig(key, fallback = false) {
  const value = getConfigValue(key, null);
  if (value === null || value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

module.exports = {
  getConfigValue,
  setConfigValue,
  getNumericConfig,
  getBooleanConfig
};
