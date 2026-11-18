// ============================================================
//  Live Support Desk — single Node.js app
//  REST API + Socket.IO + Admin panel + Embeddable widget
// ============================================================
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./src/db');
const { q, one, many, tx, getSetting, setSetting } = db;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: (o, cb) => cb(null, true) }, maxHttpBufferSize: 1e6 });

if (config.TRUST_PROXY) app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const ROLE_RANK = { agent: 1, supervisor: 2, admin: 3, owner: 4 };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', config.APP_SECRET).update(s).digest('base64url');
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const fail = (status, msg, code) => { throw new HttpError(status, msg, code); };

function str(v, max = 1000, required = false, name = 'field') {
  if (v === undefined || v === null || v === '') { if (required) fail(400, `${name} is required`); return null; }
  if (typeof v !== 'string' && typeof v !== 'number') fail(400, `${name} must be text`);
  const s = String(v).trim();
  if (required && !s) fail(400, `${name} is required`);
  if (s.length > max) fail(400, `${name} is too long (max ${max})`);
  return s;
}
const oneOf = (v, list, name) => { if (!list.includes(v)) fail(400, `${name} must be one of: ${list.join(', ')}`); return v; };
const int = (v, def, min, max) => { const n = parseInt(v, 10); if (isNaN(n)) return def; return Math.max(min, Math.min(max, n)); };

function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return body + '.' + hmac(body);
}
function readToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// simple in-memory rate limiter
const buckets = new Map();
function rateLimit(key, limit, windowMs = 60000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return b.count <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

async function audit(actor, action, metadata = {}, ip = null) {
  try {
    await q(`INSERT INTO audit_logs(actor_id, actor_name, action, metadata, ip) VALUES ($1,$2,$3,$4,$5)`,
      [actor ? actor.id : null, actor ? actor.name : 'system', action, metadata, ip]);
  } catch (e) { console.error('audit failed', e.message); }
}

function originAllowed(origin, security) {
  if (!origin) return true; // non-browser clients (Postman, server-to-server)
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  try { if (host === new URL(config.PUBLIC_URL).hostname.toLowerCase()) return true; } catch {}
  const list = (security.allowed_domains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return list.some((d) => d.startsWith('*.') ? (host === d.slice(2) || host.endsWith(d.slice(1))) : host === d);
}

function isWithinBusinessHours(bh) {
  if (!bh || !bh.enabled) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: bh.timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find((p) => p.type === 'weekday').value];
    let hh = parts.find((p) => p.type === 'hour').value; if (hh === '24') hh = '00';
    const now = `${hh}:${parts.find((p) => p.type === 'minute').value}`;
    const d = bh.days && bh.days[wd];
    if (!d || !d.enabled) return false;
    if (d.close <= d.open) return now >= d.open || now < d.close; // overnight
    return now >= d.open && now < d.close;
  } catch { return true; }
}

async function onlineAgentCount() {
  const r = await one(`SELECT COUNT(*)::int AS c FROM users WHERE is_active AND presence='online'`);
  return r.c;
}
async function supportIsOnline() {
  const bh = await getSetting('business_hours');
  return isWithinBusinessHours(bh) && (await onlineAgentCount()) > 0;
}

function fileUrl(att) {
  const exp = Date.now() + config.FILE_URL_MINUTES * 60000;
  const sig = hmac(`${att.id}.${exp}`);
  return `/files/${att.id}?e=${exp}&s=${sig}`;
}
const serializeAttachment = (a) => {
  const url = fileUrl(a);
  return {
    id: a.id, file_name: a.file_name, mime_type: a.mime_type, file_size: Number(a.file_size),
    duration_ms: a.duration_ms || null, url, thumb_url: a.thumb_key ? url + '&t=1' : null,
  };
};
function previewFor(type, content, mime) {
  if (content) return content.slice(0, 140);
  if (type === 'audio' || (mime && mime.startsWith('audio/'))) return '🎤 Voice message';
  if (type === 'image' || (mime && mime.startsWith('image/'))) return '📷 Photo';
  if (mime) return '📎 File';
  return '';
}
function serializeMessage(m, atts = [], includeInternal = true) {
  let replyTo = null;
  if (m.r_id && (includeInternal || m.r_type !== 'internal_note')) {
    replyTo = {
      id: m.r_id, sender_type: m.r_sender_type, sender_name: m.r_sender_name || null, message_type: m.r_type,
      content: previewFor(m.r_type, m.r_content, m.r_mime),
    };
  }
  return {
    id: m.id, conversation_id: m.conversation_id, sender_type: m.sender_type, sender_id: m.sender_id,
    sender_name: m.sender_name || null, message_type: m.message_type, content: m.content,
    client_message_id: m.client_message_id, delivered_at: m.delivered_at, read_at: m.read_at, created_at: m.created_at,
    reply_to: replyTo,
    attachments: atts.map(serializeAttachment),
  };
}
async function loadMessages(where, params, includeInternal) {
  const rows = await many(`
    SELECT m.*, COALESCE(u.display_name, u.name) AS sender_name,
           r.id AS r_id, r.sender_type AS r_sender_type, r.message_type AS r_type, r.content AS r_content,
           CASE WHEN r.sender_type='agent' THEN COALESCE(ru.display_name, ru.name) END AS r_sender_name,
           (SELECT ra.mime_type FROM message_attachments ra WHERE ra.message_id=r.id LIMIT 1) AS r_mime
    FROM messages m
    LEFT JOIN users u ON m.sender_type='agent' AND u.id=m.sender_id
    LEFT JOIN messages r ON r.id=m.reply_to_id
    LEFT JOIN users ru ON r.sender_type='agent' AND ru.id=r.sender_id
    WHERE ${where} ${includeInternal ? '' : `AND m.message_type <> 'internal_note'`}
    ORDER BY m.created_at ASC`, params);
  if (!rows.length) return [];
  const atts = await many(`SELECT * FROM message_attachments WHERE message_id = ANY($1)`, [rows.map((r) => r.id)]);
  return rows.map((m) => serializeMessage(m, atts.filter((a) => a.message_id === m.id), includeInternal));
}
// customer-facing view of a message hides internal identities beyond display name
const forCustomer = (msg) => ({ ...msg, sender_id: undefined });

const customerOnline = new Map(); // customerId -> socket count
const agentSockets = new Map();   // userId -> socket count

async function convSummary(id) {
  const c = await one(`
    SELECT c.*, cu.player_id, cu.name AS customer_name, cu.email AS customer_email,
           COALESCE(u.display_name, u.name) AS agent_name,
           COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
                     FROM conversation_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.conversation_id=c.id), '[]') AS tags
    FROM conversations c
    JOIN customers cu ON cu.id=c.customer_id
    LEFT JOIN users u ON u.id=c.assigned_agent_id
    WHERE c.id=$1`, [id]);
  if (c) c.customer_online = (customerOnline.get(c.customer_id) || 0) > 0;
  return c;
}
const customerConvView = (c) => ({
  id: c.id, status: c.status, created_at: c.created_at, resolved_at: c.resolved_at, rating: c.rating,
  agent_name: c.agent_name || null, last_message_at: c.last_message_at,
});

function inboxTargets(conv, extra = []) {
  const rooms = ['inbox:all', ...extra];
  rooms.push(conv.assigned_agent_id ? `agent:${conv.assigned_agent_id}` : 'inbox:unassigned');
  return rooms;
}
function canSeeConv(user, conv) {
  if (ROLE_RANK[user.role] >= 2) return true;
  return !conv.assigned_agent_id || conv.assigned_agent_id === user.id;
}
function roomSize(room) { const r = io.sockets.adapter.rooms.get(room); return r ? r.size : 0; }

// ------------------------------------------------------------
// Core conversation services
// ------------------------------------------------------------
async function logEvent(convId, actorId, type, metadata = {}) {
  await q(`INSERT INTO conversation_events(conversation_id, actor_id, event_type, metadata) VALUES ($1,$2,$3,$4)`,
    [convId, actorId, type, metadata]);
}

async function pickAgent(excludeId = null) {
  return one(`
    SELECT u.id, COUNT(c.id)::int AS active
    FROM users u
    LEFT JOIN conversations c ON c.assigned_agent_id=u.id AND c.status IN ('open','pending')
    WHERE u.is_active AND u.presence='online' AND ($1::uuid IS NULL OR u.id <> $1::uuid)
    GROUP BY u.id, u.max_concurrent_chats, u.last_seen_at
    HAVING COUNT(c.id) < u.max_concurrent_chats
    ORDER BY active ASC, u.last_seen_at ASC NULLS FIRST
    LIMIT 1`, [excludeId]);
}

async function assignConversation(convId, agentId, byUser = null, reason = 'manual') {
  const before = await one(`SELECT * FROM conversations WHERE id=$1`, [convId]);
  if (!before) fail(404, 'Conversation not found');
  if ((before.assigned_agent_id || null) === (agentId || null)) return convSummary(convId);
  await tx(async (c) => {
    await c.query(`UPDATE conversation_assignments SET ended_at=NOW() WHERE conversation_id=$1 AND ended_at IS NULL`, [convId]);
    if (agentId) {
      await c.query(`INSERT INTO conversation_assignments(conversation_id, agent_id, assigned_by) VALUES ($1,$2,$3)`,
        [convId, agentId, byUser ? byUser.id : null]);
    }
    await c.query(`UPDATE conversations SET assigned_agent_id=$2, updated_at=NOW() WHERE id=$1`, [convId, agentId || null]);
  });
  await logEvent(convId, byUser ? byUser.id : null, agentId ? 'assigned' : 'unassigned', { agent_id: agentId, reason, from: before.assigned_agent_id });
  const conv = await convSummary(convId);
  const extra = [before.assigned_agent_id ? `agent:${before.assigned_agent_id}` : 'inbox:unassigned'];
  io.to(inboxTargets(conv, extra)).emit('inbox:conversation:updated', conv);
  io.to(`cconv:${convId}`).emit('chat:conversation:updated', customerConvView(conv));
  return conv;
}

let autoAssignRunning = false;
async function autoAssignWaiting() {
  if (autoAssignRunning) return;
  autoAssignRunning = true;
  try {
    const general = await getSetting('general');
    if (!general.auto_assign) return;
    const waiting = await many(`SELECT id FROM conversations WHERE assigned_agent_id IS NULL AND status IN ('open','pending') ORDER BY created_at ASC LIMIT 50`);
    for (const w of waiting) {
      const agent = await pickAgent();
      if (!agent) break;
      await assignConversation(w.id, agent.id, null, 'auto');
    }
  } catch (e) { console.error('auto-assign', e.message); } finally { autoAssignRunning = false; }
}

