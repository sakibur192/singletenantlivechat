# Live Support Desk

A single-tenant live chat support system in **one Node.js project**:

- **Embeddable widget** with an FAQ / knowledge base, Player ID check, real-time chat, file uploads and ratings
- **Admin panel** with a WhatsApp-style inbox, agents and roles, canned replies, internal notes, tags, customers, widget design, business hours, analytics and audit logs
- **REST API + Socket.IO** on one port, with PostgreSQL storage written in plain SQL (no ORM)

There are no `.env` or `.yml` files and no separate frontend build. All configuration is in **`config.js`**.

---

## 1. Requirements
- Node.js 18 or newer
- PostgreSQL 13 or newer (16 recommended)

## 2. Setup
```bash
npm install
# create an empty database
psql -U postgres -c "CREATE DATABASE livesupport;"
```
Edit **`config.js`**:

| Key | What to set |
|---|---|
| `DATABASE_URL` | your PostgreSQL connection string |
| `APP_SECRET` | a long random string (**required** for production) |
| `PUBLIC_URL` | the public URL of this server, e.g. `https://support.yourdomain.com` |
| `COOKIE_SECURE` | `true` when the site is served over HTTPS |
| `DEFAULT_OWNER` | the first login (it is created only when there are no users) |

```bash
npm start
```
On first start, every table is created automatically, along with the owner account and a few sample FAQs.

- Admin panel → `http://localhost:4000/admin/` (default login `admin@example.com` / `Admin@12345`; **change the password** under *My profile*)
- Widget demo page → `http://localhost:4000/demo`

## 3. Put the widget on your website
Add this before `</body>`:
```html
<script src="https://support.yourdomain.com/widget.js" async></script>
```
Optional attributes:
```html
<script src="https://support.yourdomain.com/widget.js"
  data-player-id="123456"        
  data-player-hash="HMAC_HEX"   
  data-name="Rahim" data-email="rahim@mail.com"
  data-open="true" async></script>
```
- `data-player-id`: fills in the Player ID, so the customer skips the form.
- `data-player-hash`: verified identity (see the Security section). Only needed together with `data-player-id`.
- `data-open="true"`: opens the widget when the page loads.

JavaScript API: `LiveSupport.open()`, `LiveSupport.close()`, `LiveSupport.toggle()`, `LiveSupport.identify({player_id, hash, name, email})`, `LiveSupport.logout()`.

**Important:** In *Settings → Security*, add your website domain(s) to **Allowed website domains**. While that list is empty, any site can load the widget.

## 4. Deploy (Coolify / VPS)
- Coolify: create a new resource → Public/Private Git repo → build pack **Nixpacks** (it detects Node automatically). The start command is `npm start` and the port is `4000`.
- Add a **persistent volume** mounted at `/app/uploads` so attachments survive redeploys.
- Behind Nginx, enable WebSocket upgrade:
  ```nginx
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```
- Run with PM2 on a plain VPS: `pm2 start server.js --name live-support`

---

## Project structure
```
live-support-desk/
├── config.js            ← all settings (edit this)
├── server.js            ← REST API, Socket.IO, auth, assignment, uploads, static files
├── src/db.js            ← PostgreSQL pool, schema auto-creation, default settings, password hashing
├── public/
│   ├── admin/           ← admin panel (index.html, admin.css, admin.js), served at /admin
│   ├── widget.js        ← embeddable widget (Shadow DOM, no dependencies)
│   └── demo.html        ← test page at /demo
└── uploads/             ← stored attachments (persist this folder)
```

## Roles
| Role | Can do |
|---|---|
| owner | everything, including creating and editing admins |
| admin | team, settings, widget design, security, audit logs, plus everything a supervisor can do |
| supervisor | see and assign all chats, knowledge base, canned replies, tags, analytics, block customers |
| agent | unassigned chats and chats assigned to them; reply, add notes, claim, transfer their own chats |

## How chats flow
1. A visitor opens the widget and sees the welcome message, the FAQ categories and search, then **Start live chat**.
2. They enter their Player ID. The server finds or creates the customer, issues a random session token (only its SHA-256 hash is stored), and the widget keeps the token in `localStorage`. Refreshing the page keeps the chat.
3. The first message creates a conversation. It is **auto-assigned to the online agent with the fewest active chats** who is under their *max concurrent chats* limit. If no agent is available, the chat waits in **Unassigned**. Waiting chats are assigned automatically as soon as an agent goes Online or frees up a slot.
4. If no agent is online, or it is outside business hours, the widget shows the offline message. The customer can still leave a message.
5. When an agent marks the chat **Resolved**, the customer can rate it. If the customer writes again within *N hours* (Settings → General), the same chat reopens. After that, a new chat is created.

## Security notes
- Admin login uses an HttpOnly, SameSite=Lax cookie signed with `APP_SECRET`. Every admin request that changes data must send the `X-Requested-With: lsd` header (CSRF protection). Changing your password or using *Log out everywhere* invalidates every existing session.
- Passwords are hashed with scrypt, which is built into Node.js.
- Rate limits cover login, Player ID submission (brute-force protection), customer messages, uploads and sockets per IP. You can change them in `config.js`.
- **Player ID is an identifier, not a password.** A new browser that enters someone's Player ID can start a *new* chat, but it **cannot read older chats** from other devices.
- **Verified identity (optional):** set an *Identity verification secret* in Settings → Security. Your website's server signs the Player ID:
  ```js
  const hash = require('crypto').createHmac('sha256', SECRET).update(playerId).digest('hex');
  ```
  Then pass `data-player-id` and `data-player-hash` to the widget. Verified customers get their full history on any device, and their open chat is restored.
