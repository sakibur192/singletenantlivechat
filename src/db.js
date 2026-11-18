// PostgreSQL pool + automatic schema creation (raw SQL, no ORM)
const { Pool } = require('pg');
const crypto = require('crypto');
const config = require('../config');

const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const many = async (text, params) => (await pool.query(text, params)).rows;

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner','admin','supervisor','agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE conversation_status AS ENUM ('open','pending','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE conversation_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sender_type AS ENUM ('customer','agent','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE message_type AS ENUM ('text','image','file','internal_note','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agent_presence AS ENUM ('online','away','busy','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'agent',
  is_active BOOLEAN DEFAULT TRUE,
  display_name VARCHAR(150),
  avatar_url TEXT,
  max_concurrent_chats INTEGER DEFAULT 5,
  presence agent_presence DEFAULT 'offline',
  last_seen_at TIMESTAMPTZ,
  token_version INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id VARCHAR(150) UNIQUE NOT NULL,
  name VARCHAR(150),
  email VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  is_blocked BOOLEAN DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  verified BOOLEAN DEFAULT FALSE,
  ip VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faq_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES faq_categories(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faq_related (
  faq_id UUID NOT NULL REFERENCES faqs(id) ON DELETE CASCADE,
  related_faq_id UUID NOT NULL REFERENCES faqs(id) ON DELETE CASCADE,
  PRIMARY KEY (faq_id, related_faq_id)
);

CREATE TABLE IF NOT EXISTS faq_analytics (
  id BIGSERIAL PRIMARY KEY,
  faq_id UUID REFERENCES faqs(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_id UUID REFERENCES customer_sessions(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status conversation_status DEFAULT 'open',
  priority conversation_priority DEFAULT 'normal',
  subject VARCHAR(255),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_agent INTEGER DEFAULT 0,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  rating INTEGER,
  rating_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id UUID,
  event_type VARCHAR(100) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) UNIQUE NOT NULL,
  color VARCHAR(20) DEFAULT '#64748b'
);

CREATE TABLE IF NOT EXISTS conversation_tags (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type sender_type NOT NULL,
  sender_id UUID,
  message_type message_type DEFAULT 'text',
  content TEXT,
  client_message_id VARCHAR(100),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  uploaded_by_type VARCHAR(20) NOT NULL,
  uploaded_by_id UUID,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,
  actor_name VARCHAR(150),
  action VARCHAR(150) NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_inbox ON conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_conv_customer ON conversations(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_history ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_faq_active ON faqs(category_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_faq_an ON faq_analytics(faq_id, event_type);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON customer_sessions(customer_id);
-- only one active assignment per conversation
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_assignment
  ON conversation_assignments(conversation_id) WHERE ended_at IS NULL;
`;

const DEFAULT_SETTINGS = {
  widget: {
    title: 'Customer Support',
    welcome_message: 'Hi there 👋 How can we help?',
    primary_color: '#16A34A',
    secondary_color: '#0F172A',
    header_text: 'We usually reply in a few minutes',
    logo_url: '',
    launcher_icon: 'chat',
    position: 'right',
    width: 380,
    height: 600,
    language: 'en',
    show_faq: true,
    require_player_id: true,
    player_id_label: 'Player ID',
    offline_message: 'We are currently offline. Leave a message and we will get back to you.',
    show_launcher: true,
    enable_rating: true,
    enable_attachments: true,
  },
  general: {
    company_name: 'My Company',
    auto_assign: true,
    reopen_resolved_within_hours: 24, // customer message within N hours of resolve reopens chat; else new chat
    sound_notifications: true,
  },
  business_hours: {
    enabled: false,
    timezone: 'Asia/Dhaka',
    days: {
      0: { enabled: true, open: '09:00', close: '18:00' },
      1: { enabled: true, open: '09:00', close: '18:00' },
      2: { enabled: true, open: '09:00', close: '18:00' },
      3: { enabled: true, open: '09:00', close: '18:00' },
      4: { enabled: true, open: '09:00', close: '18:00' },
      5: { enabled: false, open: '09:00', close: '18:00' },
      6: { enabled: true, open: '09:00', close: '18:00' },
    },
  },
  security: {
    allowed_domains: [], // empty = widget works on any site (set this in production!)
    identity_secret: '',  // optional HMAC secret for verified Player IDs
  },
};

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, keyHex] = stored.split('$');
    const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch { return false; }
}

async function migrate() {
  await q(SCHEMA);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await q(`INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [key, value]);
  }
  const { c } = await one(`SELECT COUNT(*)::int AS c FROM users`);
  if (c === 0) {
    const o = config.DEFAULT_OWNER;
    await q(`INSERT INTO users(name, email, password_hash, role, display_name) VALUES ($1,$2,$3,'owner',$1)`,
      [o.name, o.email.toLowerCase(), hashPassword(o.password)]);
    console.log(`[setup] Owner account created: ${o.email} / ${o.password}  (change it after login)`);
  }
  const { f } = await one(`SELECT COUNT(*)::int AS f FROM faq_categories`);
  if (f === 0) {
    const cat = await one(`INSERT INTO faq_categories(title, sort_order) VALUES ('Account', 1) RETURNING id`);
    const cat2 = await one(`INSERT INTO faq_categories(title, sort_order) VALUES ('Deposit & Withdraw', 2) RETURNING id`);
    await q(`INSERT INTO faqs(category_id, question, answer, sort_order) VALUES
      ($1, 'How do I find my Player ID?', 'Open your profile page. Your Player ID is shown under your username.', 1),
      ($1, 'How do I reset my password?', 'Tap "Forgot password" on the login page and follow the steps sent to your phone or email.', 2),
      ($2, 'How long does a withdrawal take?', 'Most withdrawals are processed within 15–30 minutes. During peak hours it can take up to 2 hours.', 1),
      ($2, 'My deposit is not showing', 'Please wait 5 minutes and refresh. If it still does not show, start a live chat and share your transaction ID.', 2)`,
      [cat.id, cat2.id]);
  }
}

async function getSetting(key) {
  const r = await one(`SELECT value FROM settings WHERE key=$1`, [key]);
  return { ...(DEFAULT_SETTINGS[key] || {}), ...(r ? r.value : {}) };
}
async function setSetting(key, value) {
  await q(`INSERT INTO settings(key, value, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [key, value]);
}

module.exports = { pool, q, one, many, tx, migrate, getSetting, setSetting, hashPassword, verifyPassword, DEFAULT_SETTINGS };