async function setStatus(convId, status, user = null) {
  const resolved = status === 'resolved' || status === 'closed';
  await q(`UPDATE conversations SET status=$2, updated_at=NOW(), resolved_at=${resolved ? 'COALESCE(resolved_at, NOW())' : 'NULL'} WHERE id=$1`, [convId, status]);
  await logEvent(convId, user ? user.id : null, 'status_changed', { status });
  if (resolved) {
    await createMessage({ convId, senderType: 'system', type: 'system', content: status === 'resolved' ? 'This chat has been resolved. Send a message any time if you need more help.' : 'This chat has been closed.' });
  }
  const conv = await convSummary(convId);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
  io.to(`cconv:${convId}`).emit('chat:conversation:updated', customerConvView(conv));
  if (resolved) autoAssignWaiting();
  return conv;
}

// Insert a message (idempotent with client_message_id), update conversation, fan out real-time events.
async function createMessage({ convId, senderType, senderId = null, type = 'text', content = null, clientId = null, attachmentId = null, replyToId = null }) {
  let duplicate = false;
  // reply/quote must point to a message in the same chat; a public message can never quote an internal note
  let replyTo = null;
  if (replyToId && isUuid(replyToId)) {
    const r = await one(`SELECT id, message_type FROM messages WHERE id=$1 AND conversation_id=$2`, [replyToId, convId]);
    if (r && (type === 'internal_note' || r.message_type !== 'internal_note')) replyTo = r.id;
  }
  const msg = await tx(async (c) => {
    let m = (await c.query(`
      INSERT INTO messages(conversation_id, sender_type, sender_id, message_type, content, client_message_id, reply_to_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (conversation_id, client_message_id) DO NOTHING RETURNING *`,
      [convId, senderType, senderId, type, content, clientId, replyTo])).rows[0];
    if (!m) {
      duplicate = true;
      return (await c.query(`SELECT * FROM messages WHERE conversation_id=$1 AND client_message_id=$2`, [convId, clientId])).rows[0];
    }
    let mime = null;
    if (attachmentId) {
      const upd = await c.query(`UPDATE message_attachments SET message_id=$1 WHERE id=$2 AND conversation_id=$3 AND message_id IS NULL
                                 AND uploaded_by_type=$4::varchar AND uploaded_by_id IS NOT DISTINCT FROM $5::uuid RETURNING mime_type`,
        [m.id, attachmentId, convId, senderType, senderId]);
      if (!upd.rowCount) throw new HttpError(400, 'Invalid attachment');
      mime = upd.rows[0].mime_type;
      if (type === 'text') {
        const nt = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'file';
        m = (await c.query(`UPDATE messages SET message_type=$2 WHERE id=$1 RETURNING *`, [m.id, nt])).rows[0];
      }
    }
    if (type !== 'internal_note') {
      const preview = previewFor(m.message_type, content, mime);
      await c.query(`
        UPDATE conversations SET last_message_at=NOW(), last_message_preview=$2, updated_at=NOW(),
          unread_agent = unread_agent + CASE WHEN $3='customer' THEN 1 ELSE 0 END,
          first_response_at = CASE WHEN $3='agent' AND first_response_at IS NULL THEN NOW() ELSE first_response_at END
        WHERE id=$1`, [convId, preview, senderType]);
    }
    return m;
  });
  const [full] = await loadMessages('m.id=$1', [msg.id], true);
  if (duplicate) return { message: full, duplicate };

  const conv = await convSummary(convId);
  if (type === 'internal_note') {
    io.to(`aconv:${convId}`).emit('inbox:message:new', { conversation: conv, message: full });
  } else {
    if (senderType !== 'customer' && roomSize(`cconv:${convId}`) > 0) {
      await q(`UPDATE messages SET delivered_at=NOW() WHERE id=$1`, [full.id]);
      full.delivered_at = new Date().toISOString();
    }
    io.to(`cconv:${convId}`).emit('chat:message:new', forCustomer(full));
    io.to([...inboxTargets(conv), `aconv:${convId}`]).emit('inbox:message:new', { conversation: conv, message: full });
  }
  return { message: full, duplicate };
}

// ------------------------------------------------------------
// Admin authentication
// ------------------------------------------------------------
const COOKIE = 'lsd_admin';
function setAuthCookie(res, user) {
  const exp = Date.now() + config.ADMIN_SESSION_HOURS * 3600000;
  const token = signToken({ uid: user.id, tv: user.token_version, exp });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.ADMIN_SESSION_HOURS * 3600}${config.COOKIE_SECURE ? '; Secure' : ''}`);
}
async function userFromCookieHeader(cookieHeader) {
  return userFromToken(parseCookies(cookieHeader)[COOKIE]);
}
// Mobile app: long-lived bearer token (same signature + token_version revocation as the cookie)
function mobileToken(user) {
  return signToken({ uid: user.id, tv: user.token_version, exp: Date.now() + config.MOBILE_SESSION_DAYS * 86400000, m: 1 });
}
async function userFromToken(token) {
  const p = readToken(token);
  if (!p) return null;
  const u = await one(`SELECT id, name, email, role, is_active, display_name, avatar_url, presence, max_concurrent_chats, token_version FROM users WHERE id=$1`, [p.uid]);
  if (!u || !u.is_active || u.token_version !== p.tv) return null;
  return u;
}
const requireAuth = ah(async (req, res, next) => {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer) {
    // mobile app — bearer tokens are not sent automatically by browsers, so no CSRF risk
    const u = await userFromToken(bearer);
    if (!u) fail(401, 'Not logged in');
    req.user = u;
    return next();
  }
  // CSRF guard: state-changing admin requests must carry a custom header (cross-site forms can't set it)
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'lsd') fail(403, 'Missing CSRF header');
  const u = await userFromCookieHeader(req.headers.cookie);
  if (!u) fail(401, 'Not logged in');
  req.user = u;
  next();
});
const requireRole = (min) => (req, res, next) => (ROLE_RANK[req.user.role] >= ROLE_RANK[min] ? next() : next(new HttpError(403, 'Permission denied')));
const ip = (req) => req.ip;

const A = express.Router();

A.post('/auth/login', ah(async (req, res) => {
  const mobile = req.body && req.body.mobile === true;
  if (!mobile && req.get('X-Requested-With') !== 'lsd') fail(403, 'Missing CSRF header');
  if (!rateLimit(`login:${ip(req)}`, config.RATE_LIMITS.loginPerMinute)) fail(429, 'Too many attempts. Try again in a minute.');
  const email = (str(req.body.email, 255, true, 'Email') || '').toLowerCase();
  const password = str(req.body.password, 200, true, 'Password');
  const u = await one(`SELECT * FROM users WHERE email=$1`, [email]);
  if (!u || !db.verifyPassword(password, u.password_hash)) {
    await audit(null, 'auth.login_failed', { email }, ip(req));
    fail(401, 'Invalid email or password');
  }
  if (!u.is_active) fail(403, 'Account disabled');
  await audit(u, mobile ? 'auth.login_mobile' : 'auth.login', {}, ip(req));
  if (mobile) {
    return res.json({ ok: true, token: mobileToken(u), user: { id: u.id, name: u.name, display_name: u.display_name, email: u.email, role: u.role } });
  }
  setAuthCookie(res, u);
  res.json({ ok: true });
}));

A.use(requireAuth);

A.post('/auth/logout', ah(async (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}));
A.post('/auth/logout-all', ah(async (req, res) => {
  await q(`UPDATE users SET token_version=token_version+1 WHERE id=$1`, [req.user.id]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  await audit(req.user, 'auth.logout_all', {}, ip(req));
  res.json({ ok: true });
}));
A.get('/auth/me', ah(async (req, res) => {
  const general = await getSetting('general');
  res.json({ user: req.user, company_name: general.company_name, sound: general.sound_notifications });
}));
A.post('/auth/change-password', ah(async (req, res) => {
  const current = str(req.body.current_password, 200, true, 'Current password');
  const next = str(req.body.new_password, 200, true, 'New password');
  if (next.length < 8) fail(400, 'New password must be at least 8 characters');
  const u = await one(`SELECT * FROM users WHERE id=$1`, [req.user.id]);
  if (!db.verifyPassword(current, u.password_hash)) fail(400, 'Current password is wrong');
  const upd = await one(`UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING *`, [u.id, db.hashPassword(next)]);
  setAuthCookie(res, upd);
  await audit(req.user, 'auth.password_changed', {}, ip(req));
  res.json({ ok: true });
}));
A.patch('/auth/profile', ah(async (req, res) => {
  const name = str(req.body.name, 150, true, 'Name');
  const display = str(req.body.display_name, 150) || name;
  const avatar = str(req.body.avatar_url, 500);
  await q(`UPDATE users SET name=$2, display_name=$3, avatar_url=$4 WHERE id=$1`, [req.user.id, name, display, avatar]);
  res.json({ ok: true });
}));

// ---------------- Dashboard ----------------
A.get('/dashboard', ah(async (req, res) => {
  const k = await one(`
    SELECT
      (SELECT COUNT(*) FROM conversations WHERE status='open')::int AS open,
      (SELECT COUNT(*) FROM conversations WHERE status IN ('open','pending') AND assigned_agent_id IS NULL)::int AS waiting,
      (SELECT COUNT(*) FROM conversations WHERE status='pending')::int AS pending,
      (SELECT COUNT(*) FROM users WHERE is_active AND presence='online')::int AS agents_online,
      (SELECT COUNT(*) FROM conversations WHERE resolved_at >= date_trunc('day', NOW()))::int AS resolved_today,
      (SELECT COUNT(*) FROM conversations WHERE created_at >= date_trunc('day', NOW()))::int AS new_today,
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))))::int FROM conversations WHERE first_response_at IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days') AS avg_first_response_sec,
      (SELECT ROUND(AVG(rating)::numeric, 2) FROM conversations WHERE rating IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days') AS avg_rating,
      (SELECT COUNT(*) FROM conversations WHERE assigned_agent_id=$1 AND status IN ('open','pending'))::int AS mine
  `, [req.user.id]);
  const online = await supportIsOnline();
  res.json({ ...k, support_online: online });
}));

// ---------------- Missed-notification sync (mobile app) ----------------
// Returns unread customer messages created after `since` in chats this user may see.
// The app calls it on every (re)connect and from a periodic background job, so a message
// that arrived while the phone was offline or asleep still gets a notification.
A.get('/notifications/sync', ah(async (req, res) => {
  const now = new Date().toISOString();
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  if (!since || isNaN(since.getTime())) return res.json({ server_time: now, items: [] }); // first run: start from now
  const floor = new Date(Math.max(since.getTime(), Date.now() - 3 * 86400000)); // never look back more than 3 days
  const rank = ROLE_RANK[req.user.role];
  const items = await many(`
    SELECT m.id, m.conversation_id, m.content, m.message_type, m.created_at,
           cu.player_id, cu.name AS customer_name, c.assigned_agent_id, c.status, c.unread_agent,
           (SELECT COUNT(*) FROM message_attachments a WHERE a.message_id=m.id)::int AS attachments,
           (SELECT a.mime_type FROM message_attachments a WHERE a.message_id=m.id LIMIT 1) AS attachment_mime
    FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    JOIN customers cu ON cu.id=c.customer_id
    WHERE m.sender_type='customer' AND m.read_at IS NULL AND m.created_at > $1
      ${rank < 2 ? 'AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id=$2)' : ''}
    ORDER BY m.created_at ASC LIMIT 300`, rank < 2 ? [floor.toISOString(), req.user.id] : [floor.toISOString()]);
  res.json({ server_time: now, items });
}));

// ---------------- Conversations (inbox) ----------------
async function getConvForUser(user, id) {
  if (!isUuid(id)) fail(404, 'Conversation not found');
  const c = await convSummary(id);
  if (!c) fail(404, 'Conversation not found');
  if (!canSeeConv(user, c)) fail(403, 'You cannot access this conversation');
  return c;
}

A.get('/conversations', ah(async (req, res) => {
  const view = req.query.view || 'inbox';
  const limit = int(req.query.limit, 30, 1, 100);
  const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const rank = ROLE_RANK[req.user.role];

  if (view === 'unassigned') where.push(`c.assigned_agent_id IS NULL AND c.status IN ('open','pending')`);
  else if (view === 'mine') where.push(`c.assigned_agent_id=${p(req.user.id)} AND c.status IN ('open','pending')`);
  else if (view === 'pending') where.push(`c.status='pending'`);
  else if (view === 'resolved') where.push(`c.status IN ('resolved','closed')`);
  else if (view === 'inbox') where.push(`c.status IN ('open','pending')`);
  // 'all' = no status filter

  if (rank < 2) where.push(`(c.assigned_agent_id IS NULL OR c.assigned_agent_id=${p(req.user.id)})`);
  if (req.query.status) where.push(`c.status=${p(oneOf(req.query.status, ['open', 'pending', 'resolved', 'closed'], 'status'))}`);
  if (req.query.priority) where.push(`c.priority=${p(oneOf(req.query.priority, ['low', 'normal', 'high', 'urgent'], 'priority'))}`);
  if (req.query.agent_id && isUuid(req.query.agent_id)) where.push(`c.assigned_agent_id=${p(req.query.agent_id)}`);
  if (req.query.tag_id && isUuid(req.query.tag_id)) where.push(`EXISTS (SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id=c.id AND ct.tag_id=${p(req.query.tag_id)})`);
  if (req.query.search) {
    const s = `%${str(req.query.search, 100).replace(/[%_]/g, '\\$&')}%`;
    const ph = p(s);
    where.push(`(cu.player_id ILIKE ${ph} OR cu.name ILIKE ${ph} OR cu.email ILIKE ${ph} OR c.subject ILIKE ${ph}
      OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.content ILIKE ${ph}))`);
  }
  if (req.query.cursor) {
    try {
      const [ts, id] = Buffer.from(req.query.cursor, 'base64url').toString().split('|');
      where.push(`(c.last_message_at, c.id) < (${p(ts)}::timestamptz, ${p(id)}::uuid)`);
    } catch { fail(400, 'Bad cursor'); }
  }
  const rows = await many(`
    SELECT c.id, c.status, c.priority, c.subject, c.last_message_at, c.last_message_preview, c.unread_agent,
           c.assigned_agent_id, c.created_at, c.customer_id, cu.player_id, cu.name AS customer_name,
           COALESCE(u.display_name, u.name) AS agent_name,
           COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
                     FROM conversation_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.conversation_id=c.id), '[]') AS tags
    FROM conversations c
    JOIN customers cu ON cu.id=c.customer_id
    LEFT JOIN users u ON u.id=c.assigned_agent_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT ${limit + 1}`, params);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({ ...r, customer_online: (customerOnline.get(r.customer_id) || 0) > 0 }));
  const last = items[items.length - 1];
  const counts = await one(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','pending') ${rank < 2 ? 'AND (assigned_agent_id IS NULL OR assigned_agent_id=$1)' : ''})::int AS inbox,
      COUNT(*) FILTER (WHERE status IN ('open','pending') AND assigned_agent_id IS NULL)::int AS unassigned,
      COUNT(*) FILTER (WHERE status IN ('open','pending') AND assigned_agent_id=$1)::int AS mine,
      COUNT(*) FILTER (WHERE status='pending' ${rank < 2 ? 'AND (assigned_agent_id IS NULL OR assigned_agent_id=$1)' : ''})::int AS pending
    FROM conversations`, [req.user.id]);
  res.json({
    items, counts,
    next_cursor: hasMore && last ? Buffer.from(`${new Date(last.last_message_at).toISOString()}|${last.id}`).toString('base64url') : null,
  });
}));

