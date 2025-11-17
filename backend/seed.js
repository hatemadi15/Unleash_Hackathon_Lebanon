const crypto = require('crypto');
const { resetDB, getDB, saveDB } = require('./src/db');
const { hashPassword } = require('./src/utils');
const { setConfigValue } = require('./src/configService');

function seed() {
  resetDB();
  const db = getDB();

  const now = new Date().toISOString();

  const admin = {
    id: crypto.randomUUID(),
    name: 'System Admin',
    email: 'admin@recup.local',
    password_hash: hashPassword('admin123'),
    role: 'ADMIN',
    deposit_balance: 0,
    reward_points: 0,
    active_borrow_count: 0,
    is_blocked: false,
    created_at: now,
    updated_at: now
  };

  const staff = {
    id: crypto.randomUUID(),
    name: 'Gemmayzeh Barista',
    email: 'cafe@recup.local',
    password_hash: hashPassword('cafe123'),
    role: 'CAFE_STAFF',
    deposit_balance: 0,
    reward_points: 0,
    active_borrow_count: 0,
    is_blocked: false,
    created_at: now,
    updated_at: now
  };

  const customer = {
    id: crypto.randomUUID(),
    name: 'First Customer',
    email: 'customer@recup.local',
    password_hash: hashPassword('customer123'),
    role: 'CUSTOMER',
    deposit_balance: 0,
    reward_points: 0,
    active_borrow_count: 0,
    is_blocked: false,
    created_at: now,
    updated_at: now
  };

  db.users.push(admin, staff, customer);

  const cafe1 = {
    id: 'cafe-1',
    name: 'Beirut Downtown Café',
    address: 'Downtown Beirut',
    location_lat: 33.895,
    location_lng: 35.478,
    contact_email: 'downtown@recup.local',
    created_at: now,
    updated_at: now
  };

  const cafe2 = {
    id: 'cafe-2',
    name: 'Hamra Coffee Corner',
    address: 'Hamra Street',
    location_lat: 33.897,
    location_lng: 35.480,
    contact_email: 'hamra@recup.local',
    created_at: now,
    updated_at: now
  };

  db.cafes.push(cafe1, cafe2);

  for (let i = 0; i < 6; i += 1) {
    const cup = {
      id: crypto.randomUUID(),
      status: 'AVAILABLE',
      ownership_type: 'NETWORK',
      current_cafe_id: i % 2 === 0 ? cafe1.id : cafe2.id,
      current_holder_user_id: null,
      created_at: now,
      updated_at: now
    };
    db.cups.push(cup);
  }

  setConfigValue('deposit_amount', '3');
  setConfigValue('max_borrow_duration_hours', '72');
  setConfigValue('max_active_borrows', '1');
  setConfigValue('reward_points_per_return', '10');
  setConfigValue('replacement_cost', '3');
  setConfigValue('must_return_same_cafe', 'false');

  saveDB();
  console.log('Database seeded.');
}

seed();