- Uploads are checked against a MIME allow-list and a size limit, and images and PDFs get a magic-byte check. Files are served only through signed links that expire, with `nosniff` and a sandbox CSP.
- All messages and FAQ text are escaped before rendering (XSS protection). Internal notes are never sent to customer sockets or the customer API.
- Blocking a customer ends their sessions immediately and disconnects their sockets.

## REST API overview
Every admin endpoint is under `/api/admin` and needs the cookie and the `X-Requested-With: lsd` header. Widget endpoints are under `/api/public` and use `Authorization: Bearer <customer token>` after `/sessions/identify`.

**Admin:** `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth/change-password`, `PATCH /auth/profile`, `GET /dashboard`,
`GET /conversations?view=inbox|unassigned|mine|pending|resolved|all&search=&priority=&tag_id=&cursor=`, `GET /conversations/:id`, `GET /conversations/:id/messages`,
`POST /conversations/:id/reply`, `POST /conversations/:id/notes`, `PATCH /conversations/:id/status|priority|assign`, `POST /conversations/:id/transfer`,
`POST /conversations/:id/tags`, `DELETE /conversations/:id/tags/:tagId`, `POST /conversations/:id/read`, `GET|POST|DELETE /tags`,
`GET /customers`, `GET|PATCH /customers/:id`, `POST /customers/:id/revoke-sessions`,
`GET|POST /faq/categories`, `PATCH|DELETE /faq/categories/:id`, `GET|POST /faq/questions`, `PATCH|DELETE /faq/questions/:id`, `PUT /faq/reorder`, `PUT /faq/questions/:id/related`, `GET /faq/analytics`,
`GET|POST /agents`, `PATCH|DELETE /agents/:id`, `PUT /agents/me/presence`, `GET /agents/performance`,
`GET|POST /canned-responses`, `PATCH|DELETE /canned-responses/:id`, `GET /settings`, `PUT /settings/:group` (group = `widget` | `general` | `business_hours` | `security`),
`GET /analytics?days=7`, `GET /audit-logs`, `POST /uploads`.

**Public (widget):** `GET /config`, `GET /faqs`, `GET /faqs/search?q=`, `GET /faqs/:id`, `POST /faqs/:id/feedback`, `POST /faq-events`,
`POST /sessions/identify`, `GET /sessions/me`, `POST /sessions/logout`, `GET|POST /conversations`, `GET /conversations/:id`,
`GET|POST /conversations/:id/messages`, `POST /conversations/:id/rating`, `POST /uploads`.

**Files:** `GET /files/:id?e=&s=` (a signed, expiring link).

## Socket.IO events
- **Customer → server:** `customer:conversation:join`, `customer:message:send`, `customer:typing:start`, `customer:typing:stop`, `customer:message:read`, `customer:conversation:leave`
- **Agent → server:** `agent:presence:update`, `agent:conversation:join`, `agent:conversation:leave`, `agent:message:send` (`internal: true` for notes), `agent:typing:start`, `agent:typing:stop`, `agent:conversation:assign`, `agent:conversation:status`, `agent:message:read`
- **Server → customer:** `chat:message:new`, `chat:agent:typing`, `chat:message:read`, `chat:conversation:updated`, `chat:agent:online`, `chat:agent:offline`, `chat:session:revoked`
- **Server → agents:** `inbox:conversation:new`, `inbox:message:new`, `inbox:conversation:updated`, `inbox:customer:typing`, `inbox:agent:typing`, `inbox:message:read`, `inbox:message:delivered`, `inbox:agent:presence`

A message is acknowledged only after it is saved in PostgreSQL. Sending the same `client_message_id` twice never creates a duplicate, and the widget reloads any missed messages after it reconnects.

## Android agent app
The `SupportDeskAgent` Android project connects to this server.
- **Mobile login:** `POST /api/admin/auth/login` with `{"email","password","mobile":true}` returns a bearer `token`, valid for `MOBILE_SESSION_DAYS` in `config.js`. Changing your password or using *Log out everywhere* revokes it.
- **Bearer auth:** every `/api/admin` endpoint accepts `Authorization: Bearer <token>`. These requests don't need the CSRF header.
- **Socket auth:** `io(url, { auth: { type: 'agent', token, presence } })`. On each reconnect the app sends the availability the agent picked, so it is restored.
- **Missed-message sync:** `GET /api/admin/notifications/sync?since=<server_time>` returns unread customer messages created after `since` in chats this user can see. The first call, with no `since`, returns only `server_time`. The app calls it after every reconnect and every 15 minutes, so no message goes un-notified.

## Scaling note
This runs as a **single process**, which comfortably handles a single business. To run several instances later, add the `@socket.io/redis-adapter` package and move the in-memory rate limits to Redis.
#   s i n g l e t e n a n t l i v e c h a t  
 