A.get('/conversations/:id', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const customer = await one(`SELECT * FROM customers WHERE id=$1`, [c.customer_id]);
  const stats = await one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('open','pending'))::int AS open FROM conversations WHERE customer_id=$1`, [c.customer_id]);
  const previous = await many(`SELECT id, status, created_at, last_message_preview FROM conversations WHERE customer_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 20`, [c.customer_id, c.id]);
  const events = await many(`SELECT e.*, u.name AS actor_name FROM conversation_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.conversation_id=$1 ORDER BY e.created_at DESC LIMIT 50`, [c.id]);
  res.json({ conversation: c, customer: { ...customer, stats, online: c.customer_online }, previous, events });
}));

A.get('/conversations/:id/messages', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  res.json({ items: await loadMessages('m.conversation_id=$1', [c.id], true) });
}));

A.post('/conversations/:id/reply', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const content = str(req.body.content, 5000);
  const attachmentId = req.body.attachment_id && isUuid(req.body.attachment_id) ? req.body.attachment_id : null;
  if (!content && !attachmentId) fail(400, 'Message is empty');
  const r = await agentSend(req.user, c, { content, attachmentId, clientId: str(req.body.client_message_id, 100), internal: false, replyToId: req.body.reply_to_id });
  res.json(r);
}));
A.post('/conversations/:id/notes', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const content = str(req.body.content, 5000, true, 'Note');
  res.json(await agentSend(req.user, c, { content, clientId: str(req.body.client_message_id, 100), internal: true, replyToId: req.body.reply_to_id }));
}));

async function agentSend(user, conv, { content, attachmentId, clientId, internal, replyToId }) {
  if (!internal && !conv.assigned_agent_id) {
    // replying to an unassigned chat claims it
    await assignConversation(conv.id, user.id, user, 'claimed_by_reply');
  }
  if (!internal && (conv.status === 'resolved' || conv.status === 'closed')) await setStatus(conv.id, 'open', user);
  return createMessage({ convId: conv.id, senderType: 'agent', senderId: user.id, type: internal ? 'internal_note' : 'text', content, clientId, attachmentId: internal ? null : attachmentId, replyToId });
}

A.patch('/conversations/:id/status', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const status = oneOf(req.body.status, ['open', 'pending', 'resolved', 'closed'], 'status');
  res.json({ conversation: await setStatus(c.id, status, req.user) });
}));
A.patch('/conversations/:id/priority', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const priority = oneOf(req.body.priority, ['low', 'normal', 'high', 'urgent'], 'priority');
  await q(`UPDATE conversations SET priority=$2, updated_at=NOW() WHERE id=$1`, [c.id, priority]);
  await logEvent(c.id, req.user.id, 'priority_changed', { priority });
  const conv = await convSummary(c.id);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
  res.json({ conversation: conv });
}));
A.patch('/conversations/:id/assign', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const agentId = req.body.agent_id || null;
  if (agentId && !isUuid(agentId)) fail(400, 'Invalid agent');
  if (ROLE_RANK[req.user.role] < 2 && agentId !== req.user.id) fail(403, 'Agents can only assign chats to themselves');
  if (agentId) {
    const a = await one(`SELECT id FROM users WHERE id=$1 AND is_active`, [agentId]);
    if (!a) fail(400, 'Agent not found');
  }
  res.json({ conversation: await assignConversation(c.id, agentId, req.user) });
}));
A.post('/conversations/:id/transfer', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  const agentId = req.body.agent_id;
  if (!isUuid(agentId)) fail(400, 'Choose an agent');
  if (ROLE_RANK[req.user.role] < 2 && c.assigned_agent_id !== req.user.id) fail(403, 'You can only transfer your own chats');
  const a = await one(`SELECT id, COALESCE(display_name, name) AS name FROM users WHERE id=$1 AND is_active`, [agentId]);
  if (!a) fail(400, 'Agent not found');
  const conv = await assignConversation(c.id, agentId, req.user, 'transfer');
  await createMessage({ convId: c.id, senderType: 'system', type: 'internal_note', content: `Transferred to ${a.name} by ${req.user.name}${req.body.note ? ': ' + str(req.body.note, 500) : ''}` });
  res.json({ conversation: conv });
}));
A.post('/conversations/:id/tags', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  let tagId = req.body.tag_id;
  if (!isUuid(tagId)) {
    const name = str(req.body.name, 60, true, 'Tag');
    tagId = (await one(`INSERT INTO tags(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [name])).id;
  }
  await q(`INSERT INTO conversation_tags VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.id, tagId]);
  const conv = await convSummary(c.id);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
  res.json({ conversation: conv });
}));
A.delete('/conversations/:id/tags/:tagId', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  if (isUuid(req.params.tagId)) await q(`DELETE FROM conversation_tags WHERE conversation_id=$1 AND tag_id=$2`, [c.id, req.params.tagId]);
  const conv = await convSummary(c.id);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
  res.json({ conversation: conv });
}));
A.post('/conversations/:id/read', ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.params.id);
  await markReadByAgent(c.id);
  res.json({ ok: true });
}));
async function markReadByAgent(convId) {
  await q(`UPDATE conversations SET unread_agent=0 WHERE id=$1`, [convId]);
  const r = await q(`UPDATE messages SET read_at=NOW(), delivered_at=COALESCE(delivered_at, NOW())
                     WHERE conversation_id=$1 AND sender_type='customer' AND read_at IS NULL RETURNING id`, [convId]);
  if (r.rowCount) io.to(`cconv:${convId}`).emit('chat:message:read', { conversation_id: convId, message_ids: r.rows.map((x) => x.id), by: 'agent' });
  const conv = await convSummary(convId);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
}

// ---------------- Tags ----------------
A.get('/tags', ah(async (req, res) => res.json({ items: await many(`SELECT * FROM tags ORDER BY name`) })));
A.post('/tags', requireRole('supervisor'), ah(async (req, res) => {
  const t = await one(`INSERT INTO tags(name, color) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color RETURNING *`,
    [str(req.body.name, 60, true, 'Name'), str(req.body.color, 20) || '#64748b']);
  res.json(t);
}));
A.delete('/tags/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (isUuid(req.params.id)) await q(`DELETE FROM tags WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- Customers ----------------
A.get('/customers', ah(async (req, res) => {
  const limit = int(req.query.limit, 50, 1, 200);
  const offset = int(req.query.offset, 0, 0, 1e9);
  const params = []; let where = '';
  if (req.query.search) {
    params.push(`%${str(req.query.search, 100).replace(/[%_]/g, '\\$&')}%`);
    where = `WHERE cu.player_id ILIKE $1 OR cu.name ILIKE $1 OR cu.email ILIKE $1`;
  }
  const items = await many(`
    SELECT cu.*, (SELECT COUNT(*) FROM conversations c WHERE c.customer_id=cu.id)::int AS total_conversations,
           (SELECT COUNT(*) FROM conversations c WHERE c.customer_id=cu.id AND c.status IN ('open','pending'))::int AS open_conversations
    FROM customers cu ${where} ORDER BY cu.last_seen_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = (await one(`SELECT COUNT(*)::int AS c FROM customers cu ${where}`, params)).c;
  res.json({ items: items.map((c) => ({ ...c, online: (customerOnline.get(c.id) || 0) > 0 })), total });
}));
A.get('/customers/:id', ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const cu = await one(`SELECT * FROM customers WHERE id=$1`, [req.params.id]);
  if (!cu) fail(404, 'Not found');
  const rank = ROLE_RANK[req.user.role];
  const conversations = await many(`
    SELECT c.id, c.status, c.priority, c.created_at, c.last_message_preview, c.rating, COALESCE(u.display_name, u.name) AS agent_name
    FROM conversations c LEFT JOIN users u ON u.id=c.assigned_agent_id
    WHERE c.customer_id=$1 ${rank < 2 ? 'AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id=$2)' : ''}
    ORDER BY c.created_at DESC`, rank < 2 ? [cu.id, req.user.id] : [cu.id]);
  res.json({ customer: { ...cu, online: (customerOnline.get(cu.id) || 0) > 0 }, conversations });
}));
A.patch('/customers/:id', ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const cu = await one(`SELECT * FROM customers WHERE id=$1`, [req.params.id]);
  if (!cu) fail(404, 'Not found');
  const name = req.body.name !== undefined ? str(req.body.name, 150) : cu.name;
  const email = req.body.email !== undefined ? str(req.body.email, 255) : cu.email;
  const notes = req.body.notes !== undefined ? str(req.body.notes, 5000) : cu.notes;
  let metadata = cu.metadata;
  if (req.body.metadata !== undefined) {
    if (typeof req.body.metadata !== 'object' || Array.isArray(req.body.metadata)) fail(400, 'metadata must be an object');
    metadata = req.body.metadata;
  }
  let blocked = cu.is_blocked;
  if (req.body.is_blocked !== undefined) {
    if (ROLE_RANK[req.user.role] < 2) fail(403, 'Only supervisors can block customers');
    blocked = !!req.body.is_blocked;
  }
  const upd = await one(`UPDATE customers SET name=$2, email=$3, notes=$4, metadata=$5, is_blocked=$6 WHERE id=$1 RETURNING *`,
    [cu.id, name, email, notes, metadata, blocked]);
  if (blocked !== cu.is_blocked) {
    await audit(req.user, blocked ? 'customer.blocked' : 'customer.unblocked', { customer_id: cu.id, player_id: cu.player_id }, ip(req));
    if (blocked) { await q(`UPDATE customer_sessions SET revoked_at=NOW() WHERE customer_id=$1 AND revoked_at IS NULL`, [cu.id]); kickCustomer(cu.id); }
  }
  res.json({ customer: upd });
}));
A.post('/customers/:id/revoke-sessions', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  await q(`UPDATE customer_sessions SET revoked_at=NOW() WHERE customer_id=$1 AND revoked_at IS NULL`, [req.params.id]);
  kickCustomer(req.params.id);
  await audit(req.user, 'customer.sessions_revoked', { customer_id: req.params.id }, ip(req));
  res.json({ ok: true });
}));
async function kickCustomer(customerId) {
  const socks = await io.in(`customer:${customerId}`).fetchSockets();
  socks.forEach((s) => { s.emit('chat:session:revoked'); s.disconnect(true); });
}

// ---------------- FAQ management ----------------
A.get('/faq/categories', ah(async (req, res) => {
  res.json({ items: await many(`SELECT c.*, (SELECT COUNT(*) FROM faqs f WHERE f.category_id=c.id)::int AS faq_count FROM faq_categories c ORDER BY sort_order, created_at`) });
}));
A.post('/faq/categories', requireRole('supervisor'), ah(async (req, res) => {
  const max = await one(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM faq_categories`);
  const c = await one(`INSERT INTO faq_categories(title, sort_order, is_active) VALUES ($1,$2,$3) RETURNING *`,
    [str(req.body.title, 200, true, 'Title'), max.n, req.body.is_active !== false]);
  await audit(req.user, 'faq.category_created', { id: c.id, title: c.title }, ip(req));
  res.json(c);
}));
A.patch('/faq/categories/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const c = await one(`UPDATE faq_categories SET title=COALESCE($2,title), is_active=COALESCE($3,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.title, 200), typeof req.body.is_active === 'boolean' ? req.body.is_active : null]);
  if (!c) fail(404, 'Not found');
  res.json(c);
}));
A.delete('/faq/categories/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  await q(`DELETE FROM faq_categories WHERE id=$1`, [req.params.id]);
  await audit(req.user, 'faq.category_deleted', { id: req.params.id }, ip(req));
  res.json({ ok: true });
}));
A.get('/faq/questions', ah(async (req, res) => {
  const params = []; let where = '';
  if (isUuid(req.query.category_id)) { params.push(req.query.category_id); where = 'WHERE f.category_id=$1'; }
  const items = await many(`
    SELECT f.*, c.title AS category_title,
      COALESCE((SELECT json_agg(r.related_faq_id) FROM faq_related r WHERE r.faq_id=f.id), '[]') AS related_ids,
      (SELECT COUNT(*) FROM faq_analytics a WHERE a.faq_id=f.id AND a.event_type='answer_view')::int AS views,
      (SELECT COUNT(*) FROM faq_analytics a WHERE a.faq_id=f.id AND a.event_type='helpful')::int AS helpful,
      (SELECT COUNT(*) FROM faq_analytics a WHERE a.faq_id=f.id AND a.event_type='not_helpful')::int AS not_helpful
    FROM faqs f JOIN faq_categories c ON c.id=f.category_id ${where}
    ORDER BY c.sort_order, f.sort_order, f.created_at`, params);
  res.json({ items });
}));
A.post('/faq/questions', requireRole('supervisor'), ah(async (req, res) => {
  const categoryId = req.body.category_id;
  if (!isUuid(categoryId) || !(await one(`SELECT id FROM faq_categories WHERE id=$1`, [categoryId]))) fail(400, 'Choose a category');
  const max = await one(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM faqs WHERE category_id=$1`, [categoryId]);
  const f = await one(`INSERT INTO faqs(category_id, question, answer, sort_order, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [categoryId, str(req.body.question, 500, true, 'Question'), str(req.body.answer, 10000, true, 'Answer'), max.n, req.body.is_active !== false]);
  await audit(req.user, 'faq.created', { id: f.id, question: f.question }, ip(req));
  res.json(f);
}));
A.patch('/faq/questions/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const categoryId = isUuid(req.body.category_id) ? req.body.category_id : null;
  const f = await one(`UPDATE faqs SET question=COALESCE($2,question), answer=COALESCE($3,answer), category_id=COALESCE($4,category_id),
                       is_active=COALESCE($5,is_active), updated_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.question, 500), str(req.body.answer, 10000), categoryId, typeof req.body.is_active === 'boolean' ? req.body.is_active : null]);
  if (!f) fail(404, 'Not found');
  await audit(req.user, 'faq.updated', { id: f.id }, ip(req));
  res.json(f);
}));
A.delete('/faq/questions/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  await q(`DELETE FROM faqs WHERE id=$1`, [req.params.id]);
  await audit(req.user, 'faq.deleted', { id: req.params.id }, ip(req));
  res.json({ ok: true });
}));
A.put('/faq/reorder', requireRole('supervisor'), ah(async (req, res) => {
  const table = req.body.type === 'category' ? 'faq_categories' : 'faqs';
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(isUuid) : [];
  await tx(async (c) => { for (let i = 0; i < ids.length; i++) await c.query(`UPDATE ${table} SET sort_order=$2 WHERE id=$1`, [ids[i], i + 1]); });
  res.json({ ok: true });
}));
A.put('/faq/questions/:id/related', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((x) => isUuid(x) && x !== req.params.id).slice(0, 10);
  await tx(async (c) => {
    await c.query(`DELETE FROM faq_related WHERE faq_id=$1`, [req.params.id]);
    for (const r of ids) await c.query(`INSERT INTO faq_related VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, r]);
  });
  res.json({ ok: true });
}));
A.get('/faq/analytics', ah(async (req, res) => {
  const days = int(req.query.days, 30, 1, 365);
  const items = await many(`
    SELECT f.id, f.question, c.title AS category,
      COUNT(a.*) FILTER (WHERE a.event_type='click')::int AS clicks,
      COUNT(a.*) FILTER (WHERE a.event_type='answer_view')::int AS views,
      COUNT(a.*) FILTER (WHERE a.event_type='helpful')::int AS helpful,
      COUNT(a.*) FILTER (WHERE a.event_type='not_helpful')::int AS not_helpful,
      COUNT(a.*) FILTER (WHERE a.event_type='live_chat_click')::int AS live_chat_clicks
    FROM faqs f JOIN faq_categories c ON c.id=f.category_id
    LEFT JOIN faq_analytics a ON a.faq_id=f.id AND a.created_at >= NOW() - ($1 || ' days')::interval
    GROUP BY f.id, c.title ORDER BY views DESC, clicks DESC`, [days]);
  const totals = await one(`SELECT
      COUNT(*) FILTER (WHERE event_type='view')::int AS widget_faq_opens,
      COUNT(*) FILTER (WHERE event_type='live_chat_click')::int AS live_chat_clicks
    FROM faq_analytics WHERE created_at >= NOW() - ($1 || ' days')::interval`, [days]);
  res.json({ items, totals });
}));

