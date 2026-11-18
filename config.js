// ============================================================
//  Live Support Desk — configuration (edit this file directly)
//  No .env / no .yml. Change the values below and restart.
// ============================================================
module.exports = {
  // HTTP port the server listens on
  PORT: 4000,

  // PostgreSQL connection string. Tables are created automatically on first start.
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/livesupport',

  // Long random string — used to sign admin login tokens and file URLs.
  // CHANGE THIS before going live (40+ random characters).
  APP_SECRET: 'change-me-to-a-very-long-random-secret-string-1234567890',

  // Public URL of this server (used in the embed snippet shown in the admin panel)
  PUBLIC_URL: 'http://localhost:4000',

  // true when served over HTTPS (production). Makes cookies Secure.
  COOKIE_SECURE: false,

  // Set true when running behind Nginx / Coolify / Cloudflare so real client IPs are used
  TRUST_PROXY: true,

  // Admin login session length (hours)
  ADMIN_SESSION_HOURS: 12,

  // Android agent app login length (days). Changing password / "Log out everywhere" ends it early.
  MOBILE_SESSION_DAYS: 60,

  // Customer (widget) session length (days)
  CUSTOMER_SESSION_DAYS: 30,

  // File uploads (stored on local disk)
  UPLOAD_DIR: __dirname + '/uploads',
  MAX_UPLOAD_MB: 10,
  ALLOWED_MIME: [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  // Signed download link lifetime (minutes)
  FILE_URL_MINUTES: 60,

  // First owner account — created automatically only when the users table is empty.
  // Log in with this, then change the password from "My Profile".
  DEFAULT_OWNER: {
    name: 'Owner',
    email: 'admin@example.com',
    password: 'Admin@12345',
  },

  // Rate limits
  RATE_LIMITS: {
    identifyPerMinute: 10,     // Player ID submissions per IP per minute (brute-force guard)
    customerMsgPerMinute: 30,  // customer messages per minute
    loginPerMinute: 10,        // admin login attempts per IP per minute
    socketsPerIp: 30,          // max concurrent socket connections per IP
  },
};
