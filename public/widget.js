/* Live Support Desk — embeddable chat widget
 * <script src="https://your-server/widget.js" async></script>
 * Optional: data-player-id, data-player-hash, data-name, data-email, data-open="true"
 * JS API: LiveSupport.open(), .close(), .toggle(), .identify({player_id, hash, name, email}), .logout()
 */
(function () {
  'use strict';
  if (window.LiveSupport && window.LiveSupport.__loaded) return;
  var script = document.currentScript || (function () { var s = document.querySelectorAll('script[src*="widget.js"]'); return s[s.length - 1]; })();
  var BASE = new URL(script.src, location.href).origin;
  var DATA = script.dataset || {};
  var LS_KEY = 'lsd_session_' + BASE;

  var T = {
    en: { search: 'Search for answers…', faq: 'Frequently asked questions', live: 'Start live chat', liveSub: 'Talk to our support team', back: 'Back', helpful: 'Was this helpful?', yes: 'Yes', no: 'No', thanks: 'Thanks for your feedback!',
      related: 'Related questions', more: 'More questions', stillHelp: 'Still need help?', enterId: 'Please enter your {label} to continue.', cont: 'Continue', welcome: 'Welcome to Live Support!',
      type: 'Type a message…', online: 'We are online', offline: 'We are offline', noResult: 'No matching questions', resolved: 'This chat has been resolved.', rate: 'How was your experience?', rated: 'Thank you for rating us!',
      newChat: 'Start a new chat', typing: 'is typing…', failed: 'Not sent — tap to retry', attach: 'Attach file', sending: 'Sending…', error: 'Something went wrong. Please try again.', name: 'Your name (optional)', history: 'Your conversations', poweredBy: 'Live Support', you: 'You', agent: 'Support' },
    bn: { search: 'উত্তর খুঁজুন…', faq: 'সাধারণ প্রশ্নাবলি', live: 'লাইভ চ্যাট শুরু করুন', liveSub: 'আমাদের সাপোর্ট টিমের সাথে কথা বলুন', back: 'পেছনে', helpful: 'এটি কি সাহায্য করেছে?', yes: 'হ্যাঁ', no: 'না', thanks: 'মতামতের জন্য ধন্যবাদ!',
      related: 'সম্পর্কিত প্রশ্ন', more: 'আরও প্রশ্ন', stillHelp: 'আরও সাহায্য লাগবে?', enterId: 'চালিয়ে যেতে আপনার {label} দিন।', cont: 'চালিয়ে যান', welcome: 'লাইভ সাপোর্টে স্বাগতম!',
      type: 'মেসেজ লিখুন…', online: 'আমরা অনলাইনে আছি', offline: 'আমরা এখন অফলাইনে', noResult: 'কোনো প্রশ্ন পাওয়া যায়নি', resolved: 'চ্যাটটি সমাধান করা হয়েছে।', rate: 'আপনার অভিজ্ঞতা কেমন ছিল?', rated: 'রেটিং দেওয়ার জন্য ধন্যবাদ!',
      newChat: 'নতুন চ্যাট শুরু করুন', typing: 'লিখছেন…', failed: 'পাঠানো যায়নি — আবার চেষ্টা করুন', attach: 'ফাইল যুক্ত করুন', sending: 'পাঠানো হচ্ছে…', error: 'সমস্যা হয়েছে। আবার চেষ্টা করুন।', name: 'আপনার নাম (ঐচ্ছিক)', history: 'আপনার কথোপকথন', poweredBy: 'লাইভ সাপোর্ট', you: 'আপনি', agent: 'সাপোর্ট' },
  };

  var cfg = null, t = T.en, root, shadow, panel, launcher, badge;
  var state = { open: false, screen: 'home', session: null, conv: null, messages: [], socket: null, unread: 0, online: false, faqCache: null, attachment: null, rated: {} };
  var history = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>'); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2); }
  function $(s) { return shadow.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(shadow.querySelectorAll(s)); }

  function loadSession() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { state.session = s; try { s ? localStorage.setItem(LS_KEY, JSON.stringify(s)) : localStorage.removeItem(LS_KEY); } catch (e) {} }

  function api(method, path, body, isForm) {
    var headers = {};
    if (state.session) headers.Authorization = 'Bearer ' + state.session.token;
    var opts = { method: method, headers: headers };
    if (body !== undefined) { if (isForm) opts.body = body; else { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } }
    return fetch(BASE + '/api/public' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && d.code === 'session_expired') { saveSession(null); disconnect(); }
        if (!r.ok) { var e = new Error(d.error || t.error); e.status = r.status; e.code = d.code; throw e; }
        return d;
      });
    });
  }

  // ---------------------------------------------------------- styles
  function css(c) {
    var p = c.primary_color || '#16A34A', s2 = c.secondary_color || '#0F172A', side = c.position === 'left' ? 'left' : 'right';
    var w = Math.max(300, Math.min(600, Number(c.width) || 380)), h = Math.max(400, Math.min(900, Number(c.height) || 600));
    return ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}' +
      '.ls-launch{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;background:' + p + ';color:#fff;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .2s}' +
      '.ls-launch:hover{transform:scale(1.06)}.ls-launch svg{width:28px;height:28px;fill:#fff}' +
      '.ls-badge{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:10px;font-size:11px;font-weight:700;padding:1px 6px;border:2px solid #fff}' +
      '.ls-panel{position:fixed;bottom:92px;' + side + ':20px;width:' + w + 'px;height:' + h + 'px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;z-index:2147483647;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:all .2s;color:#0f172a;font-size:14px;line-height:1.45}' +
      '.ls-panel.open{opacity:1;transform:none;pointer-events:auto}' +
      '.no-launcher .ls-panel{bottom:20px;max-height:calc(100vh - 40px)}' +
      '@media(max-width:480px){.ls-panel{width:100vw;height:100%;max-height:100%;bottom:0;' + side + ':0;border-radius:0}}' +
      '.hd{background:linear-gradient(135deg,' + p + ',' + s2 + ');color:#fff;padding:16px 16px 18px;flex-shrink:0}' +
      '.hd-row{display:flex;align-items:center;gap:10px}.hd h2{margin:0;font-size:17px;font-weight:700}.hd p{margin:2px 0 0;font-size:12.5px;opacity:.9}' +
      '.hd img{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#fff}' +
      '.x,.bk{background:rgba(255,255,255,.18);border:0;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center}.x:hover,.bk:hover{background:rgba(255,255,255,.3)}' +
      '.sp{flex:1;min-width:0}.st{display:inline-flex;align-items:center;gap:5px;font-size:12px;opacity:.95}.st i{width:8px;height:8px;border-radius:50%;background:#cbd5e1;display:inline-block}.st i.on{background:#4ade80}' +
      '.bd{flex:1;overflow-y:auto;background:#f8fafc}' +
      '.wel{background:#fff;margin:12px;padding:14px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);white-space:pre-wrap}' +
      '.srch{margin:0 12px 8px;position:relative}.srch input{width:100%;padding:11px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;background:#fff}.srch input:focus{border-color:' + p + '}' +
      '.sec{margin:12px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}.sec h3{margin:0;padding:12px 14px 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}' +
      '.cat{padding:8px 14px 4px;font-weight:700;font-size:13px;color:' + p + '}' +
      '.q{display:flex;justify-content:space-between;gap:8px;padding:10px 14px;cursor:pointer;border-top:1px solid #f1f5f9;color:#0f172a;background:none;border-left:0;border-right:0;border-bottom:0;width:100%;text-align:left;font-size:14px}.q:hover{background:#f8fafc}.q span:last-child{color:#94a3b8}' +
      '.cta{display:flex;align-items:center;gap:12px;margin:12px;padding:14px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);cursor:pointer;border:2px solid transparent;width:calc(100% - 24px);text-align:left}.cta:hover{border-color:' + p + '}' +
      '.cta .ic{width:40px;height:40px;border-radius:50%;background:' + p + ';display:flex;align-items:center;justify-content:center;flex-shrink:0}.cta .ic svg{width:20px;height:20px;fill:#fff}.cta b{display:block;font-size:14px;color:#0f172a}.cta small{color:#64748b;font-size:12px}' +
      '.ans{margin:12px;background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.ans h3{margin:0 0 10px;font-size:16px}.ans .tx{white-space:pre-wrap;color:#334155}.ans .tx a{color:' + p + '}' +
      '.fb{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b}' +
      '.btn{border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;color:#0f172a}.btn:hover{border-color:' + p + '}' +
      '.btn.pri{background:' + p + ';border-color:' + p + ';color:#fff;padding:11px 16px;font-size:14px;font-weight:600;width:100%;border-radius:10px}.btn.pri:disabled{opacity:.6}' +
      '.idf{margin:20px 16px;background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.idf h3{margin:0 0 6px;font-size:16px}.idf p{margin:0 0 14px;color:#64748b}' +
      '.idf input{width:100%;padding:11px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:10px;outline:none}.idf input:focus{border-color:' + p + '}.err{color:#dc2626;font-size:13px;min-height:18px;margin-bottom:6px}' +
      '.msgs{padding:12px;display:flex;flex-direction:column;gap:6px;min-height:100%}' +
      '.m{max-width:80%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;font-size:14px}' +
      '.m.c{align-self:flex-end;background:' + p + ';color:#fff;border-bottom-right-radius:4px}.m.c a{color:#fff}' +
      '.m.a{align-self:flex-start;background:#fff;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}.m.a a{color:' + p + '}' +
      '.m.s{align-self:center;background:#e0f2fe;color:#075985;font-size:12px;text-align:center;max-width:90%;border-radius:10px}' +
      '.m .nm{font-size:11px;font-weight:700;color:' + p + ';margin-bottom:2px}.m .tm{font-size:10.5px;opacity:.7;text-align:right;margin-top:2px}' +
      '.m.fail{opacity:.6;cursor:pointer}.m img{max-width:100%;max-height:220px;border-radius:8px;display:block}.m .fl{display:flex;gap:6px;align-items:center;color:inherit;text-decoration:none;padding:4px 0}' +
      '.typ{padding:0 14px 6px;font-size:12px;color:#64748b;font-style:italic;min-height:20px;background:#f8fafc}' +
      '.cmp{border-top:1px solid #e2e8f0;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff;flex-shrink:0}' +
      '.cmp textarea{flex:1;border:1px solid #e2e8f0;border-radius:20px;padding:10px 14px;font-size:14px;resize:none;max-height:120px;min-height:42px;outline:none;line-height:1.4}.cmp textarea:focus{border-color:' + p + '}' +
      '.ib{width:40px;height:40px;border-radius:50%;border:0;background:transparent;cursor:pointer;font-size:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center}.ib:hover{background:#f1f5f9}' +
      '.ib.snd{background:' + p + '}.ib.snd svg{width:18px;height:18px;fill:#fff}' +
      '.chip{margin:0 10px 6px;font-size:12px;background:#f1f5f9;border-radius:8px;padding:4px 10px;display:inline-flex;gap:6px;align-items:center}.chip button{border:0;background:none;cursor:pointer}' +
      '.bnr{background:#fef3c7;color:#92400e;font-size:12.5px;padding:8px 14px;flex-shrink:0}' +
      '.rate{align-self:center;background:#fff;padding:12px 16px;border-radius:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06);margin:6px 0}.rate .stars{font-size:26px;cursor:pointer;margin-top:4px}.rate .stars span{color:#cbd5e1;transition:color .1s}.rate .stars span.on{color:#f59e0b}' +
      '.ft{text-align:center;font-size:11px;color:#94a3b8;padding:6px;background:#fff;flex-shrink:0}' +
      '.empty{padding:20px;text-align:center;color:#64748b;font-size:13px}' +
      '.hist{display:block;width:100%;border:0;border-top:1px solid #f1f5f9;background:none;padding:10px 14px;text-align:left;cursor:pointer;font-size:13px;color:#0f172a}.hist:hover{background:#f8fafc}.hist small{color:#64748b}';
  }
  var ICONS = {
    chat: '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.5 21l4.3-2.3c1 .3 2.1.4 3.2.4 5.5 0 10-3.6 10-8s-4.5-8.1-10-8.1z"/></svg>',
    help: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 17h-2v-2h2v2zm2.1-7.8l-.9.9c-.7.7-1.2 1.3-1.2 2.9h-2v-.5c0-1.1.5-2.1 1.2-2.8l1.2-1.3c.4-.4.6-.9.6-1.4a2 2 0 00-4 0H8a4 4 0 118 0c0 .9-.4 1.7-.9 2.2z"/></svg>',
    headset: '<svg viewBox="0 0 24 24"><path d="M12 1a9 9 0 00-9 9v7a3 3 0 003 3h3v-8H5v-2a7 7 0 0114 0v2h-4v8h4v1h-7v2h6a3 3 0 003-3V10a9 9 0 00-9-9z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  };

  // ---------------------------------------------------------- init
  function init() {
    api('GET', '/config').then(function (c) {
      cfg = c.widget; t = T[cfg.language] || T.en; state.online = c.online; state.company = c.company_name;
      state.session = loadSession();
      root = document.createElement('div');
      root.id = 'live-support-desk';
      document.body.appendChild(root);
      shadow = root.attachShadow ? root.attachShadow({ mode: 'open' }) : root;
      var style = document.createElement('style'); style.textContent = css(cfg); shadow.appendChild(style);
      var wrap = document.createElement('div'); if (!cfg.show_launcher) wrap.className = 'no-launcher'; shadow.appendChild(wrap);
      launcher = document.createElement('button');
      launcher.className = 'ls-launch'; launcher.setAttribute('aria-label', 'Open support chat');
      launcher.innerHTML = ICONS[cfg.launcher_icon] || ICONS.chat;
      badge = document.createElement('span'); badge.className = 'ls-badge'; badge.style.display = 'none'; launcher.appendChild(badge);
      launcher.onclick = toggle;
      if (cfg.show_launcher) wrap.appendChild(launcher);
      panel = document.createElement('div'); panel.className = 'ls-panel'; panel.setAttribute('role', 'dialog');
      wrap.appendChild(panel);

      // data-player-id: identify silently (switch identity if another player was stored)
      if (DATA.playerId && (!state.session || state.session.player_id !== DATA.playerId)) {
        identify({ player_id: DATA.playerId, hash: DATA.playerHash, name: DATA.name, email: DATA.email }, true);
      }
      if (state.session) checkSession();
      render();
      if (DATA.open === 'true' || /[?&]preview=1/.test(location.search)) open();
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });
    }).catch(function (e) { console.warn('[LiveSupport] widget disabled:', e.message); });
  }

  function checkSession() {
    return api('GET', '/sessions/me').then(function (r) {
      state.session.verified = r.verified;
      if (r.active_conversation) { state.conv = r.active_conversation; connect(); }
    }).catch(function () {});
  }

  function toggle() { state.open ? close() : open(); }
  function open() {
    state.open = true; panel.classList.add('open');
    launcher.innerHTML = ICONS.close; launcher.appendChild(badge);
    state.unread = 0; updateBadge();
    if (state.screen === 'chat') { scrollBottom(); markRead(); var ta = $('textarea'); ta && ta.focus(); }
  }
  function close() {
    state.open = false; panel.classList.remove('open');
    launcher.innerHTML = ICONS[cfg.launcher_icon] || ICONS.chat; launcher.appendChild(badge);
  }
  function updateBadge() { badge.textContent = state.unread; badge.style.display = state.unread && !state.open ? '' : 'none'; }
  function go(screen, arg) { if (state.screen !== screen) history.push([state.screen, state.arg]); state.screen = screen; state.arg = arg; render(); }
  function back() { var p = history.pop() || ['home']; state.screen = p[0]; state.arg = p[1]; render(); }

  function header(withBack, title, sub) {
    var logo = cfg.logo_url && /^https:\/\//.test(cfg.logo_url) ? '<img src="' + esc(cfg.logo_url) + '" alt="">' : '';
    return '<div class="hd"><div class="hd-row">' + (withBack ? '<button class="bk" data-back aria-label="' + t.back + '">‹</button>' : logo) +
      '<div class="sp"><h2>' + esc(title || cfg.title) + '</h2><p>' + (sub || '<span class="st"><i class="' + (state.online ? 'on' : '') + '"></i>' + (state.online ? t.online : t.offline) + '</span> · ' + esc(cfg.header_text)) + '</p></div>' +
      '<button class="x" data-close aria-label="Close">✕</button></div></div>';
  }
  function bindHeader() {
    var b = $('[data-back]'); if (b) b.onclick = back;
    $('[data-close]').onclick = close;
  }

  function render() {
    if (!panel) return;
    if (state.screen === 'home') renderHome();
    else if (state.screen === 'faq') renderFaq(state.arg);
    else if (state.screen === 'identify') renderIdentify();
    else if (state.screen === 'chat') renderChat();
    else if (state.screen === 'history') renderHistory();
  }

  // ---------------------------------------------------------- home + FAQ
  function liveCta() { return '<button class="cta" data-live><span class="ic">' + ICONS.chat + '</span><span><b>' + t.live + '</b><small>' + (state.online ? t.liveSub : esc(cfg.offline_message)) + '</small></span></button>'; }
  function renderHome() {
    panel.innerHTML = header(false) + '<div class="bd">' +
      '<div class="wel">' + linkify(cfg.welcome_message) + '</div>' +
      (state.conv ? '<button class="cta" data-live><span class="ic">' + ICONS.chat + '</span><span><b>' + t.live + '</b><small>' + esc(state.conv.agent_name ? state.conv.agent_name : '') + ' ›</small></span></button>' : '') +
      (cfg.show_faq ? '<div class="srch"><input type="search" placeholder="' + t.search + '" id="ls-q"></div><div id="ls-faqs"><div class="empty">…</div></div>' : '') +
      (!state.conv ? liveCta() : '') +
      (state.session && state.session.verified ? '<button class="cta" data-hist style="padding:10px 14px"><span><b>' + t.history + '</b></span></button>' : '') +
      '</div><div class="ft">' + esc(state.company || t.poweredBy) + '</div>';
    bindHeader();
    $$('[data-live]').forEach(function (b) { b.onclick = startLive; });
    var hb = $('[data-hist]'); if (hb) hb.onclick = function () { go('history'); };
    if (!cfg.show_faq) return;
    var load = state.faqCache ? Promise.resolve(state.faqCache) : api('GET', '/faqs').then(function (r) { state.faqCache = r; return r; });
    load.then(function (r) { drawFaqList(r.categories); }).catch(function () { $('#ls-faqs').innerHTML = ''; });
    var timer;
    $('#ls-q').oninput = function (e) {
      clearTimeout(timer); var v = e.target.value.trim();
      timer = setTimeout(function () {
        if (!v) return drawFaqList(state.faqCache ? state.faqCache.categories : []);
        api('GET', '/faqs/search?q=' + encodeURIComponent(v)).then(function (r) {
          $('#ls-faqs').innerHTML = '<div class="sec">' + (r.items.length ? r.items.map(qBtn).join('') : '<div class="empty">' + t.noResult + '</div>') + '</div>';
          bindQ();
        });
      }, 250);
    };
  }
  function qBtn(f) { return '<button class="q" data-faq="' + f.id + '"><span>' + esc(f.question) + '</span><span>›</span></button>'; }
  function bindQ() { $$('[data-faq]').forEach(function (b) { b.onclick = function () { api('POST', '/faq-events', { event_type: 'click', faq_id: b.dataset.faq }).catch(function () {}); go('faq', b.dataset.faq); }; }); }
  function drawFaqList(cats) {
    var box = $('#ls-faqs'); if (!box) return;
    cats = cats.filter(function (c) { return c.faqs.length; });
    box.innerHTML = cats.length ? '<div class="sec"><h3>' + t.faq + '</h3>' + cats.map(function (c) { return '<div class="cat">' + esc(c.title) + '</div>' + c.faqs.map(qBtn).join(''); }).join('') + '</div>' : '';
    bindQ();
  }
  function renderFaq(id) {
    panel.innerHTML = header(true) + '<div class="bd"><div class="empty">…</div></div>';
    bindHeader();
    api('GET', '/faqs/' + id).then(function (f) {
      var list = function (title, arr) { return arr.length ? '<div class="sec"><h3>' + title + '</h3>' + arr.map(qBtn).join('') + '</div>' : ''; };
      $('.bd').innerHTML = '<div class="ans"><h3>' + esc(f.question) + '</h3><div class="tx">' + linkify(f.answer) + '</div>' +
        '<div class="fb" id="ls-fb">' + t.helpful + ' <button class="btn" data-h="1">👍 ' + t.yes + '</button><button class="btn" data-h="0">👎 ' + t.no + '</button></div></div>' +
        list(t.related, f.related) + list(t.more, f.more) +
        '<div class="sec"><h3>' + t.stillHelp + '</h3></div>' + liveCta();
      $$('[data-h]').forEach(function (b) { b.onclick = function () { api('POST', '/faqs/' + f.id + '/feedback', { helpful: b.dataset.h === '1' }).catch(function () {}); $('#ls-fb').textContent = t.thanks; }; });
      $('[data-live]').onclick = function () { api('POST', '/faq-events', { event_type: 'live_chat_click', faq_id: f.id }).catch(function () {}); startLive(); };
      bindQ();
    }).catch(function () { $('.bd').innerHTML = '<div class="empty">' + t.error + '</div>'; });
  }

  // ---------------------------------------------------------- identify
  function startLive() {
    if (!cfg.show_faq || state.screen === 'home') api('POST', '/faq-events', { event_type: 'live_chat_click' }).catch(function () {});
    if (state.session) return go('chat');
    if (!cfg.require_player_id) return identify({}).then(function () { go('chat'); }).catch(function (e) { alertErr(e); });
    go('identify');
  }
  function identify(o, silent) {
    return api('POST', '/sessions/identify', { player_id: o.player_id || undefined, player_hash: o.hash || undefined, name: o.name || undefined, email: o.email || undefined })
      .then(function (r) {
        disconnect();
        saveSession({ token: r.token, player_id: r.customer.player_id, verified: r.verified });
        state.conv = r.active_conversation; state.messages = [];
        if (state.conv) connect();
        return r;
      }).catch(function (e) { if (!silent) throw e; console.warn('[LiveSupport]', e.message); });
  }
  function renderIdentify() {
    var label = cfg.player_id_label || 'Player ID';
    panel.innerHTML = header(true, cfg.title) + '<div class="bd"><form class="idf" id="ls-id"><h3>' + t.welcome + '</h3><p>' + esc(t.enterId.replace('{label}', label)) + '</p>' +
      '<input name="pid" placeholder="' + esc(label) + '" maxlength="150" required autocomplete="off">' +
      '<input name="nm" placeholder="' + t.name + '" maxlength="150" autocomplete="name">' +
      '<div class="err" id="ls-err"></div><button class="btn pri" type="submit">' + t.cont + '</button></form></div>';
    bindHeader();
    var f = $('#ls-id'); f.pid.focus();
    f.onsubmit = function (e) {
      e.preventDefault(); var btn = f.querySelector('button'); btn.disabled = true; $('#ls-err').textContent = '';
      identify({ player_id: f.pid.value.trim(), name: f.nm.value.trim() }).then(function () { history.pop(); state.screen = 'chat'; render(); })
        .catch(function (err) { $('#ls-err').textContent = err.message; btn.disabled = false; });
    };
  }
  function alertErr(e) { var el = $('#ls-err') || $('.typ'); if (el) el.textContent = e.message || t.error; }

  // ---------------------------------------------------------- history
  function renderHistory() {
    panel.innerHTML = header(true, t.history) + '<div class="bd"><div class="sec" id="ls-h"><div class="empty">…</div></div></div>';
    bindHeader();
    api('GET', '/conversations').then(function (r) {
      $('#ls-h').innerHTML = r.items.length ? r.items.map(function (c) {
        return '<button class="hist" data-c="' + c.id + '">' + esc(c.last_message_preview || '—') + '<br><small>' + new Date(c.last_message_at).toLocaleString() + ' · ' + esc(c.status) + '</small></button>';
      }).join('') : '<div class="empty">—</div>';
      $$('[data-c]').forEach(function (b) { b.onclick = function () { var c = r.items.find(function (x) { return x.id === b.dataset.c; }); state.conv = c; state.messages = []; connect(); go('chat'); }; });
    });
  }

  // ---------------------------------------------------------- chat
  function renderChat() {
    var agent = state.conv && state.conv.agent_name;
    panel.innerHTML = header(true, cfg.title, agent ? esc(agent) : null) +
      (!state.online ? '<div class="bnr">' + esc(cfg.offline_message) + '</div>' : '') +
      '<div class="bd" id="ls-bd"><div class="msgs" id="ls-msgs"></div></div><div class="typ" id="ls-typ"></div>' +
      '<div id="ls-chip"></div><div class="cmp">' +
      (cfg.enable_attachments ? '<button class="ib" id="ls-att" title="' + t.attach + '">📎</button><input type="file" id="ls-file" style="display:none" accept="image/*,.pdf,.txt,.zip,.doc,.docx">' : '') +
      '<textarea id="ls-ta" rows="1" placeholder="' + t.type + '" maxlength="5000"></textarea><button class="ib snd" id="ls-send" aria-label="Send">' + ICONS.send + '</button></div>';
    bindHeader();
    drawMessages();
    var ta = $('#ls-ta'); var typingOn = false, tt;
    var stop = function () { if (typingOn && state.socket && state.conv) { typingOn = false; state.socket.emit('customer:typing:stop', { conversation_id: state.conv.id }); } };
    ta.oninput = function () {
      ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      if (state.socket && state.conv) {
        if (!typingOn) typingOn = true;
        state.socket.emit('customer:typing:start', { conversation_id: state.conv.id, preview: ta.value.slice(-120) });
        clearTimeout(tt); tt = setTimeout(stop, 2500);
      }
    };
    ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stop(); send(); } };
    $('#ls-send').onclick = function () { stop(); send(); };
    if (cfg.enable_attachments) {
      $('#ls-att').onclick = function () {
        if (!state.conv) { $('#ls-typ').textContent = t.type; return ta.focus(); }
        $('#ls-file').click();
      };
      $('#ls-file').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) uploadFile(f); };
    }
    connect();
    if (state.conv && !state.messages.length) loadHistory();
    ta.focus();
  }
  function loadHistory() {
    if (!state.conv) return Promise.resolve();
    return api('GET', '/conversations/' + state.conv.id + '/messages').then(function (r) {
      state.conv = r.conversation;
      var pending = state.messages.filter(function (m) { return m._pending || m._failed; });
      state.messages = r.items.concat(pending.filter(function (p) { return !r.items.some(function (m) { return m.client_message_id === p.client_message_id; }); }));
      drawMessages(); markRead();
    }).catch(function (e) { if (e.status === 404) { state.conv = null; state.messages = []; drawMessages(); } });
  }
  function msgHtml(m) {
    if (m.message_type === 'system' || m.sender_type === 'system') return '<div class="m s">' + linkify(m.content) + '</div>';
    var mine = m.sender_type === 'customer';
    var atts = (m.attachments || []).map(function (a) {
      var url = BASE + a.url;
      return a.mime_type.indexOf('image/') === 0 ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="' + esc(a.file_name) + '"></a>'
        : '<a class="fl" href="' + esc(url) + '" target="_blank" rel="noopener">📄 ' + esc(a.file_name) + '</a>';
    }).join('');
    var time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var status = mine ? (m._failed ? ' · ' + t.failed : m._pending ? ' · 🕓' : m.read_at ? ' · ✓✓' : ' · ✓') : '';
    return '<div class="m ' + (mine ? 'c' : 'a') + (m._failed ? ' fail' : '') + '" data-cid="' + esc(m.client_message_id || '') + '">' +
      (!mine ? '<div class="nm">' + esc(m.sender_name || t.agent) + '</div>' : '') + atts + (m.content ? '<div>' + linkify(m.content) + '</div>' : '') +
      '<div class="tm">' + time + status + '</div></div>';
  }
  function drawMessages() {
    var box = $('#ls-msgs'); if (!box) return;
    var html = state.messages.length ? state.messages.map(msgHtml).join('') : '<div class="m a"><div class="nm">' + esc(state.company || t.agent) + '</div>' + linkify(cfg.welcome_message) + '</div>';
    var c = state.conv;
    if (c && (c.status === 'resolved' || c.status === 'closed') && cfg.enable_rating && !c.rating && !state.rated[c.id]) {
      html += '<div class="rate" id="ls-rate">' + t.rate + '<div class="stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<span data-r="' + n + '">★</span>'; }).join('') + '</div></div>';
    }
    box.innerHTML = html;
    $$('.m.fail').forEach(function (el) { el.onclick = function () { retry(el.dataset.cid); }; });
    $$('[data-r]').forEach(function (s) {
      s.onmouseenter = function () { $$('[data-r]').forEach(function (x) { x.classList.toggle('on', +x.dataset.r <= +s.dataset.r); }); };
      s.onclick = function () {
        var n = +s.dataset.r; var cid = c.id; state.rated[cid] = n;
        api('POST', '/conversations/' + cid + '/rating', { rating: n }).catch(function () {});
        $('#ls-rate').textContent = t.rated + ' ' + '★'.repeat(n);
      };
    });
    scrollBottom();
  }
  function scrollBottom() { var bd = $('#ls-bd'); if (bd) bd.scrollTop = bd.scrollHeight; }
  function upsertMessage(m) {
    var i = -1;
    for (var k = 0; k < state.messages.length; k++) {
      var x = state.messages[k];
      if ((m.id && x.id === m.id) || (m.client_message_id && x.client_message_id === m.client_message_id)) { i = k; break; }
    }
    if (i >= 0) state.messages[i] = m; else state.messages.push(m);
  }

  function send(retryMsg) {
    var ta = $('#ls-ta');
    var content = retryMsg ? retryMsg.content : ta.value.trim();
    var att = retryMsg ? retryMsg._attachment : state.attachment;
    if (!content && !att) return;
    var cid = retryMsg ? retryMsg.client_message_id : uid();
    if (!retryMsg) { ta.value = ''; ta.style.height = 'auto'; state.attachment = null; var chip = $('#ls-chip'); if (chip) chip.innerHTML = ''; }
    var local = { client_message_id: cid, sender_type: 'customer', message_type: 'text', content: content, created_at: new Date().toISOString(), _pending: true, _attachment: att,
      attachments: att ? [att] : [] };
    upsertMessage(local); drawMessages();
    var payload = { conversation_id: state.conv ? state.conv.id : null, content: content, client_message_id: cid, attachment_id: att ? att.id : null };
    var done = function (r) {
      if (r.conversation && (!state.conv || state.conv.id !== r.conversation.id)) {
        var switched = state.conv && state.conv.id !== r.conversation.id;
        state.conv = r.conversation;
        if (switched) state.messages = state.messages.filter(function (m) { return m.client_message_id === cid; });
        if (state.socket) state.socket.emit('customer:conversation:join', { conversation_id: state.conv.id }, function () {});
      } else if (r.conversation) state.conv = r.conversation;
      if (r.message) upsertMessage(r.message);
      drawMessages();
    };
    var fail = function (e) {
      local._pending = false; local._failed = true; upsertMessage(local); drawMessages();
      if (e && e.code === 'session_expired') { saveSession(null); go('identify'); }
      else if (e && e.message) $('#ls-typ').textContent = e.message;
    };
    if (state.socket && state.socket.connected) {
      state.socket.timeout(15000).emit('customer:message:send', payload, function (err, r) {
        if (err) return fail({ message: t.failed });
        if (!r.ok) return fail(r);
        done(r);
      });
    } else {
      var req = state.conv ? api('POST', '/conversations/' + state.conv.id + '/messages', payload) : api('POST', '/conversations', payload);
      req.then(function (r) { done(r); connect(); }).catch(fail);
    }
  }
  function retry(cid) {
    var m = state.messages.find(function (x) { return x.client_message_id === cid; });
    if (m) { m._failed = false; send(m); }
  }
  function uploadFile(f) {
    var chip = $('#ls-chip');
    chip.innerHTML = '<span class="chip">' + t.sending + ' ' + esc(f.name) + '</span>';
    var fd = new FormData(); fd.append('conversation_id', state.conv.id); fd.append('file', f);
    api('POST', '/uploads', fd, true).then(function (a) {
      state.attachment = a;
      chip.innerHTML = '<span class="chip">📎 ' + esc(a.file_name) + ' <button id="ls-rm">✕</button></span>';
      $('#ls-rm').onclick = function () { state.attachment = null; chip.innerHTML = ''; };
      $('#ls-ta').focus();
    }).catch(function (e) { chip.innerHTML = '<span class="chip" style="color:#dc2626">' + esc(e.message) + '</span>'; });
  }
  function markRead() {
    if (state.open && state.screen === 'chat' && state.socket && state.socket.connected && state.conv && document.visibilityState === 'visible') {
      state.socket.emit('customer:message:read', { conversation_id: state.conv.id }, function () {});
    }
  }
  document.addEventListener('visibilitychange', markRead);

  // ---------------------------------------------------------- socket
  var ioLoading = null;
  function loadIo() {
    if (ioLoading) return ioLoading;
    ioLoading = new Promise(function (resolve, reject) {
      var prev = window.io;
      var s = document.createElement('script');
      s.src = BASE + '/socket.io/socket.io.min.js'; s.async = true;
      s.onload = function () { var mine = window.io; if (prev) window.io = prev; resolve(mine); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return ioLoading;
  }
  function disconnect() { if (state.socket) { state.socket.disconnect(); state.socket = null; } }
  function connect() {
    if (!state.session || state.socket) return;
    loadIo().then(function (ioFn) {
      if (state.socket || !state.session) return;
      var s = ioFn(BASE, { auth: { type: 'customer', token: state.session.token }, transports: ['websocket', 'polling'] });
      state.socket = s;
      s.on('connect', function () {
        if (state.conv) s.emit('customer:conversation:join', { conversation_id: state.conv.id }, function (r) {
          if (r && r.ok) { state.conv = r.conversation; setOnline(r.online); }
          if (state.screen === 'chat') loadHistory(); // fetch anything missed while disconnected
        });
      });
      s.on('connect_error', function (e) {
        if (e.message === 'session_expired') { saveSession(null); disconnect(); if (state.screen === 'chat') go('identify'); }
      });
      s.on('chat:session:revoked', function () { saveSession(null); disconnect(); state.conv = null; state.messages = []; state.screen = 'home'; render(); });
      s.on('chat:message:new', function (m) {
        if (!state.conv || m.conversation_id !== state.conv.id) return;
        upsertMessage(m);
        if (state.screen === 'chat') { drawMessages(); var typ = $('#ls-typ'); if (typ && m.sender_type === 'agent') typ.textContent = ''; }
        if (m.sender_type === 'agent') {
          if (!state.open || state.screen !== 'chat' || document.visibilityState !== 'visible') { state.unread++; updateBadge(); ping(); }
          markRead();
        }
      });
      s.on('chat:agent:typing', function (p) {
        var typ = $('#ls-typ'); if (!typ || !state.conv || p.conversation_id !== state.conv.id) return;
        typ.textContent = p.typing ? (p.name || t.agent) + ' ' + t.typing : '';
      });
      s.on('chat:message:read', function (p) {
        if (!state.conv || p.conversation_id !== state.conv.id) return;
        state.messages.forEach(function (m) { if (p.message_ids.indexOf(m.id) >= 0) m.read_at = new Date().toISOString(); });
        if (state.screen === 'chat') drawMessages();
      });
      s.on('chat:conversation:updated', function (c) {
        if (!state.conv || c.id !== state.conv.id) return;
        var agentChanged = c.agent_name !== state.conv.agent_name;
        state.conv = Object.assign({}, state.conv, c);
        if (state.screen === 'chat') { if (agentChanged) render(); else drawMessages(); }
      });
      s.on('chat:agent:online', function () { setOnline(true); });
      s.on('chat:agent:offline', function () { setOnline(false); });
    }).catch(function () { console.warn('[LiveSupport] realtime unavailable'); });
  }
  function setOnline(v) { if (state.online === v) return; state.online = v; if (state.screen !== 'chat' || !$('#ls-ta') || !$('#ls-ta').value) render(); }
  function ping() {
    try {
      var A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      var ctx = ping.ctx || (ping.ctx = new A()); var o = ctx.createOscillator(); var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      o.start(); o.stop(ctx.currentTime + 0.32);
    } catch (e) {}
  }

  // ---------------------------------------------------------- public API
  window.LiveSupport = {
    __loaded: true,
    open: function () { if (panel) open(); },
    close: function () { if (panel) close(); },
    toggle: function () { if (panel) toggle(); },
    identify: function (o) { return identify(o || {}); },
    logout: function () {
      var p = state.session ? api('POST', '/sessions/logout').catch(function () {}) : Promise.resolve();
      return p.then(function () { saveSession(null); disconnect(); state.conv = null; state.messages = []; state.screen = 'home'; render(); });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