// ---------------- Agents / team ----------------
A.get('/agents', ah(async (req, res) => {
  const items = await many(`
    SELECT u.id, u.name, u.email, u.role, u.is_active, u.display_name, u.avatar_url, u.presence, u.last_seen_at,
           u.max_concurrent_chats, u.created_at,
           (SELECT COUNT(*) FROM conversations c WHERE c.assigned_agent_id=u.id AND c.status IN ('open','pending'))::int AS active_chats
    FROM users u ORDER BY u.is_active DESC, u.presence='online' DESC, u.name`);
  res.json({ items });
}));
A.post('/agents', requireRole('admin'), ah(async (req, res) => {
  const role = oneOf(req.body.role || 'agent', ['admin', 'supervisor', 'agent'], 'role');
  if (role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can create admins');
  const email = (str(req.body.email, 255, true, 'Email') || '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Invalid email');
  const pw = str(req.body.password, 200, true, 'Password');
  if (pw.length < 8) fail(400, 'Password must be at least 8 characters');
  if (await one(`SELECT id FROM users WHERE email=$1`, [email])) fail(400, 'Email already used');
  const name = str(req.body.name, 150, true, 'Name');
  const u = await one(`INSERT INTO users(name, email, password_hash, role, display_name, max_concurrent_chats) VALUES ($1,$2,$3,$4,$5,$6)
                       RETURNING id, name, email, role`,
    [name, email, db.hashPassword(pw), role, str(req.body.display_name, 150) || name, int(req.body.max_concurrent_chats, 5, 1, 100)]);
  await audit(req.user, 'agent.created', { id: u.id, email, role }, ip(req));
  res.json(u);
}));
A.patch('/agents/:id', ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const target = await one(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!target) fail(404, 'Not found');
  const self = target.id === req.user.id;
  const rank = ROLE_RANK[req.user.role];
  if (!self && rank < 3) fail(403, 'Permission denied');
  if (!self && target.role === 'owner') fail(403, 'The owner account can only be edited by the owner');
  if (!self && target.role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can edit admins');
  const b = req.body; const changes = {};
  let role = target.role;
  if (b.role !== undefined && !self) {
    role = oneOf(b.role, ['admin', 'supervisor', 'agent'], 'role');
    if (role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can grant admin');
    changes.role = role;
  }
  let isActive = target.is_active;
  if (b.is_active !== undefined && !self) { isActive = !!b.is_active; changes.is_active = isActive; }
  let pwHash = target.password_hash; let tv = target.token_version;
  if (b.password && !self) {
    if (String(b.password).length < 8) fail(400, 'Password must be at least 8 characters');
    pwHash = db.hashPassword(String(b.password)); tv++; changes.password = 'reset';
  }
  if (!isActive && target.is_active) tv++;
  const upd = await one(`UPDATE users SET name=$2, display_name=$3, role=$4, is_active=$5, max_concurrent_chats=$6, password_hash=$7, token_version=$8,
                         presence=CASE WHEN $5 THEN presence ELSE 'offline' END WHERE id=$1
                         RETURNING id, name, email, role, is_active, display_name, max_concurrent_chats, presence`,
    [target.id, str(b.name, 150) || target.name, str(b.display_name, 150) || target.display_name, role, isActive,
     b.max_concurrent_chats !== undefined ? int(b.max_concurrent_chats, 5, 1, 100) : target.max_concurrent_chats, pwHash, tv]);
  if (Object.keys(changes).length) await audit(req.user, 'agent.updated', { id: target.id, email: target.email, ...changes }, ip(req));
  if (!isActive && target.is_active) {
    // unassign their open chats so they go back to the queue
    const open = await many(`SELECT id FROM conversations WHERE assigned_agent_id=$1 AND status IN ('open','pending')`, [target.id]);
    for (const c of open) await assignConversation(c.id, null, req.user, 'agent_disabled');
    const socks = await io.in(`agent:${target.id}`).fetchSockets();
    socks.forEach((s) => s.disconnect(true));
    autoAssignWaiting();
  }
  io.to('agents').emit('inbox:agent:presence', { agent_id: upd.id, presence: upd.presence });
  res.json(upd);
}));
A.delete('/agents/:id', requireRole('admin'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const target = await one(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!target) fail(404, 'Not found');
  if (target.role === 'owner' || target.id === req.user.id) fail(400, 'This account cannot be deleted');
  if (target.role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can delete admins');
  const open = await many(`SELECT id FROM conversations WHERE assigned_agent_id=$1 AND status IN ('open','pending')`, [target.id]);
  for (const c of open) await assignConversation(c.id, null, req.user, 'agent_deleted');
  const socks = await io.in(`agent:${target.id}`).fetchSockets();
  socks.forEach((s) => s.disconnect(true));
  await q(`DELETE FROM users WHERE id=$1`, [target.id]);
  await audit(req.user, 'agent.deleted', { id: target.id, email: target.email }, ip(req));
  autoAssignWaiting();
  res.json({ ok: true });
}));
A.put('/agents/me/presence', ah(async (req, res) => {
  const presence = oneOf(req.body.presence, ['online', 'away', 'busy', 'offline'], 'presence');
  await updatePresence(req.user.id, presence);
  res.json({ ok: true, presence });
}));
A.get('/agents/performance', requireRole('supervisor'), ah(async (req, res) => {
  res.json({ items: await agentPerformance(int(req.query.days, 30, 1, 365)) });
}));
async function agentPerformance(days) {
  return many(`
    SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.role, u.presence,
      (SELECT COUNT(DISTINCT ca.conversation_id) FROM conversation_assignments ca WHERE ca.agent_id=u.id AND ca.assigned_at >= NOW() - ($1 || ' days')::interval)::int AS handled,
      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_agent_id=u.id AND c.resolved_at >= NOW() - ($1 || ' days')::interval)::int AS resolved,
      (SELECT COUNT(*) FROM messages m WHERE m.sender_type='agent' AND m.sender_id=u.id AND m.message_type<>'internal_note' AND m.created_at >= NOW() - ($1 || ' days')::interval)::int AS replies,
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at))))::int FROM conversations c WHERE c.assigned_agent_id=u.id AND c.first_response_at IS NOT NULL AND c.created_at >= NOW() - ($1 || ' days')::interval) AS avg_first_response_sec,
      (SELECT ROUND(AVG(c.rating)::numeric,2) FROM conversations c WHERE c.assigned_agent_id=u.id AND c.rating IS NOT NULL AND c.created_at >= NOW() - ($1 || ' days')::interval) AS avg_rating,
      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_agent_id=u.id AND c.status IN ('open','pending'))::int AS active_chats
    FROM users u WHERE u.is_active ORDER BY resolved DESC, handled DESC`, [days]);
}

// ---------------- Canned responses ----------------
A.get('/canned-responses', ah(async (req, res) => res.json({ items: await many(`SELECT * FROM canned_responses ORDER BY shortcut`) })));
A.post('/canned-responses', requireRole('supervisor'), ah(async (req, res) => {
  const shortcut = (str(req.body.shortcut, 100, true, 'Shortcut') || '').replace(/^\//, '').replace(/\s+/g, '-').toLowerCase();
  if (await one(`SELECT id FROM canned_responses WHERE shortcut=$1`, [shortcut])) fail(400, 'Shortcut already exists');
  const r = await one(`INSERT INTO canned_responses(shortcut, title, content, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [shortcut, str(req.body.title, 200, true, 'Title'), str(req.body.content, 5000, true, 'Content'), req.user.id]);
  res.json(r);
}));
A.patch('/canned-responses/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const shortcut = req.body.shortcut ? str(req.body.shortcut, 100).replace(/^\//, '').replace(/\s+/g, '-').toLowerCase() : null;
  const r = await one(`UPDATE canned_responses SET shortcut=COALESCE($2,shortcut), title=COALESCE($3,title), content=COALESCE($4,content) WHERE id=$1 RETURNING *`,
    [req.params.id, shortcut, str(req.body.title, 200), str(req.body.content, 5000)]);
  if (!r) fail(404, 'Not found');
  res.json(r);
}));
A.delete('/canned-responses/:id', requireRole('supervisor'), ah(async (req, res) => {
  if (isUuid(req.params.id)) await q(`DELETE FROM canned_responses WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- Settings ----------------
A.get('/settings', ah(async (req, res) => {
  const out = {};
  for (const k of Object.keys(db.DEFAULT_SETTINGS)) out[k] = await getSetting(k);
  if (ROLE_RANK[req.user.role] < 3) delete out.security;
  out.embed_snippet = `<script src="${config.PUBLIC_URL}/widget.js" async></script>`;
  res.json(out);
}));
A.put('/settings/:key', requireRole('admin'), ah(async (req, res) => {
  const key = req.params.key;
  if (!db.DEFAULT_SETTINGS[key]) fail(404, 'Unknown settings group');
  const current = await getSetting(key);
  const incoming = req.body || {};
  const next = { ...current };
  for (const [k, def] of Object.entries(db.DEFAULT_SETTINGS[key])) {
    if (incoming[k] === undefined) continue;
    const v = incoming[k];
    if (typeof def === 'boolean') next[k] = !!v;
    else if (typeof def === 'number') next[k] = Number(v) || 0;
    else if (typeof def === 'string') next[k] = String(v).slice(0, 2000);
    else if (Array.isArray(def)) next[k] = (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 100);
    else if (typeof def === 'object') next[k] = v && typeof v === 'object' ? v : def;
  }
  if (key === 'widget' && next.primary_color && !/^#[0-9a-f]{3,8}$/i.test(next.primary_color)) fail(400, 'Invalid primary color');
  if (key === 'business_hours') {
    for (let d = 0; d < 7; d++) {
      const day = next.days[d] || next.days[String(d)];
      if (!day || !/^\d\d:\d\d$/.test(day.open) || !/^\d\d:\d\d$/.test(day.close)) fail(400, 'Invalid business hours');
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: next.timezone }); } catch { fail(400, 'Invalid timezone'); }
  }
  await setSetting(key, next);
  await audit(req.user, `settings.${key}_updated`, key === 'security' ? { allowed_domains: next.allowed_domains, identity_secret_set: !!next.identity_secret } : {}, ip(req));
  if (key === 'business_hours') broadcastSupportStatus();
  res.json(next);
}));

// ---------------- Analytics ----------------
A.get('/analytics', requireRole('supervisor'), ah(async (req, res) => {
  const days = int(req.query.days, 7, 1, 365);
  const daily = await many(`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT COUNT(*) FROM conversations c WHERE c.created_at >= d AND c.created_at < d + INTERVAL '1 day')::int AS created,
      (SELECT COUNT(*) FROM conversations c WHERE c.resolved_at >= d AND c.resolved_at < d + INTERVAL '1 day')::int AS resolved,
      (SELECT COUNT(*) FROM messages m WHERE m.created_at >= d AND m.created_at < d + INTERVAL '1 day' AND m.message_type<>'internal_note')::int AS messages
    FROM generate_series(date_trunc('day', NOW()) - ($1::int - 1) * INTERVAL '1 day', date_trunc('day', NOW()), INTERVAL '1 day') d
    ORDER BY d`, [days]);
  const totals = await one(`
    SELECT COUNT(*)::int AS conversations,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
      ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))))::int AS avg_first_response_sec,
      ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))))::int AS avg_resolution_sec,
      ROUND(AVG(rating)::numeric, 2) AS avg_rating,
      COUNT(rating)::int AS ratings,
      COUNT(DISTINCT customer_id)::int AS customers
    FROM conversations WHERE created_at >= NOW() - ($1 || ' days')::interval`, [days]);
  const byStatus = await many(`SELECT status, COUNT(*)::int AS count FROM conversations GROUP BY status`);
  const byPriority = await many(`SELECT priority, COUNT(*)::int AS count FROM conversations WHERE created_at >= NOW() - ($1 || ' days')::interval GROUP BY priority`, [days]);
  const byHour = await many(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE $2)::int AS hour, COUNT(*)::int AS count FROM conversations WHERE created_at >= NOW() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`,
    [days, (await getSetting('business_hours')).timezone || 'UTC']);
  res.json({ days, daily, totals, by_status: byStatus, by_priority: byPriority, by_hour: byHour, agents: await agentPerformance(days) });
}));

// ---------------- Audit logs ----------------
A.get('/audit-logs', requireRole('admin'), ah(async (req, res) => {
  const limit = int(req.query.limit, 50, 1, 200);
  const params = []; let where = '';
  if (req.query.before) { params.push(parseInt(req.query.before, 10) || 0); where = `WHERE id < $1`; }
  const items = await many(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ${limit}`, params);
  res.json({ items, next_before: items.length === limit ? items[items.length - 1].id : null });
}));

// ---------------- Uploads (agent) ----------------
const normMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
const mimeAllowed = (m) => config.ALLOWED_MIME.includes(m) || (config.ALLOWED_MIME_PREFIXES || []).some((p) => m.startsWith(p));
const upload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(mimeAllowed(normMime(file.mimetype)) ? null : new HttpError(400, 'File type not allowed'), true),
});
function sniffOk(filePath, mime) {
  // basic magic-byte check so a renamed executable can't pose as an image/pdf
  const buf = Buffer.alloc(16); const fd = fs.openSync(filePath, 'r'); fs.readSync(fd, buf, 0, 16, 0); fs.closeSync(fd);
  const hex = buf.toString('hex');
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46')) return false; // Windows .exe / Linux ELF
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/gif') return hex.startsWith('47494638');
  if (mime === 'image/webp') return hex.startsWith('52494646') && buf.slice(8, 12).toString() === 'WEBP';
  if (mime === 'application/pdf') return hex.startsWith('25504446');
  return true;
}

// WhatsApp-style image handling: auto-rotate, strip EXIF/GPS, max 1600px, JPEG q75, plus a small thumbnail.
const IMG = { maxSide: 1600, quality: 75, thumbSide: 360, thumbQuality: 55 };
async function processImage(filePath, mime) {
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') return null;
  let sharp;
  try { sharp = require('sharp'); } catch { return null; } // sharp not installed → keep original
  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    const animated = (meta.pages || 1) > 1; // animated GIF/WebP: keep original so it still moves
    const out = { mime, size: fs.statSync(filePath).size, thumb: null, width: meta.width, height: meta.height };
    if (!animated) {
      const tmp = filePath + '.c';
      const info = await sharp(filePath, { failOn: 'none' })
        .rotate()
        .resize({ width: IMG.maxSide, height: IMG.maxSide, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: IMG.quality, mozjpeg: true, progressive: true })
        .toFile(tmp);
      const browserFriendly = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime);
      if (info.size < out.size || !browserFriendly) {
        fs.renameSync(tmp, filePath);
        Object.assign(out, { mime: 'image/jpeg', size: info.size, width: info.width, height: info.height, converted: true });
      } else fs.unlinkSync(tmp);
    }
    const thumbPath = filePath + '_t';
    await sharp(filePath, { failOn: 'none' }).rotate()
      .resize({ width: IMG.thumbSide, height: IMG.thumbSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: IMG.thumbQuality }).toFile(thumbPath);
    out.thumb = path.basename(thumbPath);
    return out;
  } catch (e) {
    console.warn('image processing skipped:', e.message);
    return null;
  }
}

async function saveUpload(req, convId, byType, byId) {
  if (!req.file) fail(400, 'No file uploaded');
  let mime = normMime(req.file.mimetype);
  if (!sniffOk(req.file.path, mime)) { fs.unlink(req.file.path, () => {}); fail(400, 'File content does not match its type'); }
  let name = path.basename(req.file.originalname || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';
  let size = req.file.size;
  let thumb = null;
  const img = await processImage(req.file.path, mime);
  if (img) {
    thumb = img.thumb;
    if (img.converted) { mime = img.mime; size = img.size; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
  }
  const duration = mime.startsWith('audio/') ? int(req.body.duration_ms, 0, 0, 3600000) || null : null;
  const a = await one(`INSERT INTO message_attachments(conversation_id, uploaded_by_type, uploaded_by_id, file_name, mime_type, file_size, storage_key, thumb_key, duration_ms)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [convId, byType, byId, name, mime, size, req.file.filename, thumb, duration]);
  return serializeAttachment(a);
}
A.post('/uploads', upload.single('file'), ah(async (req, res) => {
  const c = await getConvForUser(req.user, req.body.conversation_id);
  res.json(await saveUpload(req, c.id, 'agent', req.user.id));
}));

app.use('/api/admin', A);

// ------------------------------------------------------------
// Public (widget) API
// ------------------------------------------------------------
const P = express.Router();

P.use(ah(async (req, res, next) => {
  const security = await getSetting('security');
  const origin = req.get('origin');
  if (!originAllowed(origin, security)) {
    if (req.method === 'OPTIONS') return res.sendStatus(403);
    fail(403, 'This website is not allowed to use the support widget');
  }
  if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  req.security = security;
  next();
}));

async function sessionFromToken(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const s = await one(`
    SELECT s.*, cu.player_id, cu.name, cu.email, cu.is_blocked
    FROM customer_sessions s JOIN customers cu ON cu.id=s.customer_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`, [sha256(token)]);
  if (!s || s.is_blocked) return null;
  return s;
}
const requireCustomer = ah(async (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const s = await sessionFromToken(token);
  if (!s) fail(401, 'Session expired', 'session_expired');
  req.session = s;
  next();
});
// verified sessions see the customer's full history; unverified sessions only see chats they started
const convAccessSql = (alias = 'c') => `(${alias}.customer_id=$1 AND ($2::boolean OR ${alias}.session_id=$3))`;
const convAccessParams = (s) => [s.customer_id, s.verified, s.id];
async function getCustomerConv(s, id) {
  if (!isUuid(id)) fail(404, 'Conversation not found');
  const c = await one(`SELECT c.*, COALESCE(u.display_name, u.name) AS agent_name FROM conversations c LEFT JOIN users u ON u.id=c.assigned_agent_id
                       WHERE c.id=$4 AND ${convAccessSql()}`, [...convAccessParams(s), id]);
  if (!c) fail(404, 'Conversation not found');
  return c;
}

P.get('/config', ah(async (req, res) => {
  const widget = await getSetting('widget');
  const general = await getSetting('general');
  res.json({
    widget, company_name: general.company_name,
    online: await supportIsOnline(),
    identity_verification: !!req.security.identity_secret,
  });
}));

P.get('/faqs', ah(async (req, res) => {
  const cats = await many(`SELECT id, title FROM faq_categories WHERE is_active ORDER BY sort_order, created_at`);
  const faqs = await many(`SELECT f.id, f.category_id, f.question FROM faqs f JOIN faq_categories c ON c.id=f.category_id
                           WHERE f.is_active AND c.is_active ORDER BY f.sort_order, f.created_at`);
  if (req.query.track !== '0') q(`INSERT INTO faq_analytics(faq_id, event_type) VALUES (NULL, 'view')`).catch(() => {});
  res.json({ categories: cats.map((c) => ({ ...c, faqs: faqs.filter((f) => f.category_id === c.id) })) });
}));
P.get('/faqs/search', ah(async (req, res) => {
  const s = str(req.query.q, 100);
  if (!s) return res.json({ items: [] });
  const like = `%${s.replace(/[%_]/g, '\\$&')}%`;
  res.json({ items: await many(`SELECT f.id, f.question FROM faqs f JOIN faq_categories c ON c.id=f.category_id
                                WHERE f.is_active AND c.is_active AND (f.question ILIKE $1 OR f.answer ILIKE $1) ORDER BY f.sort_order LIMIT 20`, [like]) });
}));
P.get('/faqs/:id', ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  const f = await one(`SELECT f.id, f.question, f.answer, f.category_id, c.title AS category FROM faqs f JOIN faq_categories c ON c.id=f.category_id
                       WHERE f.id=$1 AND f.is_active AND c.is_active`, [req.params.id]);
  if (!f) fail(404, 'Not found');
  let related = await many(`SELECT f.id, f.question FROM faq_related r JOIN faqs f ON f.id=r.related_faq_id WHERE r.faq_id=$1 AND f.is_active`, [f.id]);
  const more = await many(`SELECT id, question FROM faqs WHERE category_id=$1 AND id<>$2 AND is_active ORDER BY sort_order LIMIT 5`, [f.category_id, f.id]);
  q(`INSERT INTO faq_analytics(faq_id, event_type) VALUES ($1, 'answer_view')`, [f.id]).catch(() => {});
  res.json({ ...f, related, more: more.filter((m) => !related.some((r) => r.id === m.id)) });
}));
P.post('/faqs/:id/feedback', ah(async (req, res) => {
  if (!isUuid(req.params.id)) fail(404, 'Not found');
  if (!rateLimit(`faqfb:${ip(req)}`, 30)) fail(429, 'Slow down');
  await q(`INSERT INTO faq_analytics(faq_id, event_type) SELECT id, $2 FROM faqs WHERE id=$1`, [req.params.id, req.body.helpful ? 'helpful' : 'not_helpful']);
  res.json({ ok: true });
}));
P.post('/faq-events', ah(async (req, res) => {
  const type = oneOf(req.body.event_type, ['click', 'live_chat_click'], 'event_type');
  if (!rateLimit(`faqev:${ip(req)}`, 120)) return res.json({ ok: true });
  const faqId = isUuid(req.body.faq_id) ? req.body.faq_id : null;
  await q(`INSERT INTO faq_analytics(faq_id, event_type) VALUES ((SELECT id FROM faqs WHERE id=$1), $2)`, [faqId, type]);
  res.json({ ok: true });
}));

P.post('/sessions/identify', ah(async (req, res) => {
  if (!rateLimit(`identify:${ip(req)}`, config.RATE_LIMITS.identifyPerMinute)) fail(429, 'Too many attempts. Please wait a minute.');
  const widget = await getSetting('widget');
  let playerId = str(req.body.player_id, 150);
  if (!playerId) {
    if (widget.require_player_id) fail(400, `${widget.player_id_label || 'Player ID'} is required`);
    playerId = 'guest_' + crypto.randomBytes(8).toString('hex');
  }
  if (!/^[\w.@\-+:]{1,150}$/.test(playerId)) fail(400, `Invalid ${widget.player_id_label || 'Player ID'}`);
  let verified = false;
  const secret = req.security.identity_secret;
  if (secret && req.body.player_hash) {
    const expected = crypto.createHmac('sha256', secret).update(playerId).digest('hex');
    const got = String(req.body.player_hash);
    verified = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!verified) fail(401, 'Identity verification failed');
  }
  const name = str(req.body.name, 150);
  const email = str(req.body.email, 255);
  const customer = await one(`
    INSERT INTO customers(player_id, name, email) VALUES ($1,$2,$3)
    ON CONFLICT (player_id) DO UPDATE SET last_seen_at=NOW(),
      name=COALESCE(EXCLUDED.name, customers.name), email=COALESCE(EXCLUDED.email, customers.email)
    RETURNING *`, [playerId, name, email]);
  if (customer.is_blocked) fail(403, 'You cannot start a chat at the moment.');
  const token = crypto.randomBytes(32).toString('base64url');
  const s = await one(`INSERT INTO customer_sessions(customer_id, token_hash, verified, ip, user_agent, expires_at)
                       VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' days')::interval) RETURNING *`,
    [customer.id, sha256(token), verified, ip(req), (req.get('user-agent') || '').slice(0, 300), config.CUSTOMER_SESSION_DAYS]);
  // restore previous unresolved conversation (only when verified — Player ID alone is not proof of ownership)
  let active = null;
  if (verified) {
    active = await one(`SELECT c.*, COALESCE(u.display_name,u.name) AS agent_name FROM conversations c LEFT JOIN users u ON u.id=c.assigned_agent_id
                        WHERE c.customer_id=$1 AND c.status IN ('open','pending') ORDER BY c.last_message_at DESC LIMIT 1`, [customer.id]);
  }
  res.json({
    token, verified, expires_at: s.expires_at,
    customer: { player_id: customer.player_id, name: customer.name, email: customer.email },
    active_conversation: active ? customerConvView(active) : null,
  });
}));
P.get('/sessions/me', requireCustomer, ah(async (req, res) => {
  const s = req.session;
  const active = await one(`SELECT c.*, COALESCE(u.display_name,u.name) AS agent_name FROM conversations c LEFT JOIN users u ON u.id=c.assigned_agent_id
                            WHERE ${convAccessSql()} AND c.status IN ('open','pending') ORDER BY c.last_message_at DESC LIMIT 1`, convAccessParams(s));
  q(`UPDATE customers SET last_seen_at=NOW() WHERE id=$1`, [s.customer_id]).catch(() => {});
  res.json({ customer: { player_id: s.player_id, name: s.name, email: s.email }, verified: s.verified, active_conversation: active ? customerConvView(active) : null });
}));
P.post('/sessions/logout', requireCustomer, ah(async (req, res) => {
  await q(`UPDATE customer_sessions SET revoked_at=NOW() WHERE id=$1`, [req.session.id]);
  res.json({ ok: true });
}));

P.get('/conversations', requireCustomer, ah(async (req, res) => {
  const items = await many(`SELECT c.*, COALESCE(u.display_name,u.name) AS agent_name FROM conversations c LEFT JOIN users u ON u.id=c.assigned_agent_id
                            WHERE ${convAccessSql()} ORDER BY c.last_message_at DESC LIMIT 50`, convAccessParams(req.session));
  res.json({ items: items.map((c) => ({ ...customerConvView(c), last_message_preview: c.last_message_preview })) });
}));

async function startConversation(s, { content, clientId, attachmentId, subject, replyToId }) {
  // reuse an existing open conversation of this session instead of creating duplicates
  const existing = await one(`SELECT c.id FROM conversations c WHERE ${convAccessSql()} AND status IN ('open','pending') ORDER BY last_message_at DESC LIMIT 1`, convAccessParams(s));
  let convId; let isNew = false;
  if (existing) convId = existing.id;
  else {
    const c = await one(`INSERT INTO conversations(customer_id, session_id, subject) VALUES ($1,$2,$3) RETURNING id`, [s.customer_id, s.id, subject || null]);
    convId = c.id; isNew = true;
    await logEvent(convId, null, 'created', { player_id: s.player_id });
  }
  let message = null;
  if (content || attachmentId) message = (await createMessage({ convId, senderType: 'customer', senderId: s.customer_id, content, clientId, attachmentId, replyToId })).message;
  if (isNew) {
    const online = await supportIsOnline();
    if (!online) {
      const widget = await getSetting('widget');
      await createMessage({ convId, senderType: 'system', type: 'system', content: widget.offline_message });
    }
    const conv = await convSummary(convId);
    io.to(inboxTargets(conv)).emit('inbox:conversation:new', conv);
    const general = await getSetting('general');
    if (general.auto_assign) {
      const agent = await pickAgent();
      if (agent) await assignConversation(convId, agent.id, null, 'auto');
    }
  }
  return { conversation: customerConvView(await convSummary(convId)), message, is_new: isNew };
}

// Customer sends a message: handles reopen-vs-new for resolved chats
async function customerSend(s, convId, { content, clientId, attachmentId, replyToId }) {
  if (!rateLimit(`cmsg:${s.customer_id}`, config.RATE_LIMITS.customerMsgPerMinute)) fail(429, 'You are sending messages too fast');
  const c = await getCustomerConv(s, convId);
  if (c.status === 'resolved' || c.status === 'closed') {
    const general = await getSetting('general');
    const hours = Number(general.reopen_resolved_within_hours) || 0;
    const recent = c.status === 'resolved' && c.resolved_at && (Date.now() - new Date(c.resolved_at).getTime()) < hours * 3600000;
    if (!recent) {
      if (attachmentId) fail(400, 'Please send the attachment again in the new chat');
      return startConversation(s, { content, clientId });
    }
    await setStatus(c.id, 'open');
    await logEvent(c.id, null, 'reopened_by_customer');
    if (!c.assigned_agent_id) { const a = await pickAgent(); if (a) await assignConversation(c.id, a.id, null, 'auto'); }
    else {
      const a = await one(`SELECT is_active FROM users WHERE id=$1`, [c.assigned_agent_id]);
      if (!a || !a.is_active) await assignConversation(c.id, null, null, 'agent_unavailable');
    }
  }
  const r = await createMessage({ convId: c.id, senderType: 'customer', senderId: s.customer_id, content, clientId, attachmentId, replyToId });
  if (c.status === 'pending') await setStatus(c.id, 'open');
  return { conversation: customerConvView(await convSummary(c.id)), message: forCustomer(r.message), is_new: false };
}

P.post('/conversations', requireCustomer, ah(async (req, res) => {
  const content = str(req.body.content, 5000);
  res.json(await startConversation(req.session, { content, clientId: str(req.body.client_message_id, 100), subject: str(req.body.subject, 255) }));
}));
P.get('/conversations/:id', requireCustomer, ah(async (req, res) => {
  res.json({ conversation: customerConvView(await getCustomerConv(req.session, req.params.id)) });
}));
P.get('/conversations/:id/messages', requireCustomer, ah(async (req, res) => {
  const c = await getCustomerConv(req.session, req.params.id);
  const msgs = await loadMessages('m.conversation_id=$1', [c.id], false);
  res.json({ conversation: customerConvView(c), items: msgs.map(forCustomer) });
}));
P.post('/conversations/:id/messages', requireCustomer, ah(async (req, res) => {
  const content = str(req.body.content, 5000);
  const attachmentId = isUuid(req.body.attachment_id) ? req.body.attachment_id : null;
  if (!content && !attachmentId) fail(400, 'Message is empty');
  res.json(await customerSend(req.session, req.params.id, { content, clientId: str(req.body.client_message_id, 100), attachmentId, replyToId: req.body.reply_to_id }));
}));
P.post('/conversations/:id/rating', requireCustomer, ah(async (req, res) => {
  const c = await getCustomerConv(req.session, req.params.id);
  const rating = int(req.body.rating, 0, 0, 5);
  if (rating < 1) fail(400, 'Rating must be 1–5');
  await q(`UPDATE conversations SET rating=$2, rating_comment=$3 WHERE id=$1`, [c.id, rating, str(req.body.comment, 1000)]);
  await logEvent(c.id, null, 'rated', { rating });
  const conv = await convSummary(c.id);
  io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
  res.json({ ok: true });
}));
P.post('/uploads', requireCustomer, ah(async (req, res, next) => {
  const widget = await getSetting('widget');
  if (!widget.enable_attachments) fail(403, 'Attachments are disabled');
  if (!rateLimit(`cup:${req.session.customer_id}`, 10)) fail(429, 'Too many uploads');
  next();
}), upload.single('file'), ah(async (req, res) => {
  const c = await getCustomerConv(req.session, req.body.conversation_id);
  if (c.status === 'closed') fail(400, 'This conversation is closed');
  res.json(await saveUpload(req, c.id, 'customer', req.session.customer_id));
}));

app.use('/api/public', P);

// Signed, expiring file downloads (works for both agents and customers)
app.get('/files/:id', ah(async (req, res) => {
  const { e, s } = req.query;
  if (!isUuid(req.params.id) || !e || !s || Date.now() > Number(e)) fail(403, 'Link expired');
  const expected = hmac(`${req.params.id}.${e}`);
  if (String(s).length !== expected.length || !crypto.timingSafeEqual(Buffer.from(String(s)), Buffer.from(expected))) fail(403, 'Invalid link');
  const a = await one(`SELECT * FROM message_attachments WHERE id=$1`, [req.params.id]);
  if (!a) fail(404, 'Not found');
  const wantThumb = req.query.t === '1' && a.thumb_key;
  const file = path.join(config.UPLOAD_DIR, path.basename(wantThumb ? a.thumb_key : a.storage_key));
  if (!fs.existsSync(file)) fail(404, 'File missing');
  const mime = wantThumb ? 'image/webp' : a.mime_type;
  const inline = mime.startsWith('image/') || mime.startsWith('audio/') || mime === 'application/pdf';
  // sendFile handles Range requests (needed for seeking in voice messages, esp. Safari/iOS)
  res.sendFile(file, {
    headers: {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.file_name.replace(/["\r\n]/g, '')}"`,
    },
  });
}));

// ------------------------------------------------------------
// Static: admin panel, widget, demo page
// ------------------------------------------------------------
const PUB = path.join(__dirname, 'public');
app.get('/', (req, res) => res.redirect('/admin/'));
app.use('/admin', (req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
}, express.static(path.join(PUB, 'admin')));
app.get('/widget.js', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(PUB, 'widget.js'));
});
app.get('/demo', (req, res) => res.sendFile(path.join(PUB, 'demo.html')));
app.get('/health', ah(async (req, res) => { await q('SELECT 1'); res.json({ ok: true }); }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${config.MAX_UPLOAD_MB} MB)` : err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, code: err.code });
});

// ------------------------------------------------------------
// Socket.IO
// ------------------------------------------------------------
const ipSockets = new Map();
const offlineTimers = new Map();
let lastSupportOnline = null;

async function broadcastSupportStatus() {
  const online = await supportIsOnline();
  if (online !== lastSupportOnline) {
    lastSupportOnline = online;
    io.to('customers').emit(online ? 'chat:agent:online' : 'chat:agent:offline', { online });
  }
}
setInterval(() => broadcastSupportStatus().catch(() => {}), 60000).unref(); // business hours edges

async function updatePresence(userId, presence) {
  const u = await one(`UPDATE users SET presence=$2, last_seen_at=NOW() WHERE id=$1 RETURNING id, presence`, [userId, presence]);
  if (!u) return;
  io.to('agents').emit('inbox:agent:presence', { agent_id: userId, presence });
  await broadcastSupportStatus();
  if (presence === 'online') autoAssignWaiting();
}

io.use(async (socket, next) => {
  try {
    const addr = socket.handshake.headers['x-forwarded-for'] && config.TRUST_PROXY
      ? String(socket.handshake.headers['x-forwarded-for']).split(',')[0].trim() : socket.handshake.address;
    const n = (ipSockets.get(addr) || 0) + 1;
    if (n > config.RATE_LIMITS.socketsPerIp) return next(new Error('too_many_connections'));
    socket.data.ip = addr;
    const auth = socket.handshake.auth || {};
    if (auth.type === 'customer') {
      const security = await getSetting('security');
      if (!originAllowed(socket.handshake.headers.origin, security)) return next(new Error('origin_not_allowed'));
      const s = await sessionFromToken(auth.token);
      if (!s) return next(new Error('session_expired'));
      socket.data.kind = 'customer';
      socket.data.session = s;
    } else {
      const u = auth.token ? await userFromToken(auth.token) : await userFromCookieHeader(socket.handshake.headers.cookie);
      if (!u) return next(new Error('unauthorized'));
      socket.data.kind = 'agent';
      socket.data.user = u;
      socket.data.token = auth.token || null;
      // mobile app sends the availability the agent picked, so reconnects restore it
      socket.data.presence = ['online', 'away', 'busy', 'offline'].includes(auth.presence) ? auth.presence : null;
    }
    ipSockets.set(addr, n);
    next();
  } catch (e) { next(new Error('server_error')); }
});

// wrap socket handlers: errors are returned via ack instead of crashing
const sh = (fn) => async (payload, ack) => {
  const cb = typeof ack === 'function' ? ack : () => {};
  try { cb({ ok: true, ...(await fn(payload || {})) }); } catch (e) {
    if (!(e instanceof HttpError)) console.error('socket error', e);
    cb({ ok: false, error: e instanceof HttpError ? e.message : 'Server error', code: e.code });
  }
};

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    const n = (ipSockets.get(socket.data.ip) || 1) - 1;
    if (n <= 0) ipSockets.delete(socket.data.ip); else ipSockets.set(socket.data.ip, n);
  });
  if (socket.data.kind === 'customer') return customerSocket(socket);
  return agentSocket(socket);
});

function customerSocket(socket) {
  const s = socket.data.session;
  socket.join(['customers', `customer:${s.customer_id}`, `session:${s.id}`]);
  const prev = customerOnline.get(s.customer_id) || 0;
  customerOnline.set(s.customer_id, prev + 1);
  q(`UPDATE customers SET last_seen_at=NOW() WHERE id=$1`, [s.customer_id]).catch(() => {});

  // check session is still valid on each event (revocations take effect immediately)
  const fresh = async () => { const x = await sessionFromToken(socket.handshake.auth.token); if (!x) { socket.disconnect(true); fail(401, 'Session expired', 'session_expired'); } return x; };

  socket.on('customer:conversation:join', sh(async ({ conversation_id }) => {
    const ss = await fresh();
    const c = await getCustomerConv(ss, conversation_id);
    socket.join(`cconv:${c.id}`);
    // mark agent messages as delivered
    const r = await q(`UPDATE messages SET delivered_at=NOW() WHERE conversation_id=$1 AND sender_type<>'customer' AND delivered_at IS NULL RETURNING id`, [c.id]);
    if (r.rowCount) io.to(`aconv:${c.id}`).emit('inbox:message:delivered', { conversation_id: c.id, message_ids: r.rows.map((x) => x.id) });
    const conv = await convSummary(c.id);
    io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv);
    return { conversation: customerConvView(conv), online: await supportIsOnline() };
  }));
  socket.on('customer:conversation:leave', sh(async ({ conversation_id }) => { socket.leave(`cconv:${conversation_id}`); return {}; }));

  socket.on('customer:message:send', sh(async ({ conversation_id, content, client_message_id, attachment_id, reply_to_id }) => {
    const ss = await fresh();
    const text = str(content, 5000);
    const att = isUuid(attachment_id) ? attachment_id : null;
    if (!text && !att) fail(400, 'Message is empty');
    const r = conversation_id
      ? await customerSend(ss, conversation_id, { content: text, clientId: str(client_message_id, 100), attachmentId: att, replyToId: reply_to_id })
      : await startConversation(ss, { content: text, clientId: str(client_message_id, 100) });
    socket.join(`cconv:${r.conversation.id}`);
    return r;
  }));

  socket.on('customer:typing:start', async ({ conversation_id, preview } = {}) => {
    if (!isUuid(conversation_id) || !socket.rooms.has(`cconv:${conversation_id}`)) return;
    const conv = await convSummary(conversation_id).catch(() => null);
    if (!conv) return;
    io.to([...inboxTargets(conv), `aconv:${conversation_id}`]).emit('inbox:customer:typing', { conversation_id, typing: true, preview: typeof preview === 'string' ? preview.slice(0, 200) : null });
  });
  socket.on('customer:typing:stop', async ({ conversation_id } = {}) => {
    if (!isUuid(conversation_id) || !socket.rooms.has(`cconv:${conversation_id}`)) return;
    const conv = await convSummary(conversation_id).catch(() => null);
    if (!conv) return;
    io.to([...inboxTargets(conv), `aconv:${conversation_id}`]).emit('inbox:customer:typing', { conversation_id, typing: false });
  });
  socket.on('customer:message:read', sh(async ({ conversation_id }) => {
    const ss = await fresh();
    const c = await getCustomerConv(ss, conversation_id);
    const r = await q(`UPDATE messages SET read_at=NOW(), delivered_at=COALESCE(delivered_at,NOW())
                       WHERE conversation_id=$1 AND sender_type='agent' AND read_at IS NULL RETURNING id`, [c.id]);
    if (r.rowCount) io.to(`aconv:${c.id}`).emit('inbox:message:read', { conversation_id: c.id, message_ids: r.rows.map((x) => x.id) });
    return {};
  }));

  socket.on('disconnect', async () => {
    const n = (customerOnline.get(s.customer_id) || 1) - 1;
    if (n <= 0) customerOnline.delete(s.customer_id); else customerOnline.set(s.customer_id, n);
    if (n <= 0) {
      const convs = await many(`SELECT id FROM conversations WHERE customer_id=$1 AND status IN ('open','pending')`, [s.customer_id]).catch(() => []);
      for (const c of convs) { const conv = await convSummary(c.id); if (conv) io.to(inboxTargets(conv)).emit('inbox:conversation:updated', conv); }
    }
  });
}

function agentSocket(socket) {
  const u = socket.data.user;
  const rank = ROLE_RANK[u.role];
  socket.join(['agents', `agent:${u.id}`, rank >= 2 ? 'inbox:all' : 'inbox:unassigned']);
  agentSockets.set(u.id, (agentSockets.get(u.id) || 0) + 1);
  if (offlineTimers.has(u.id)) { clearTimeout(offlineTimers.get(u.id)); offlineTimers.delete(u.id); }
  if (socket.data.presence && socket.data.presence !== u.presence) updatePresence(u.id, socket.data.presence).catch(() => {});
  else if (!socket.data.presence && u.presence === 'offline') updatePresence(u.id, 'online').catch(() => {});
  else q(`UPDATE users SET last_seen_at=NOW() WHERE id=$1`, [u.id]).catch(() => {});

  const freshUser = async () => {
    const x = socket.data.token ? await userFromToken(socket.data.token) : await userFromCookieHeader(socket.handshake.headers.cookie);
    if (!x) { socket.emit('auth:revoked'); socket.disconnect(true); fail(401, 'Not logged in'); }
    return x;
  };

  socket.on('agent:presence:update', sh(async ({ presence }) => {
    await freshUser();
    oneOf(presence, ['online', 'away', 'busy', 'offline'], 'presence');
    await updatePresence(u.id, presence);
    return { presence };
  }));
  socket.on('agent:conversation:join', sh(async ({ conversation_id }) => {
    const user = await freshUser();
    const c = await getConvForUser(user, conversation_id);
    for (const r of socket.rooms) if (r.startsWith('aconv:') && r !== `aconv:${c.id}`) socket.leave(r);
    socket.join(`aconv:${c.id}`);
    return { conversation: c };
  }));
  socket.on('agent:conversation:leave', sh(async ({ conversation_id }) => { socket.leave(`aconv:${conversation_id}`); return {}; }));
  socket.on('agent:message:send', sh(async ({ conversation_id, content, client_message_id, attachment_id, internal, reply_to_id }) => {
    const user = await freshUser();
    const c = await getConvForUser(user, conversation_id);
    const text = str(content, 5000);
    const att = isUuid(attachment_id) ? attachment_id : null;
    if (!text && !att) fail(400, 'Message is empty');
    if (internal && !text) fail(400, 'Note is empty');
    return agentSend(user, c, { content: text, attachmentId: att, clientId: str(client_message_id, 100), internal: !!internal, replyToId: reply_to_id });
  }));
  const typing = (on) => async ({ conversation_id } = {}) => {
    if (!isUuid(conversation_id) || !socket.rooms.has(`aconv:${conversation_id}`)) return;
    io.to(`cconv:${conversation_id}`).emit('chat:agent:typing', { conversation_id, typing: on, name: u.display_name || u.name });
    socket.to(`aconv:${conversation_id}`).emit('inbox:agent:typing', { conversation_id, typing: on, agent_id: u.id, name: u.display_name || u.name });
  };
  socket.on('agent:typing:start', typing(true));
  socket.on('agent:typing:stop', typing(false));
  socket.on('agent:conversation:assign', sh(async ({ conversation_id, agent_id }) => {
    const user = await freshUser();
    const c = await getConvForUser(user, conversation_id);
    if (rank < 2 && agent_id !== user.id) fail(403, 'Agents can only assign chats to themselves');
    return { conversation: await assignConversation(c.id, agent_id || null, user) };
  }));
  socket.on('agent:conversation:status', sh(async ({ conversation_id, status }) => {
    const user = await freshUser();
    const c = await getConvForUser(user, conversation_id);
    return { conversation: await setStatus(c.id, oneOf(status, ['open', 'pending', 'resolved', 'closed'], 'status'), user) };
  }));
  socket.on('agent:message:read', sh(async ({ conversation_id }) => {
    const user = await freshUser();
    const c = await getConvForUser(user, conversation_id);
    await markReadByAgent(c.id);
    return {};
  }));

  socket.on('disconnect', () => {
    const n = (agentSockets.get(u.id) || 1) - 1;
    if (n > 0) { agentSockets.set(u.id, n); return; }
    agentSockets.delete(u.id);
    // grace period so a page refresh doesn't flip the agent offline
    offlineTimers.set(u.id, setTimeout(() => {
      offlineTimers.delete(u.id);
      if (!agentSockets.get(u.id)) updatePresence(u.id, 'offline').catch(() => {});
    }, 20000));
  });
}

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
(async () => {
  try {
    if (/change-me/.test(config.APP_SECRET) || String(config.APP_SECRET).length < 32) {
      console.warn('⚠️  APP_SECRET is the default or too short — set a long random one in config.local.js before going live!');
    }
    await db.migrate();
    // nobody is connected at boot — reset stale presence
    await q(`UPDATE users SET presence='offline' WHERE presence<>'offline'`);
    lastSupportOnline = await supportIsOnline();
    server.listen(config.PORT, () => {
      console.log(`Live Support Desk running on ${config.PUBLIC_URL}`);
      console.log(`  Admin panel: ${config.PUBLIC_URL}/admin/`);
      console.log(`  Widget demo: ${config.PUBLIC_URL}/demo`);
    });
  } catch (e) {
    console.error('Failed to start:', e.message);
    process.exit(1);
  }
})();
