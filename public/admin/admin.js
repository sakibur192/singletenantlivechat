/* Live Support Desk — Admin panel (vanilla JS SPA) */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RANK = { agent: 1, supervisor: 2, admin: 3, owner: 4 };
  const S = { me: null, socket: null, agents: [], tags: [], canned: [], page: null, inbox: null, sound: true };

  // ---------- API ----------
  async function api(method, url, body, isForm) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'lsd' } };
    if (body !== undefined) {
      if (isForm) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    const res = await fetch('/api/admin' + url, opts);
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && !url.startsWith('/auth/login')) { showLogin(); throw new Error('Not logged in'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const can = (min) => S.me && RANK[S.me.role] >= RANK[min];

  // ---------- UI helpers ----------
  function toast(msg, err, onClick) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    t.onclick = () => { onClick && onClick(); t.remove(); };
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  const tryDo = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };
  function modal(html, onMount) {
    $('#modalCard').innerHTML = html;
    $('#modal').classList.remove('hidden');
    onMount && onMount($('#modalCard'));
  }
  const closeModal = () => $('#modal').classList.add('hidden');
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  function confirmBox(text) {
    return new Promise((resolve) => {
      modal(`<h2>Are you sure?</h2><p>${esc(text)}</p><div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Confirm</button></div>`, (m) => {
        $('[data-x]', m).onclick = () => { closeModal(); resolve(false); };
        $('[data-ok]', m).onclick = () => { closeModal(); resolve(true); };
      });
    });
  }
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const fmtTime = (d) => { if (!d) return ''; const t = new Date(d); const now = new Date();
    if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return t.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  const fmtDT = (d) => d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const fmtDur = (s) => { if (s == null) return '—'; s = Number(s); if (s < 60) return s + 's'; if (s < 3600) return Math.round(s / 60) + 'm'; return (s / 3600).toFixed(1) + 'h'; };
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
  function formData(form) { const o = {}; new FormData(form).forEach((v, k) => { o[k] = v; }); return o; }

  let audioCtx;
  function beep() {
    if (!S.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      o.start(); o.stop(audioCtx.currentTime + 0.4);
    } catch {}
  }

  // ---------- Auth ----------
  function showLogin() {
    if (S.socket) { S.socket.disconnect(); S.socket = null; }
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  }
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try { await api('POST', '/auth/login', formData(e.target)); await boot(); }
    catch (err) { $('#loginError').textContent = err.message; }
  };
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/auth/logout').catch(() => {}); showLogin(); };

  async function boot() {
    let me;
    try { me = await api('GET', '/auth/me'); } catch { return showLogin(); }
    S.me = me.user; S.sound = me.sound !== false;
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#companyName').textContent = me.company_name || 'Support Desk';
    $('#meName').textContent = S.me.display_name || S.me.name;
    $('#meRole').textContent = S.me.role;
    $('#meAvatar').textContent = initials(S.me.name);
    $$('#nav a[data-min]').forEach((a) => a.classList.toggle('hidden', !can(a.dataset.min)));
    await refreshLookups();
    connectSocket();
    route();
  }
  async function refreshLookups() {
    const [a, t, c] = await Promise.all([api('GET', '/agents'), api('GET', '/tags'), api('GET', '/canned-responses')]);
    S.agents = a.items; S.tags = t.items; S.canned = c.items;
    const mine = S.agents.find((x) => x.id === S.me.id);
    if (mine) $('#presence').value = mine.presence === 'offline' ? 'online' : mine.presence;
  }
  $('#presence').onchange = (e) => S.socket && S.socket.emit('agent:presence:update', { presence: e.target.value }, (r) => !r.ok && toast(r.error, true));

  // ---------- Socket ----------
  function connectSocket() {
    if (S.socket) S.socket.disconnect();
    const s = io({ transports: ['websocket', 'polling'] });
    S.socket = s;
    const conn = $('#conn');
    s.on('connect', () => {
      conn.textContent = '● Connected'; conn.className = 'conn ok';
      if (S.inbox && S.inbox.openId) s.emit('agent:conversation:join', { conversation_id: S.inbox.openId }, () => {});
      if (S.page === 'inbox') { loadConvList(); if (S.inbox && S.inbox.openId) loadMessages(); }
    });
    s.on('disconnect', () => { conn.textContent = '● Reconnecting…'; conn.className = 'conn bad'; });
    s.on('connect_error', (e) => { conn.textContent = '● ' + e.message; conn.className = 'conn bad'; if (e.message === 'unauthorized') showLogin(); });

    s.on('inbox:conversation:new', (c) => {
      beep();
      toast(`New chat from ${c.player_id}`, false, () => { location.hash = '#/inbox'; setTimeout(() => openConversation(c.id), 50); });
      upsertConv(c, true);
      bumpCounts();
    });
    s.on('inbox:message:new', ({ conversation, message }) => {
      upsertConv(conversation, true);
      const ib = S.inbox;
      const isOpen = ib && ib.openId === conversation.id && S.page === 'inbox';
      if (isOpen) {
        appendMessage(message);
        if (message.sender_type === 'customer' && document.visibilityState === 'visible') s.emit('agent:message:read', { conversation_id: conversation.id }, () => {});
      }
      if (message.sender_type === 'customer' && (!isOpen || document.visibilityState !== 'visible')) {
        beep();
        if (!isOpen) toast(`${conversation.player_id}: ${message.content || '📎 Attachment'}`, false, () => { location.hash = '#/inbox'; setTimeout(() => openConversation(conversation.id), 50); });
      }
      bumpCounts();
    });
    s.on('inbox:conversation:updated', (c) => {
      upsertConv(c, false);
      if (S.inbox && S.inbox.openId === c.id) { S.inbox.conv = { ...S.inbox.conv, ...c }; renderChatHead(); renderProfileTags(); }
      bumpCounts();
    });
    s.on('inbox:customer:typing', ({ conversation_id, typing, preview }) => {
      if (!S.inbox) return;
      S.inbox.typing[conversation_id] = typing ? (preview || true) : null;
      const item = $(`.ci[data-id="${conversation_id}"] .prev`);
      if (item) {
        const c = S.inbox.items.find((x) => x.id === conversation_id);
        item.innerHTML = typing ? '<span class="typing">typing…</span>' : esc(c ? c.last_message_preview || '' : '');
      }
      if (S.inbox.openId === conversation_id) {
        $('#typingLine') && ($('#typingLine').textContent = typing ? `Customer is typing${preview ? ': ' + preview : '…'}` : '');
      }
    });
    s.on('inbox:agent:typing', ({ conversation_id, typing, name }) => {
      if (S.inbox && S.inbox.openId === conversation_id && $('#typingLine')) $('#typingLine').textContent = typing ? `${name} is typing…` : '';
    });
    const markTicks = ({ conversation_id, message_ids }, cls) => {
      if (!S.inbox || S.inbox.openId !== conversation_id) return;
      message_ids.forEach((id) => {
        const m = S.inbox.messages.find((x) => x.id === id);
        if (m) { if (cls === 'read') m.read_at = new Date().toISOString(); else m.delivered_at = new Date().toISOString(); }
        const t = $(`.msg[data-id="${id}"] .tick`); if (t) { t.textContent = '✓✓'; t.classList.toggle('read', cls === 'read' || t.classList.contains('read')); }
      });
    };
    s.on('inbox:message:read', (p) => markTicks(p, 'read'));
    s.on('inbox:message:delivered', (p) => markTicks(p, 'delivered'));
    s.on('inbox:cleared', ({ by }) => {
      if (S.inbox && S.inbox.openId) { S.inbox.openId = null; }
      toast(`Old chats were cleared${by ? ' by ' + by : ''}`);
      if (S.page === 'inbox' || S.page === 'dashboard' || S.page === 'customers') route();
    });
    s.on('inbox:agent:presence', ({ agent_id, presence }) => {
      const a = S.agents.find((x) => x.id === agent_id);
      if (a) a.presence = presence;
      if (agent_id === S.me.id) $('#presence').value = presence;
      if (S.page === 'agents') renderAgents();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.inbox && S.inbox.openId && S.page === 'inbox') {
      S.socket && S.socket.emit('agent:message:read', { conversation_id: S.inbox.openId }, () => {});
    }
  });
  let countTimer;
  function bumpCounts() {
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const r = await api('GET', '/conversations?view=inbox&limit=1').catch(() => null);
      if (!r) return;
      if (S.inbox) { S.inbox.counts = r.counts; renderViewCounts(); }
      const unread = (S.inbox ? S.inbox.items : []).reduce((a, c) => a + (c.unread_agent || 0), 0);
      const n = $('#navUnread'); n.textContent = r.counts.unassigned + r.counts.mine; n.classList.toggle('hidden', !(r.counts.unassigned + r.counts.mine));
      document.title = (unread ? `(${unread}) ` : '') + 'Live Support Desk';
    }, 400);
  }

  // ---------- Router ----------
  const PAGES = { dashboard: pageDashboard, inbox: pageInbox, customers: pageCustomers, kb: pageKB, canned: pageCanned, agents: pageAgents,
    widget: pageWidget, analytics: pageAnalytics, settings: pageSettings, audit: pageAudit, profile: pageProfile };
  function route() {
    if (!S.me) return;
    const [page, arg] = (location.hash.replace(/^#\/?/, '') || 'inbox').split('/');
    const fn = PAGES[page] || pageInbox;
    S.page = PAGES[page] ? page : 'inbox';
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === S.page));
    if (S.page !== 'inbox' && S.inbox && S.inbox.openId && S.socket) S.socket.emit('agent:conversation:leave', { conversation_id: S.inbox.openId });
    if (S.page !== 'inbox') S.inbox = null;
    $('#main').scrollTop = 0;
    Promise.resolve(fn(arg)).catch((e) => toast(e.message, true));
  }
  window.addEventListener('hashchange', route);

  // ============================================================
  // Dashboard
  // ============================================================
  async function pageDashboard() {
    const d = await api('GET', '/dashboard');
    const k = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    $('#main').innerHTML = `<div class="page">
      <div class="page-head"><h1>Dashboard</h1>
        <div class="row">
          <span class="badge ${d.support_online ? 'online' : ''}">${d.support_online ? 'Support is online' : 'Support is offline'}</span>
          ${can('admin') ? `<div class="clear-wrap"><button class="btn danger" id="clearBtn">🧹 Clear</button>
            <div class="clear-menu hidden" id="clearMenu">
              <div class="muted" style="padding:6px 12px 4px;font-size:12px">Keep chats from the last…</div>
              <button data-keep="30m">30 minutes</button><button data-keep="1h">1 hour</button>
              <button data-keep="6h">6 hours</button><button data-keep="12h">12 hours</button>
            </div></div>` : ''}
        </div></div>
      <div class="grid g4">
        ${k('Open Chats', d.open, 'Active conversations')}
        ${k('Waiting', d.waiting, 'Need assignment')}
        ${k('Agents Online', d.agents_online, 'Currently available')}
        ${k('Resolved Today', d.resolved_today, 'Completed chats')}
        ${k('My Active Chats', d.mine, 'Assigned to you')}
        ${k('New Today', d.new_today, 'Conversations started')}
        ${k('Avg First Response', fmtDur(d.avg_first_response_sec), 'Last 7 days')}
        ${k('Satisfaction', d.avg_rating ? d.avg_rating + ' / 5' : '—', 'Last 30 days')}
      </div>
      <div class="card" style="margin-top:16px"><h2>Quick start</h2>
        <ol class="muted" style="margin:0;padding-left:18px;line-height:1.9">
          <li>Add your FAQs in <a href="#/kb">Knowledge Base</a>.</li>
          <li>Customize colours and text in <a href="#/widget">Widget Design</a>.</li>
          <li>Paste the embed code from <a href="#/settings">Settings</a> into your website, and add your domain to the allow-list.</li>
          <li>Invite your team in <a href="#/agents">Agents</a> — set yourself <b>Online</b> to receive chats.</li>
        </ol></div></div>`;
    if (can('admin')) {
      const menu = $('#clearMenu');
      $('#clearBtn').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
      document.addEventListener('click', () => menu.classList.add('hidden'), { once: true });
      $$('[data-keep]', menu).forEach((b) => b.onclick = () => { menu.classList.add('hidden'); clearChats(b.dataset.keep, b.textContent); });
    }
  }

  // ---- Clear old chats (keeps the chosen window, deletes everything older) ----
  async function clearChats(keep, label) {
    const p = await tryDo(() => api('GET', '/cleanup/preview?keep=' + keep));
    if (!p) return;
    const when = new Date(p.cutoff).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const nothing = !p.conversations && !p.messages && !p.files;
    modal(`<h2>🧹 Clear chats older than ${esc(label)}</h2>
      <p>Everything from <b>${esc(when)}</b> until now is kept. Everything <b>before</b> that is permanently deleted:</p>
      <div class="card" style="margin:0 0 12px">
        <div class="kv"><span>Conversations</span><span><b>${p.conversations}</b>${p.open_conversations ? ` <span class="badge urgent">${p.open_conversations} still open</span>` : ''}</span></div>
        <div class="kv"><span>Messages</span><span><b>${p.messages}</b></span></div>
        <div class="kv"><span>Photos, voice notes & files</span><span><b>${p.files}</b> (${p.bytes ? fmtSize(p.bytes) : "0 KB"})</span></div>
      </div>
      <p class="muted" style="font-size:13px">Agents, settings, FAQ, canned replies and customer profiles are kept. This cannot be undone.</p>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn primary" id="doClear" style="background:var(--danger);border-color:var(--danger)" ${nothing ? 'disabled' : ''}>${nothing ? 'Nothing to delete' : 'Delete permanently'}</button></div>`, (m) => {
      $('[data-x]', m).onclick = closeModal;
      const go = $('#doClear');
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'Deleting…';
        const r = await tryDo(() => api('POST', '/cleanup', { keep }));
        closeModal();
        if (r) { toast(`Cleared ${r.conversations} chats, ${r.messages} messages, ${r.files} files — ${r.bytes_freed ? fmtSize(r.bytes_freed) : "0 KB"} freed`); route(); }
      };
    });
  }

  // ============================================================
  // Inbox
  // ============================================================
  async function pageInbox(arg) {
    S.inbox = { view: 'inbox', search: '', priority: '', items: [], counts: {}, cursor: null, openId: null, conv: null, messages: [], typing: {}, mode: 'reply', attachment: null };
    $('#main').innerHTML = `<div class="inbox no-profile" id="inboxRoot">
      <div class="ib-views" id="ibViews">
        <a href="#" data-view="inbox">Inbox <span data-c="inbox"></span></a>
        <a href="#" data-view="unassigned">Unassigned <span data-c="unassigned"></span></a>
        <a href="#" data-view="mine">Assigned to Me <span data-c="mine"></span></a>
        <a href="#" data-view="pending">Pending <span data-c="pending"></span></a>
        <a href="#" data-view="resolved">Resolved</a>
        <a href="#" data-view="all">All Conversations</a>
        ${S.tags.length ? '<h4>Tags</h4>' + S.tags.map((t) => `<a href="#" data-tag="${t.id}"><span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span></a>`).join('') : ''}
      </div>
      <div class="ib-list">
        <div class="ib-search">
          <input id="ibSearch" placeholder="Search Player ID, name, message…" />
          <select id="ibPriority"><option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
        </div>
        <div class="ib-items" id="ibItems"></div>
      </div>
      <div class="ib-chat" id="ibChat"><div class="empty"><div class="big">💬</div><p>Select a conversation to start chatting</p></div></div>
      <div class="ib-profile hidden" id="ibProfile"></div>
    </div>`;
    $$('#ibViews a').forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      S.inbox.view = a.dataset.view || 'all'; S.inbox.tag = a.dataset.tag || '';
      $$('#ibViews a').forEach((x) => x.classList.toggle('active', x === a));
      loadConvList();
    });
    $('#ibViews a[data-view="inbox"]').classList.add('active');
    let st; $('#ibSearch').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { S.inbox.search = e.target.value.trim(); loadConvList(); }, 300); };
    $('#ibPriority').onchange = (e) => { S.inbox.priority = e.target.value; loadConvList(); };
    $('#ibItems').onscroll = (e) => { const el = e.target; if (S.inbox.cursor && el.scrollTop + el.clientHeight > el.scrollHeight - 80) loadConvList(true); };
    await loadConvList();
    if (arg) openConversation(arg);
  }
  let listLoading = false;
  async function loadConvList(more) {
    const ib = S.inbox; if (!ib || (more && listLoading)) return;
    listLoading = true;
    try {
      const p = new URLSearchParams({ view: ib.view, limit: 30 });
      if (ib.search) p.set('search', ib.search);
      if (ib.priority) p.set('priority', ib.priority);
      if (ib.tag) p.set('tag_id', ib.tag);
      if (more && ib.cursor) p.set('cursor', ib.cursor);
      const r = await api('GET', '/conversations?' + p);
      if (S.inbox !== ib) return;
      ib.items = more ? ib.items.concat(r.items) : r.items;
      ib.cursor = r.next_cursor; ib.counts = r.counts;
      renderConvList(); renderViewCounts(); bumpCounts();
    } finally { listLoading = false; }
  }
  function renderViewCounts() { if (!S.inbox) return; $$('#ibViews [data-c]').forEach((s) => { const n = S.inbox.counts[s.dataset.c]; s.textContent = n ? n : ''; }); }
  function matchesView(c) {
    const ib = S.inbox; const v = ib.view; const active = c.status === 'open' || c.status === 'pending';
    if (ib.priority && c.priority !== ib.priority) return false;
    if (ib.tag && !(c.tags || []).some((t) => t.id === ib.tag)) return false;
    if (ib.search) return ib.items.some((x) => x.id === c.id);
    if (!can('supervisor') && c.assigned_agent_id && c.assigned_agent_id !== S.me.id) return false;
    if (v === 'inbox') return active;
    if (v === 'unassigned') return active && !c.assigned_agent_id;
    if (v === 'mine') return active && c.assigned_agent_id === S.me.id;
    if (v === 'pending') return c.status === 'pending';
    if (v === 'resolved') return c.status === 'resolved' || c.status === 'closed';
    return true;
  }
  function upsertConv(c, toTop) {
    const ib = S.inbox; if (!ib) return;
    const i = ib.items.findIndex((x) => x.id === c.id);
    const fits = matchesView(c);
    if (i >= 0) {
      if (!fits) ib.items.splice(i, 1);
      else { ib.items[i] = { ...ib.items[i], ...c }; if (toTop) ib.items.unshift(ib.items.splice(i, 1)[0]); }
    } else if (fits) ib.items.unshift(c);
    ib.items.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    renderConvList();
  }
  function renderConvList() {
    const ib = S.inbox; const box = $('#ibItems'); if (!box) return;
    if (!ib.items.length) { box.innerHTML = '<div class="empty"><p>No conversations here</p></div>'; return; }
    box.innerHTML = ib.items.map((c) => {
      const typing = ib.typing[c.id];
      return `<div class="ci ${c.id === ib.openId ? 'active' : ''}" data-id="${c.id}">
        <div class="av-wrap"><span class="avatar">${esc(initials(c.customer_name || c.player_id))}</span><span class="dot ${c.customer_online ? 'on' : ''}"></span></div>
        <div class="body">
          <div class="top"><b>${esc(c.player_id)}${c.customer_name ? ' · ' + esc(c.customer_name) : ''}</b><span class="time">${fmtTime(c.last_message_at)}</span></div>
          <div class="top"><div class="prev">${typing ? '<span class="typing">typing…</span>' : esc(c.last_message_preview || '')}</div>${c.unread_agent ? `<span class="unread">${c.unread_agent}</span>` : ''}</div>
          <div class="meta">
            ${c.status !== 'open' ? `<span class="badge ${c.status}">${c.status}</span>` : ''}
            ${c.priority !== 'normal' ? `<span class="badge ${c.priority}">${c.priority}</span>` : ''}
            <small class="muted">${c.agent_name ? '👤 ' + esc(c.agent_name) : '⏳ Unassigned'}</small>
            ${(c.tags || []).map((t) => `<span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}
          </div>
        </div></div>`;
    }).join('');
    $$('.ci', box).forEach((el) => el.onclick = () => openConversation(el.dataset.id));
  }

  async function openConversation(id) {
    const ib = S.inbox; if (!ib) return;
    if (ib.openId && ib.openId !== id) S.socket && S.socket.emit('agent:conversation:leave', { conversation_id: ib.openId });
    if (typeof stopVoice === 'function') stopVoice();
    ib.openId = id; ib.mode = 'reply';
    history.replaceState(null, '', '#/inbox/' + id);
    renderConvList();
    const d = await api('GET', '/conversations/' + id);
    if (S.inbox !== ib || ib.openId !== id) return;
    ib.conv = d.conversation; ib.customer = d.customer; ib.previous = d.previous;
    S.socket && S.socket.emit('agent:conversation:join', { conversation_id: id }, () => {});
    renderChat(); renderProfile();
    await loadMessages();
    S.socket && S.socket.emit('agent:message:read', { conversation_id: id }, () => {});
    const it = ib.items.find((x) => x.id === id); if (it) { it.unread_agent = 0; renderConvList(); }
  }
  async function loadMessages() {
    const ib = S.inbox; if (!ib || !ib.openId) return;
    const r = await api('GET', `/conversations/${ib.openId}/messages`);
    if (S.inbox !== ib) return;
    ib.messages = r.items; renderMessages();
  }

  function renderChat() {
    const ib = S.inbox;
    ib.replyTo = null;
    $('#ibChat').innerHTML = `
      <div class="chat-head" id="chatHead"></div>
      <div class="msgs" id="msgs"></div>
      <div class="typing-line" id="typingLine"></div>
      <div class="composer" id="composer">
        <div class="tabs"><button data-mode="reply" class="active">Reply</button><button data-mode="note" class="note">Internal note</button>
          <span class="spacer"></span><small class="muted" style="align-self:center">Type <b>/</b> for canned replies · paste or drop images · Enter to send</small></div>
        <div id="replyBar"></div>
        <div class="inrow" id="inrow">
          <button class="icon-btn" id="attachBtn" title="Photos, voice files, documents">📎</button>
          <input type="file" id="fileIn" class="hidden" multiple accept="image/*,audio/*,.pdf,.txt,.zip,.doc,.docx" />
          <textarea id="composerText" rows="1" placeholder="Type a reply…"></textarea>
          <button class="icon-btn send-btn" id="sendBtn" title="Record voice message">🎤</button>
        </div>
      </div>
      <div class="lightbox hidden" id="lightbox"><img alt=""><button class="btn sm" id="lbClose">✕ Close</button></div>`;
    renderChatHead();
    const ta = $('#composerText');
    const sendBtn = $('#sendBtn');
    const refreshBtn = () => {
      const voice = !ta.value.trim() && ib.mode === 'reply';
      sendBtn.textContent = voice ? '🎤' : '➤';
      sendBtn.title = voice ? 'Record voice message' : 'Send';
    };
    $$('#composer .tabs button').forEach((b) => b.onclick = () => {
      ib.mode = b.dataset.mode;
      $$('#composer .tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#composer').classList.toggle('note', ib.mode === 'note');
      ta.placeholder = ib.mode === 'note' ? 'Write an internal note (customer will NOT see this)…' : 'Type a reply…';
      $('#attachBtn').classList.toggle('hidden', ib.mode === 'note');
      refreshBtn(); ta.focus();
    });
    let typingOn = false, typingTimer;
    const stopTyping = () => { if (typingOn) { typingOn = false; S.socket.emit('agent:typing:stop', { conversation_id: ib.openId }); } };
    ta.oninput = () => {
      ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
      handleCanned(ta); refreshBtn();
      if (ib.mode === 'reply' && S.socket) {
        if (!typingOn) { typingOn = true; S.socket.emit('agent:typing:start', { conversation_id: ib.openId }); }
        clearTimeout(typingTimer); typingTimer = setTimeout(stopTyping, 2500);
      }
    };
    ta.onkeydown = (e) => {
      const pop = $('.canned-pop');
      if (pop) {
        const items = $$('div', pop); let i = items.findIndex((x) => x.classList.contains('sel'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[i] && items[i].classList.remove('sel'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[i].classList.add('sel'); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && items[i]) { e.preventDefault(); items[i].click(); return; }
        if (e.key === 'Escape') { pop.remove(); return; }
      }
      if (e.key === 'Escape' && ib.replyTo) { setReply(null); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopTyping(); send(); refreshBtn(); }
    };
    sendBtn.onclick = () => {
      stopTyping();
      if (!ta.value.trim() && ib.mode === 'reply') startRecording(); else { send(); refreshBtn(); }
    };
    $('#attachBtn').onclick = () => $('#fileIn').click();
    $('#fileIn').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; sendFiles(files); };
    ta.addEventListener('paste', (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (files.length && ib.mode === 'reply') { e.preventDefault(); sendFiles(files); }
    });
    const msgs = $('#msgs');
    msgs.addEventListener('dragover', (e) => e.preventDefault());
    msgs.addEventListener('drop', (e) => { e.preventDefault(); if (ib.mode === 'reply') sendFiles([...(e.dataTransfer.files || [])]); });
    msgs.addEventListener('click', onMsgClick);
    $('#lbClose').onclick = () => $('#lightbox').classList.add('hidden');
    $('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); };
    ta.focus();
  }

  // ---- reply / quote ----
  const quoteName = (m) => m.sender_type === 'customer' ? (S.inbox.conv ? (S.inbox.conv.customer_name || S.inbox.conv.player_id) : 'Customer') : (m.sender_name || 'Agent');
  function quoteText(m) {
    if (m.content) return m.content;
    const a = (m.attachments || [])[0];
    if (a && a.mime_type.startsWith('audio/')) return '🎤 Voice message';
    if (a && a.mime_type.startsWith('image/')) return '📷 Photo';
    return a ? '📎 ' + a.file_name : '';
  }
  function setReply(id) {
    const ib = S.inbox; if (!ib) return;
    ib.replyTo = id ? ib.messages.find((x) => x.id === id) || null : null;
    const box = $('#replyBar'); if (!box) return;
    const m = ib.replyTo;
    if (!m) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="reply-bar"><div class="quote"><b>${esc(quoteName(m))}</b><span>${esc(quoteText(m))}</span></div><button class="btn sm" id="rbX">✕</button></div>`;
    $('#rbX').onclick = () => setReply(null);
    $('#composerText').focus();
  }
  function takeReply() { const r = S.inbox.replyTo; setReply(null); return r; }
  const replyPreview = (r) => r ? { id: r.id, sender_type: r.sender_type, sender_name: r.sender_name, content: quoteText(r) } : null;

  function onMsgClick(e) {
    const cp = e.target.closest('[data-copy]');
    if (cp) { navigator.clipboard.writeText(cp.dataset.copy).then(() => toast('Copied: ' + cp.dataset.copy)).catch(() => {}); return; }
    const rb = e.target.closest('[data-reply]');
    if (rb) { setReply(rb.dataset.reply); return; }
    const img = e.target.closest('img[data-full]');
    if (img) { e.preventDefault(); const lb = $('#lightbox'); $('img', lb).src = img.dataset.full; lb.classList.remove('hidden'); return; }
    const q = e.target.closest('[data-goto]');
    if (q) {
      const el = $(`.msg[data-id="${q.dataset.goto}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); }
      return;
    }
    const vp = e.target.closest('.vp'); if (vp) { togglePlay(vp.closest('.vn')); return; }
    const vb = e.target.closest('.vb'); if (vb) { seekVoice(vb.closest('.vn'), e, vb); return; }
    const failed = e.target.closest('.msg.failed'); if (failed) retryMsg(failed.dataset.cid);
  }

  // ---- voice player (one at a time, survives re-renders) ----
  let player = null;
  const fmtClock = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const voiceEl = () => player && $$('.vn').find((v) => v.dataset.src === player.src);
  function stopVoice() { if (!player) return; player.audio.pause(); const v = voiceEl(); if (v) $('.vp', v).textContent = '▶'; player = null; }
  function togglePlay(v) {
    if (player && player.src === v.dataset.src) {
      if (player.audio.paused) { player.audio.play(); $('.vp', v).textContent = '⏸'; } else { player.audio.pause(); $('.vp', v).textContent = '▶'; }
      return;
    }
    stopVoice();
    const audio = new Audio(v.dataset.src); const dur = +v.dataset.dur || 0;
    const p = player = { audio, src: v.dataset.src, dur };
    const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : dur);
    audio.ontimeupdate = () => { const el = voiceEl(); if (!el || player !== p) return; if (total()) $('.vb i', el).style.width = Math.min(100, audio.currentTime * 1000 / total() * 100) + '%'; $('.vd', el).textContent = fmtClock(audio.currentTime * 1000); };
    audio.onended = () => { const el = voiceEl(); if (el) { $('.vb i', el).style.width = '0%'; $('.vd', el).textContent = fmtClock(dur); $('.vp', el).textContent = '▶'; } if (player === p) player = null; };
    audio.play().then(() => { const el = voiceEl(); if (el) $('.vp', el).textContent = '⏸'; }).catch(() => toast('Cannot play this audio in this browser', true));
  }
  function seekVoice(v, e, bar) {
    if (!player || player.src !== v.dataset.src) return togglePlay(v);
    const a = player.audio; const tot = isFinite(a.duration) && a.duration > 0 ? a.duration : player.dur / 1000;
    const r = bar.getBoundingClientRect(); if (tot) a.currentTime = tot * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  // ---- voice recording ----
  let rec = null;
  function pickMime() {
    if (!window.MediaRecorder) return null;
    return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/aac'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  }
  async function startRecording() {
    if (rec) return;
    if (!window.isSecureContext) return toast('Voice recording in the browser needs HTTPS (a domain + SSL). Use the Android app, or open the admin over https.', true);
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices) return toast('This browser cannot record audio', true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return toast('Microphone permission denied', true); }
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 }) : new MediaRecorder(stream);
    const r = rec = { mr, stream, chunks: [], start: Date.now(), cancel: false };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.onstop = () => {
      rec = null; clearInterval(r.timer);
      r.stream.getTracks().forEach((tr) => tr.stop());
      const row = $('#inrow'); if (row) { $$('.rec-ui', row).forEach((x) => x.remove()); (r.hid || []).forEach((x) => x.classList.remove('hidden')); }
      const ms = Date.now() - r.start;
      if (r.cancel || ms < 700) return;
      const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('aac') ? 'aac' : 'webm';
      sendMedia(new File([new Blob(r.chunks, { type })], `voice-${Date.now()}.${ext}`, { type }), ms, '');
    };
    mr.start(250);
    const row = $('#inrow');
    r.hid = $$(':scope > *', row).filter((x) => !x.classList.contains('hidden')); // only hide what is visible, restore exactly that
    r.hid.forEach((x) => x.classList.add('hidden'));
    row.insertAdjacentHTML('beforeend', `<button class="icon-btn rec-ui" id="recX" title="Discard">🗑</button>
      <div class="rec-ui rec-bar"><i class="rec-dot"></i><b id="recT">0:00</b><span class="muted">Recording… click ➤ to send</span></div>
      <button class="icon-btn send-btn rec-ui" id="recSend" title="Send voice message">➤</button>`);
    r.timer = setInterval(() => { const el = $('#recT'); if (el) el.textContent = fmtClock(Date.now() - r.start); if (Date.now() - r.start > 5 * 60000) mr.stop(); }, 250);
    $('#recX').onclick = () => { r.cancel = true; mr.stop(); };
    $('#recSend').onclick = () => mr.stop();
  }

  // ---- images: compress like WhatsApp (max 1600px, JPEG 75%) ----
  function compressImage(file) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return resolve(file);
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        try {
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
          cv.toBlob((b) => resolve(!b || (b.size >= file.size && s === 1) ? file : new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.75);
        } catch { resolve(file); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function sendFiles(files) {
    if (!files.length) return;
    const ta = $('#composerText'); const caption = ta.value.trim();
    if (caption) { ta.value = ''; ta.style.height = 'auto'; }
    files.slice(0, 10).forEach((f, i) => sendMedia(f, 0, i === 0 ? caption : ''));
  }
  async function sendMedia(file, durationMs, caption, retry) {
    const ib = S.inbox; const convId = ib.openId;
    const clientId = retry ? retry.client_message_id : uid();
    const reply = retry ? retry._reply : takeReply();
    const local = retry || { id: 'tmp-' + clientId, client_message_id: clientId, sender_type: 'agent', message_type: 'text', content: caption || null,
      created_at: new Date().toISOString(), sender_name: S.me.display_name || S.me.name, reply_to: replyPreview(reply), _reply: reply, _file: file, _dur: durationMs,
      attachments: [{ mime_type: file.type || 'application/octet-stream', file_name: file.name, url: URL.createObjectURL(file), duration_ms: durationMs, file_size: file.size }] };
    local.pending = true; local.failed = false;
    upsertLocal(local);
    try {
      const f = /^image\//.test(file.type) ? await compressImage(file) : file;
      const fd = new FormData(); fd.append('conversation_id', convId);
      if (durationMs) fd.append('duration_ms', String(Math.round(durationMs)));
      fd.append('file', f, f.name);
      const att = await api('POST', '/uploads', fd, true);
      local._att = att;
      emitSend(local, { conversation_id: convId, content: caption || '', client_message_id: clientId, attachment_id: att.id, reply_to_id: reply ? reply.id : null, internal: false });
    } catch (e) { local.pending = false; local.failed = true; upsertLocal(local); toast(e.message, true); }
  }
  function retryMsg(cid) {
    const m = S.inbox.messages.find((x) => x.client_message_id === cid); if (!m) return;
    if (m._file && !m._att) return sendMedia(m._file, m._dur, m.content, m);
    m.pending = true; m.failed = false; upsertLocal(m);
    emitSend(m, { conversation_id: S.inbox.openId, content: m.content || '', client_message_id: cid, attachment_id: m._att ? m._att.id : null, reply_to_id: m._reply ? m._reply.id : null, internal: m.message_type === 'internal_note' });
  }

  function handleCanned(ta) {
    $('.canned-pop') && $('.canned-pop').remove();
    const m = ta.value.match(/(?:^|\s)\/([\w-]*)$/);
    if (!m) return;
    const qv = m[1].toLowerCase();
    const list = S.canned.filter((c) => c.shortcut.includes(qv) || c.title.toLowerCase().includes(qv)).slice(0, 8);
    if (!list.length) return;
    const pop = document.createElement('div'); pop.className = 'canned-pop';
    pop.innerHTML = list.map((c, i) => `<div class="${i === 0 ? 'sel' : ''}" data-id="${c.id}"><b>/${esc(c.shortcut)}</b> — ${esc(c.title)}<br><small class="muted">${esc(c.content.slice(0, 90))}</small></div>`).join('');
    $$('div', pop).forEach((d) => d.onclick = () => {
      const c = S.canned.find((x) => x.id === d.dataset.id);
      const name = (S.inbox.customer && (S.inbox.customer.name || S.inbox.customer.player_id)) || '';
      const text = c.content.replace(/\{\{\s*name\s*\}\}/g, name).replace(/\{\{\s*player_id\s*\}\}/g, S.inbox.customer ? S.inbox.customer.player_id : '').replace(/\{\{\s*agent\s*\}\}/g, S.me.display_name || S.me.name);
      ta.value = ta.value.replace(/\/([\w-]*)$/, text);
      pop.remove(); ta.focus(); ta.dispatchEvent(new Event('input'));
    });
    $('#composer').appendChild(pop);
  }
  function send() {
    const ib = S.inbox; const ta = $('#composerText');
    const content = ta.value.trim();
    if (!content) return;
    const clientId = uid();
    const internal = ib.mode === 'note';
    const reply = takeReply();
    ta.value = ''; ta.style.height = 'auto';
    const local = { id: 'tmp-' + clientId, client_message_id: clientId, sender_type: 'agent', message_type: internal ? 'internal_note' : 'text', content,
      created_at: new Date().toISOString(), sender_name: S.me.display_name || S.me.name, reply_to: replyPreview(reply), _reply: reply, attachments: [], pending: true };
    upsertLocal(local);
    emitSend(local, { conversation_id: ib.openId, content, client_message_id: clientId, attachment_id: null, reply_to_id: reply ? reply.id : null, internal });
  }
  function emitSend(local, payload) {
    S.socket.timeout(15000).emit('agent:message:send', payload, (err, r) => {
      if (err || !r.ok) {
        local.pending = false; local.failed = true; upsertLocal(local);
        toast(err ? 'Send timed out — click the message to retry' : r.error, true);
        return;
      }
      appendMessage(r.message);
    });
  }
  function upsertLocal(m) {
    const ib = S.inbox; const i = ib.messages.findIndex((x) => x.client_message_id === m.client_message_id);
    if (i >= 0) ib.messages[i] = m; else ib.messages.push(m);
    const box = $('#msgs'); if (!box) return;
    const el = $(`.msg[data-cid="${m.client_message_id}"]`, box);
    if (el) el.outerHTML = msgHtml(m);
    else { if ($('.empty', box)) box.innerHTML = ''; box.insertAdjacentHTML('beforeend', msgHtml(m)); box.scrollTop = box.scrollHeight; }
  }
  function renderChatHead() {
    const ib = S.inbox; const c = ib.conv; const h = $('#chatHead'); if (!h || !c) return;
    const agentOpts = S.agents.filter((a) => a.is_active).map((a) => `<option value="${a.id}" ${a.id === c.assigned_agent_id ? 'selected' : ''}>${esc(a.display_name || a.name)} ${a.presence === 'online' ? '🟢' : ''}</option>`).join('');
    const canAssignAny = can('supervisor');
    h.innerHTML = `
      <div class="av-wrap"><span class="avatar">${esc(initials(c.customer_name || c.player_id))}</span><span class="dot ${c.customer_online ? 'on' : ''}"></span></div>
      <div class="who"><b>${esc(c.player_id)}</b>${c.customer_name ? ' · ' + esc(c.customer_name) : ''}<br><small class="muted">${c.customer_online ? 'Online now' : 'Offline'} · started ${fmtDT(c.created_at)}${c.rating ? ' · ⭐ ' + c.rating : ''}</small></div>
      <select id="hStatus" title="Status">${['open', 'pending', 'resolved', 'closed'].map((s) => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="hPriority" title="Priority">${['low', 'normal', 'high', 'urgent'].map((s) => `<option ${s === c.priority ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${canAssignAny
        ? `<select id="hAssign" title="Assigned agent"><option value="">— Unassigned —</option>${agentOpts}</select>`
        : (c.assigned_agent_id ? `<small class="muted">👤 ${esc(c.agent_name)}</small>` : '<button class="btn sm" id="hClaim">Assign to me</button>')}
      ${c.assigned_agent_id === S.me.id || canAssignAny ? '<button class="btn sm" id="hTransfer">Transfer</button>' : ''}
      ${c.status === 'resolved' || c.status === 'closed' ? '<button class="btn sm" id="hReopen">Reopen</button>' : '<button class="btn sm primary" id="hResolve">✓ Resolve</button>'}
      <button class="btn sm" id="hProfile" title="Customer profile">👤</button>`;
    $('#hStatus').onchange = (e) => setConvStatus(e.target.value);
    $('#hPriority').onchange = (e) => tryDo(() => api('PATCH', `/conversations/${c.id}/priority`, { priority: e.target.value }));
    $('#hAssign') && ($('#hAssign').onchange = (e) => tryDo(() => api('PATCH', `/conversations/${c.id}/assign`, { agent_id: e.target.value || null })));
    $('#hClaim') && ($('#hClaim').onclick = () => tryDo(() => api('PATCH', `/conversations/${c.id}/assign`, { agent_id: S.me.id })));
    $('#hResolve') && ($('#hResolve').onclick = () => setConvStatus('resolved'));
    $('#hReopen') && ($('#hReopen').onclick = () => setConvStatus('open'));
    $('#hTransfer') && ($('#hTransfer').onclick = transferDialog);
    $('#hProfile').onclick = () => { $('#ibProfile').classList.toggle('hidden'); $('#inboxRoot').classList.toggle('no-profile', $('#ibProfile').classList.contains('hidden')); };
  }
  function setConvStatus(status) {
    const c = S.inbox.conv;
    S.socket.emit('agent:conversation:status', { conversation_id: c.id, status }, (r) => { if (!r.ok) toast(r.error, true); else { S.inbox.conv = { ...c, ...r.conversation }; renderChatHead(); } });
  }
  function transferDialog() {
    const c = S.inbox.conv;
    const opts = S.agents.filter((a) => a.is_active && a.id !== c.assigned_agent_id)
      .map((a) => `<option value="${a.id}">${esc(a.display_name || a.name)} — ${a.presence} (${a.active_chats}/${a.max_concurrent_chats})</option>`).join('');
    modal(`<h2>Transfer conversation</h2><form id="tf"><label>Transfer to<select name="agent_id" required>${opts}</select></label>
      <label>Note for the agent (optional)<textarea name="note" rows="3"></textarea></label>
      <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Transfer</button></div></form>`, (m) => {
      $('[data-x]', m).onclick = closeModal;
      $('#tf').onsubmit = async (e) => { e.preventDefault(); const ok = await tryDo(() => api('POST', `/conversations/${c.id}/transfer`, formData(e.target))); if (ok) { closeModal(); toast('Transferred'); await refreshLookups(); } };
    });
  }

  function msgHtml(m) {
    if (m.message_type === 'system') return `<div class="msg system" data-id="${m.id}">${esc(m.content)}</div>`;
    const note = m.message_type === 'internal_note';
    const cls = note ? 'note' : m.sender_type === 'customer' ? 'customer' : m.sender_type === 'system' ? 'note' : 'agent';
    const media = (m.attachments || []).length && !m.content;
    const atts = (m.attachments || []).map((a) => {
      if (a.mime_type.startsWith('image/')) return `<img src="${esc(a.thumb_url || a.url)}" data-full="${esc(a.url)}" alt="${esc(a.file_name)}" loading="lazy">`;
      if (a.mime_type.startsWith('audio/')) {
        const playing = player && player.src === a.url && !player.audio.paused;
        return `<div class="vn" data-src="${esc(a.url)}" data-dur="${a.duration_ms || 0}"><button class="vp" title="Play">${playing ? '⏸' : '▶'}</button>
          <div class="vt"><div class="vb"><i></i></div><span class="vd">${fmtClock(a.duration_ms)}</span></div><span class="vm">🎤</span>
          <a class="vdl" href="${esc(a.url)}" target="_blank" rel="noopener" title="Download">⬇</a></div>`;
      }
      return `<a class="file" href="${esc(a.url)}" target="_blank" rel="noopener">📄 ${esc(a.file_name)} <small class="muted">${fmtSize(a.file_size || 0)}</small></a>`;
    }).join('');
    const tick = m.sender_type === 'agent' && !note ? `<span class="tick ${m.read_at ? 'read' : ''}">${m.pending ? '🕓' : (m.delivered_at || m.read_at) ? '✓✓' : '✓'}</span>` : '';
    const who = note ? `🔒 ${esc(m.sender_name || 'System')} · internal note` : m.sender_type === 'agent' ? esc(m.sender_name || 'Agent') : '';
    const q = m.reply_to ? `<div class="quote" data-goto="${esc(m.reply_to.id)}"><b>${esc(m.reply_to.sender_type === 'customer' ? quoteName(m.reply_to) : (m.reply_to.sender_name || 'Agent'))}</b><span>${esc(m.reply_to.content || '')}</span></div>` : '';
    const canReply = m.id && !String(m.id).startsWith('tmp-');
    return `<div class="msg ${cls}${media ? ' media' : ''}${m.failed ? ' failed' : ''}" data-id="${m.id}" data-cid="${esc(m.client_message_id || '')}" title="${m.failed ? 'Click to retry' : ''}">` +
      `${canReply ? `<button class="reply-btn" data-reply="${m.id}" title="Reply">↩</button>` : ''}` +
      `${who ? `<div class="who">${who}</div>` : ''}${q}${m.meta && m.meta.type === 'request' ? requestCard(m.meta) : ''}${atts}` +
      `${m.content && !(m.meta && m.meta.type === 'request') ? `<div class="mtext">${esc(m.content)}</div>` : ''}` +
      `<div class="mt">${m.failed ? '<span style="color:var(--danger)">Not sent — click to retry</span>' : ''} ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${tick}</div></div>`;
  }
  // guided request from the widget (topic + the customer's answers)
  function requestCard(meta) {
    const rows = (meta.fields || []).map((f) => `<div class="rq-row"><span>${esc(f.label)}</span><b>${esc(f.value)}</b>
      <button class="rq-copy" data-copy="${esc(f.value)}" title="Copy">⧉</button></div>`).join('');
    return `<div class="rq-card"><div class="rq-head">📋 ${esc(meta.title || 'Request')}${meta.category ? `<small>${esc(meta.category)}</small>` : ''}</div>${rows}
      ${meta.photos ? `<div class="rq-row"><span>📷 Photos</span><b>${meta.photos}</b></div>` : ''}</div>`;
  }
  function renderMessages() {
    const box = $('#msgs'); if (!box) return;
    let lastDay = '';
    box.innerHTML = S.inbox.messages.map((m) => {
      const day = new Date(m.created_at).toDateString();
      const sep = day !== lastDay ? `<div class="day-sep">${new Date(m.created_at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>` : '';
      lastDay = day; return sep + msgHtml(m);
    }).join('') || '<div class="empty"><p>No messages yet</p></div>';
    box.scrollTop = box.scrollHeight;
  }
  function appendMessage(m) {
    const ib = S.inbox; const box = $('#msgs'); if (!box) return;
    if (m.client_message_id) {
      const i = ib.messages.findIndex((x) => x.client_message_id === m.client_message_id);
      if (i >= 0) {
        const old = ib.messages[i];
        if (!String(old.id).startsWith('tmp-') && old.id === m.id && !old.failed) return; // already have it
        ib.messages[i] = m;
        const el = $(`.msg[data-cid="${m.client_message_id}"]`, box);
        if (el) el.outerHTML = msgHtml(m); else renderMessages();
        return;
      }
    }
    if (m.id && ib.messages.some((x) => x.id === m.id)) return;
    ib.messages.push(m);
    const nearBottom = box.scrollTop + box.clientHeight > box.scrollHeight - 150;
    if ($('.empty', box)) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', msgHtml(m));
    if (nearBottom || m.sender_type === 'agent') box.scrollTop = box.scrollHeight;
  }

  function renderProfile() {
    const ib = S.inbox; const cu = ib.customer; const p = $('#ibProfile'); if (!p) return;
    const meta = cu.metadata && typeof cu.metadata === 'object' ? Object.entries(cu.metadata) : [];
    p.innerHTML = `
      <div class="section" style="text-align:center"><span class="avatar" style="width:56px;height:56px;font-size:18px">${esc(initials(cu.name || cu.player_id))}</span>
        <h3 style="margin-top:8px">${esc(cu.player_id)}</h3><div class="muted">${esc(cu.name || 'No name')}</div>${cu.is_blocked ? '<span class="badge urgent">Blocked</span>' : ''}</div>
      <div class="section">
        <div class="kv"><span>Player ID</span><span>${esc(cu.player_id)}</span></div>
        <div class="kv"><span>Name</span><span>${esc(cu.name || '—')}</span></div>
        <div class="kv"><span>Email</span><span>${esc(cu.email || '—')}</span></div>
        <div class="kv"><span>First seen</span><span>${fmtDT(cu.first_seen_at)}</span></div>
        <div class="kv"><span>Last seen</span><span>${fmtDT(cu.last_seen_at)}</span></div>
        <div class="kv"><span>Total chats</span><span>${cu.stats.total}</span></div>
        <div class="kv"><span>Open chats</span><span>${cu.stats.open}</span></div>
        ${meta.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`).join('')}
        <button class="btn sm" id="pEdit" style="margin-top:8px">Edit customer</button>
      </div>
      <div class="section"><h3>Tags</h3><div id="pTags" class="row wrap"></div>
        <div class="row" style="margin-top:8px"><input id="pTagIn" list="tagList" placeholder="Add tag…" /><datalist id="tagList">${S.tags.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist><button class="btn sm" id="pTagAdd">Add</button></div></div>
      <div class="section"><h3>Notes about customer</h3><textarea id="pNotes" rows="3" placeholder="Private notes (agents only)">${esc(cu.notes || '')}</textarea><button class="btn sm" id="pNotesSave">Save notes</button></div>
      <div class="section"><h3>Previous conversations</h3>${ib.previous.length ? ib.previous.map((x) => `<div class="prev-conv" data-id="${x.id}"><span class="badge ${x.status}">${x.status}</span> ${fmtDT(x.created_at)}<br><span class="muted">${esc((x.last_message_preview || '').slice(0, 60))}</span></div>`).join('') : '<p class="muted">None</p>'}</div>`;
    renderProfileTags();
    $('#pTagAdd').onclick = addTag;
    $('#pTagIn').onkeydown = (e) => { if (e.key === 'Enter') addTag(); };
    $('#pNotesSave').onclick = async () => { if (await tryDo(() => api('PATCH', `/customers/${cu.id}`, { notes: $('#pNotes').value }))) toast('Notes saved'); };
    $('#pEdit').onclick = () => editCustomer(cu, async () => { const d = await api('GET', '/conversations/' + ib.openId); ib.customer = d.customer; renderProfile(); });
    $$('.prev-conv', p).forEach((el) => el.onclick = () => openConversation(el.dataset.id));
    if (window.innerWidth > 1280) { p.classList.remove('hidden'); $('#inboxRoot').classList.remove('no-profile'); }
  }
  function renderProfileTags() {
    const box = $('#pTags'); if (!box || !S.inbox.conv) return;
    const tags = S.inbox.conv.tags || [];
    box.innerHTML = tags.length ? tags.map((t) => `<span class="tag" style="background:${esc(t.color)}">${esc(t.name)} <button data-id="${t.id}">✕</button></span>`).join('') : '<small class="muted">No tags</small>';
    $$('button', box).forEach((b) => b.onclick = () => tryDo(() => api('DELETE', `/conversations/${S.inbox.conv.id}/tags/${b.dataset.id}`)));
  }
  async function addTag() {
    const name = $('#pTagIn').value.trim(); if (!name) return;
    const existing = S.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const r = await tryDo(() => api('POST', `/conversations/${S.inbox.conv.id}/tags`, existing ? { tag_id: existing.id } : { name }));
    if (r) { $('#pTagIn').value = ''; S.inbox.conv = r.conversation; renderProfileTags(); if (!existing) S.tags = (await api('GET', '/tags')).items; }
  }
  function editCustomer(cu, after) {
    modal(`<h2>Edit customer ${esc(cu.player_id)}</h2><form id="ecf">
      <label>Name<input name="name" value="${esc(cu.name || '')}"></label>
      <label>Email<input name="email" value="${esc(cu.email || '')}"></label>
      <label>Custom attributes (JSON)<textarea name="metadata" rows="4">${esc(JSON.stringify(cu.metadata || {}, null, 2))}</textarea></label>
      ${can('supervisor') ? `<label class="check"><input type="checkbox" name="is_blocked" ${cu.is_blocked ? 'checked' : ''}> Block this customer (ends sessions, cannot chat)</label>` : ''}
      <div class="modal-actions">${can('supervisor') ? '<button type="button" class="btn danger" id="revoke">Log out all devices</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`, (m) => {
      $('[data-x]', m).onclick = closeModal;
      $('#revoke') && ($('#revoke').onclick = async () => { if (await tryDo(() => api('POST', `/customers/${cu.id}/revoke-sessions`))) toast('Sessions revoked'); });
      $('#ecf').onsubmit = async (e) => {
        e.preventDefault(); const f = e.target; let metadata;
        try { metadata = JSON.parse(f.metadata.value || '{}'); } catch { return toast('Custom attributes must be valid JSON', true); }
        const body = { name: f.name.value, email: f.email.value, metadata };
        if (f.is_blocked) body.is_blocked = f.is_blocked.checked;
        if (await tryDo(() => api('PATCH', `/customers/${cu.id}`, body))) { closeModal(); toast('Saved'); after && after(); }
      };
    });
  }

  // ============================================================
  // Customers
  // ============================================================
  async function pageCustomers(arg) {
    if (arg) return customerDetail(arg);
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Customers</h1><input id="cuSearch" placeholder="Search Player ID, name, email…" style="max-width:320px"></div>
      <div class="table-wrap"><table><thead><tr><th>Player ID</th><th>Name</th><th>Email</th><th>Chats</th><th>Open</th><th>Last seen</th><th></th></tr></thead><tbody id="cuBody"></tbody></table></div>
      <div class="row" style="margin-top:12px"><span id="cuInfo" class="muted"></span><span class="spacer"></span><button class="btn sm" id="cuPrev">← Prev</button><button class="btn sm" id="cuNext">Next →</button></div></div>`;
    let offset = 0; const limit = 50; let search = '';
    const load = async () => {
      const r = await api('GET', `/customers?limit=${limit}&offset=${offset}&search=${encodeURIComponent(search)}`);
      $('#cuBody').innerHTML = r.items.map((c) => `<tr class="click" data-id="${c.id}"><td><span class="dot ${c.online ? 'on' : ''}"></span> <b>${esc(c.player_id)}</b></td><td>${esc(c.name || '—')}</td><td>${esc(c.email || '—')}</td>
        <td>${c.total_conversations}</td><td>${c.open_conversations}</td><td>${fmtDT(c.last_seen_at)}</td><td>${c.is_blocked ? '<span class="badge urgent">blocked</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No customers yet</td></tr>';
      $('#cuInfo').textContent = `${r.total} customers`;
      $('#cuPrev').disabled = offset === 0; $('#cuNext').disabled = offset + limit >= r.total;
      $$('#cuBody tr.click').forEach((tr) => tr.onclick = () => { location.hash = '#/customers/' + tr.dataset.id; });
    };
    let st; $('#cuSearch').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { search = e.target.value.trim(); offset = 0; load(); }, 300); };
    $('#cuPrev').onclick = () => { offset = Math.max(0, offset - limit); load(); };
    $('#cuNext').onclick = () => { offset += limit; load(); };
    await load();
  }
  async function customerDetail(id) {
    const { customer: cu, conversations } = await api('GET', '/customers/' + id);
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1><a href="#/customers">Customers</a> / ${esc(cu.player_id)}</h1><button class="btn" id="cuEdit">Edit</button></div>
      <div class="grid g2"><div class="card"><h2>Profile</h2>
        <div class="kv"><span>Player ID</span><span>${esc(cu.player_id)}</span></div><div class="kv"><span>Name</span><span>${esc(cu.name || '—')}</span></div>
        <div class="kv"><span>Email</span><span>${esc(cu.email || '—')}</span></div><div class="kv"><span>Status</span><span>${cu.online ? '🟢 Online' : 'Offline'} ${cu.is_blocked ? '· <b style="color:var(--danger)">Blocked</b>' : ''}</span></div>
        <div class="kv"><span>First seen</span><span>${fmtDT(cu.first_seen_at)}</span></div><div class="kv"><span>Last seen</span><span>${fmtDT(cu.last_seen_at)}</span></div>
        ${Object.entries(cu.metadata || {}).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`).join('')}
        ${cu.notes ? `<h3 style="margin-top:12px">Notes</h3><div class="muted" style="white-space:pre-wrap">${esc(cu.notes)}</div>` : ''}</div>
      <div class="card"><h2>Conversations (${conversations.length})</h2>${conversations.map((c) => `<div class="prev-conv" data-id="${c.id}"><span class="badge ${c.status}">${c.status}</span> <span class="badge ${c.priority}">${c.priority}</span> ${fmtDT(c.created_at)} ${c.agent_name ? '· 👤 ' + esc(c.agent_name) : ''} ${c.rating ? '· ⭐' + c.rating : ''}<br><span class="muted">${esc((c.last_message_preview || '').slice(0, 90))}</span></div>`).join('') || '<p class="muted">None</p>'}</div></div></div>`;
    $$('.prev-conv').forEach((el) => el.onclick = () => { location.hash = '#/inbox/' + el.dataset.id; });
    $('#cuEdit').onclick = () => editCustomer(cu, () => customerDetail(id));
  }

  // ============================================================
  // Knowledge base
  // ============================================================
  async function pageKB() {
    let cats = (await api('GET', '/faq/categories')).items;
    let sel = cats[0] ? cats[0].id : null;
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Knowledge Base</h1><div class="row"><button class="btn" id="kbAnalytics">📈 FAQ analytics</button><button class="btn" id="kbAddCat">+ Category</button><button class="btn primary" id="kbAddFaq">+ Question</button></div></div>
      <div class="kb"><div class="card" style="padding:8px"><div id="kbCats"></div><small class="muted" style="display:block;padding:8px">Drag ⠿ to reorder</small></div><div id="kbFaqs"></div></div></div>`;
    const renderCats = () => {
      $('#kbCats').innerHTML = cats.map((c) => `<div class="cat-item ${c.id === sel ? 'active' : ''}" draggable="true" data-id="${c.id}"><span class="drag">⠿</span>${esc(c.title)} ${c.is_active ? '' : '<small class="muted">(hidden)</small>'}<span class="n">${c.faq_count}</span></div>`).join('') || '<p class="muted" style="padding:8px">No categories yet</p>';
      $$('#kbCats .cat-item').forEach((el) => el.onclick = () => { sel = el.dataset.id; renderCats(); loadFaqs(); });
      sortable($('#kbCats'), '.cat-item', (ids) => api('PUT', '/faq/reorder', { type: 'category', ids }).then(() => { cats = ids.map((id) => cats.find((c) => c.id === id)); }));
    };
    let faqs = [];
    const loadFaqs = async () => {
      if (!sel) { $('#kbFaqs').innerHTML = '<div class="card empty"><p>Create a category to start adding questions.</p></div>'; return; }
      faqs = (await api('GET', '/faq/questions?category_id=' + sel)).items;
      const cat = cats.find((c) => c.id === sel);
      $('#kbFaqs').innerHTML = `<div class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">${esc(cat.title)}</h2><span class="spacer"></span>
        <button class="btn sm" id="catEdit">Rename</button><button class="btn sm" id="catToggle">${cat.is_active ? 'Hide' : 'Show'}</button><button class="btn sm danger" id="catDel">Delete</button></div>
        <div id="faqList">${faqs.map((f) => `<div class="faq-item" draggable="true" data-id="${f.id}"><div class="row"><span class="drag">⠿</span><div class="q">${esc(f.question)}</div><span class="spacer"></span>
          ${f.is_active ? '' : '<span class="badge">hidden</span>'}<small class="muted">👁 ${f.views} · 👍 ${f.helpful} · 👎 ${f.not_helpful}</small><button class="btn sm" data-edit="${f.id}">Edit</button></div>
          ${(f.fields || []).length ? `<div class="kb-fields">📋 Asks for: ${(f.fields || []).map((x) => esc(x.name || x.label)).join(' · ')} <span class="badge ${f.priority || 'high'}">${esc(f.priority || 'high')}</span></div>` : (f.notify_agent ? '<div class="kb-fields">🔔 Notifies agents when opened</div>' : '')}
          <div class="a">${esc(f.answer)}</div></div>`).join('') || '<p class="muted">No questions in this category</p>'}</div></div>`;
      $('#catEdit').onclick = () => promptBox('Rename category', cat.title, async (v) => { await api('PATCH', '/faq/categories/' + cat.id, { title: v }); cat.title = v; renderCats(); loadFaqs(); });
      $('#catToggle').onclick = async () => { await tryDo(() => api('PATCH', '/faq/categories/' + cat.id, { is_active: !cat.is_active })); cat.is_active = !cat.is_active; renderCats(); loadFaqs(); };
      $('#catDel').onclick = async () => { if (!(await confirmBox(`Delete "${cat.title}" and all its questions?`))) return; await tryDo(() => api('DELETE', '/faq/categories/' + cat.id)); cats = cats.filter((c) => c.id !== cat.id); sel = cats[0] ? cats[0].id : null; renderCats(); loadFaqs(); };
      $$('[data-edit]').forEach((b) => b.onclick = () => faqForm(faqs.find((f) => f.id === b.dataset.edit)));
      sortable($('#faqList'), '.faq-item', (ids) => api('PUT', '/faq/reorder', { type: 'faq', ids }));
    };
    const faqForm = async (f) => {
      const all = (await api('GET', '/faq/questions')).items.filter((x) => !f || x.id !== f.id);
      const rel = f ? f.related_ids : [];
      modal(`<h2>${f ? 'Edit question' : 'New question'}</h2><form id="ff">
        <label>Category<select name="category_id">${cats.map((c) => `<option value="${c.id}" ${(f ? f.category_id : sel) === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        <label>Question<input name="question" required maxlength="500" value="${esc(f ? f.question : '')}"></label>
        <label>Answer / first message <small class="muted">(shown to the customer when they choose this question; optional if you collect details)</small>
          <textarea name="answer" rows="4">${esc(f ? f.answer : '')}</textarea></label>
        <div class="card fb-box">
          <div class="row"><h3 style="margin:0">📋 Details to collect</h3><span class="spacer"></span><button type="button" class="btn sm" id="fbAdd">+ Add question</button></div>
          <p class="muted" style="margin:4px 0 10px;font-size:12.5px">The customer is asked these one by one in the chat. When they send, an agent gets everything in one message with a notification.
            Leave empty for a normal answer-only question.</p>
          <div id="fbRows"></div>
          <div class="grid g2" style="margin-top:10px">
            <label>Chat priority<select name="priority">${['urgent', 'high', 'normal', 'low'].map((p) => `<option ${(f ? f.priority || 'high' : 'high') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
            <label class="check" style="margin-top:22px"><input type="checkbox" name="notify_agent" ${f && f.notify_agent ? 'checked' : ''}> Notify agents even with no details</label>
          </div>
          <label>Automatic reply after sending <small class="muted">(optional)</small><textarea name="auto_reply" rows="2" placeholder="✅ We received your request. An agent will reply here shortly.">${esc(f ? f.auto_reply || '' : '')}</textarea></label>
        </div>
        <label class="check"><input type="checkbox" name="is_active" ${!f || f.is_active ? 'checked' : ''}> Visible in widget</label>
        <label>Related questions <small class="muted">(Ctrl/Cmd-click to select several)</small><select name="related" multiple size="6">${all.map((x) => `<option value="${x.id}" ${rel.includes(x.id) ? 'selected' : ''}>${esc(x.category_title)} — ${esc(x.question)}</option>`).join('')}</select></label>
        <div class="modal-actions">${f ? '<button type="button" class="btn danger" id="fDel">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`, (m) => {
        $('[data-x]', m).onclick = closeModal;
        $('#modalCard').style.width = '720px';
        // ---- field builder
        const TYPES = [['player_id', 'Player ID'], ['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Amount / number'], ['phone', 'Mobile number'], ['select', 'Choice buttons'], ['image', 'Photo / screenshot']];
        let rows = (f && Array.isArray(f.fields) ? f.fields : []).map((x) => ({ ...x }));
        const drawRows = () => {
          $('#fbRows').innerHTML = rows.length ? rows.map((r, i) => `<div class="fb-row" data-i="${i}">
            <div class="fb-num">${i + 1}</div>
            <div class="fb-main">
              <input data-k="label" placeholder="Question asked to the customer" value="${esc(r.label || '')}">
              <div class="row" style="margin-top:6px">
                <select data-k="type">${TYPES.map(([v, l]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <input data-k="name" placeholder="Short name for agents (e.g. TrxID)" value="${esc(r.name || '')}">
                <label class="check" style="margin:0;white-space:nowrap"><input type="checkbox" data-k="required" ${r.required !== false ? 'checked' : ''}> Required</label>
              </div>
              ${r.type === 'select' ? `<textarea data-k="options" rows="2" placeholder="One choice per line, e.g. bKash" style="margin-top:6px;min-height:50px">${esc((r.options || []).join('\n'))}</textarea>` : ''}
            </div>
            <div class="fb-actions"><button type="button" class="btn sm" data-mv="-1" title="Move up">↑</button><button type="button" class="btn sm" data-mv="1" title="Move down">↓</button><button type="button" class="btn sm danger" data-rm title="Remove">✕</button></div>
          </div>`).join('') : '<p class="muted" style="margin:0">No details collected — this is an answer-only question.</p>';
          $$('#fbRows .fb-row').forEach((el) => {
            const i = +el.dataset.i;
            $$('[data-k]', el).forEach((inp) => {
              inp.oninput = inp.onchange = () => {
                const k = inp.dataset.k;
                rows[i][k] = k === 'required' ? inp.checked : k === 'options' ? inp.value.split('\n').map((o) => o.trim()).filter(Boolean) : inp.value;
                if (k === 'type') drawRows();
              };
            });
            $('[data-rm]', el).onclick = () => { rows.splice(i, 1); drawRows(); };
            $$('[data-mv]', el).forEach((b) => b.onclick = () => { const j = i + +b.dataset.mv; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j], rows[i]]; drawRows(); });
          });
        };
        $('#fbAdd').onclick = () => { rows.push({ label: '', type: rows.some((r) => r.type === 'player_id') ? 'text' : 'player_id', required: true }); drawRows(); };
        drawRows();
        $('#fDel') && ($('#fDel').onclick = async () => { if (await tryDo(() => api('DELETE', '/faq/questions/' + f.id))) { closeModal(); refresh(); } });
        $('#ff').onsubmit = async (e) => {
          e.preventDefault(); const fm = e.target;
          if (rows.some((r) => !String(r.label || '').trim())) return toast('Every detail needs a question text', true);
          if (!fm.answer.value.trim() && !rows.length) return toast('Write an answer, or add details to collect', true);
          const body = { category_id: fm.category_id.value, question: fm.question.value, answer: fm.answer.value, is_active: fm.is_active.checked,
            fields: rows.map((r) => ({ id: r.id, label: r.label, name: r.name, type: r.type || 'text', required: r.required !== false, options: r.options })),
            priority: fm.priority.value, notify_agent: fm.notify_agent.checked, auto_reply: fm.auto_reply.value };
          const saved = await tryDo(() => f ? api('PATCH', '/faq/questions/' + f.id, body) : api('POST', '/faq/questions', body));
          if (!saved) return;
          await tryDo(() => api('PUT', `/faq/questions/${saved.id}/related`, { ids: [...fm.related.selectedOptions].map((o) => o.value) }));
          closeModal(); toast('Saved'); refresh();
        };
      });
    };
    const refresh = async () => { cats = (await api('GET', '/faq/categories')).items; if (!cats.some((c) => c.id === sel)) sel = cats[0] ? cats[0].id : null; renderCats(); loadFaqs(); };
    $('#kbAddCat').onclick = () => promptBox('New category', '', async (v) => { const c = await api('POST', '/faq/categories', { title: v }); sel = c.id; refresh(); });
    $('#kbAddFaq').onclick = () => cats.length ? faqForm(null) : toast('Create a category first', true);
    $('#kbAnalytics').onclick = faqAnalytics;
    renderCats(); loadFaqs();
  }
  async function faqAnalytics() {
    const r = await api('GET', '/faq/analytics?days=30');
    modal(`<h2>FAQ analytics — last 30 days</h2><p class="muted">Widget FAQ opens: <b>${r.totals.widget_faq_opens}</b> · "Live chat" clicks: <b>${r.totals.live_chat_clicks}</b></p>
      <div class="table-wrap"><table><thead><tr><th>Question</th><th>Clicks</th><th>Views</th><th>👍</th><th>👎</th><th>→ Chat</th></tr></thead><tbody>
      ${r.items.map((x) => `<tr><td>${esc(x.question)}<br><small class="muted">${esc(x.category)}</small></td><td>${x.clicks}</td><td>${x.views}</td><td>${x.helpful}</td><td>${x.not_helpful}</td><td>${x.live_chat_clicks}</td></tr>`).join('')}</tbody></table></div>
      <div class="modal-actions"><button class="btn" data-x>Close</button></div>`, (m) => { $('[data-x]', m).onclick = closeModal; $('#modalCard').style.width = '760px'; });
  }
  function promptBox(title, value, onSave) {
    modal(`<h2>${esc(title)}</h2><form id="pf"><input name="v" required value="${esc(value)}" autofocus><div class="modal-actions" style="margin-top:12px"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`, (m) => {
      $('[data-x]', m).onclick = closeModal; $('input', m).focus();
      $('#pf').onsubmit = async (e) => { e.preventDefault(); if (await tryDo(async () => { await onSave(e.target.v.value.trim()); return true; })) closeModal(); };
    });
    $('#modalCard').style.width = '';
  }
  function sortable(container, itemSel, onDone) {
    let dragEl = null;
    $$(itemSel, container).forEach((el) => {
      el.addEventListener('dragstart', () => { dragEl = el; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragEl = null; onDone($$(itemSel, container).map((x) => x.dataset.id)).catch((e) => toast(e.message, true)); });
      el.addEventListener('dragover', (e) => {
        e.preventDefault(); if (!dragEl || dragEl === el) return;
        const r = el.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
        el.parentNode.insertBefore(dragEl, after ? el.nextSibling : el);
      });
    });
  }

  // ============================================================
  // Canned replies
  // ============================================================
  async function pageCanned() {
    S.canned = (await api('GET', '/canned-responses')).items;
    const edit = can('supervisor');
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Canned Replies</h1>${edit ? '<button class="btn primary" id="cnAdd">+ New reply</button>' : ''}</div>
      <p class="muted">Type <b>/shortcut</b> in the chat composer to insert. Variables: <code>{{name}}</code>, <code>{{player_id}}</code>, <code>{{agent}}</code></p>
      <div class="table-wrap"><table><thead><tr><th>Shortcut</th><th>Title</th><th>Content</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
      ${S.canned.map((c) => `<tr><td><b>/${esc(c.shortcut)}</b></td><td>${esc(c.title)}</td><td style="white-space:pre-wrap">${esc(c.content)}</td>${edit ? `<td class="row"><button class="btn sm" data-e="${c.id}">Edit</button><button class="btn sm danger" data-d="${c.id}">Delete</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="muted">No canned replies yet</td></tr>'}
      </tbody></table></div></div>`;
    const form = (c) => modal(`<h2>${c ? 'Edit' : 'New'} canned reply</h2><form id="cf">
      <label>Shortcut<input name="shortcut" required placeholder="greeting" value="${esc(c ? c.shortcut : '')}"></label>
      <label>Title<input name="title" required value="${esc(c ? c.title : '')}"></label>
      <label>Content<textarea name="content" rows="5" required>${esc(c ? c.content : '')}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`, (m) => {
      $('[data-x]', m).onclick = closeModal;
      $('#cf').onsubmit = async (e) => { e.preventDefault(); if (await tryDo(() => c ? api('PATCH', '/canned-responses/' + c.id, formData(e.target)) : api('POST', '/canned-responses', formData(e.target)))) { closeModal(); pageCanned(); } };
    });
    $('#cnAdd') && ($('#cnAdd').onclick = () => form(null));
    $$('[data-e]').forEach((b) => b.onclick = () => form(S.canned.find((c) => c.id === b.dataset.e)));
    $$('[data-d]').forEach((b) => b.onclick = async () => { if (await confirmBox('Delete this canned reply?')) { await tryDo(() => api('DELETE', '/canned-responses/' + b.dataset.d)); pageCanned(); } });
  }

  // ============================================================
  // Agents
  // ============================================================
  async function pageAgents() {
    await refreshLookups();
    let perf = [];
    if (can('supervisor')) perf = (await api('GET', '/agents/performance?days=30')).items;
    S.perf = perf;
    renderAgents();
  }
  function renderAgents() {
    const admin = can('admin');
    const perf = S.perf || [];
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Agents</h1>${admin ? '<button class="btn primary" id="agAdd">+ Add agent</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Role</th><th>Status</th><th>Active chats</th><th>Last seen</th>${perf.length ? '<th>Resolved (30d)</th><th>Avg 1st reply</th><th>Rating</th>' : ''}${admin ? '<th></th>' : ''}</tr></thead><tbody>
      ${S.agents.map((a) => { const p = perf.find((x) => x.id === a.id) || {}; return `<tr>
        <td><div class="row"><span class="avatar sm ${a.is_active ? '' : 'gray'}">${esc(initials(a.name))}</span><div><b>${esc(a.display_name || a.name)}</b><br><small class="muted">${esc(a.email)}</small></div></div></td>
        <td><span class="badge">${a.role}</span></td>
        <td>${a.is_active ? `<span class="badge ${a.presence}">${a.presence}</span>` : '<span class="badge">disabled</span>'}</td>
        <td>${a.active_chats} / ${a.max_concurrent_chats}</td><td>${fmtDT(a.last_seen_at)}</td>
        ${perf.length ? `<td>${p.resolved ?? '—'}</td><td>${fmtDur(p.avg_first_response_sec)}</td><td>${p.avg_rating ? '⭐ ' + p.avg_rating : '—'}</td>` : ''}
        ${admin ? `<td>${a.role !== 'owner' && a.id !== S.me.id && (a.role !== 'admin' || S.me.role === 'owner') ? `<button class="btn sm" data-e="${a.id}">Edit</button>` : ''}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>
      <div class="card" style="margin-top:16px"><h3>Roles</h3><p class="muted" style="margin:0"><b>Owner</b> — everything. <b>Admin</b> — team, settings, widget, audit logs. <b>Supervisor</b> — all chats, knowledge base, canned replies, analytics. <b>Agent</b> — unassigned chats and chats assigned to them.</p></div></div>`;
    const form = (a) => modal(`<h2>${a ? 'Edit agent' : 'Add agent'}</h2><form id="agf">
      <div class="grid g2"><label>Full name<input name="name" required value="${esc(a ? a.name : '')}"></label><label>Display name (shown to customers)<input name="display_name" value="${esc(a ? a.display_name || '' : '')}"></label></div>
      ${a ? '' : '<label>Email<input name="email" type="email" required></label>'}
      <label>${a ? 'New password (leave blank to keep)' : 'Password'}<input name="password" type="password" ${a ? '' : 'required'} minlength="8" autocomplete="new-password"></label>
      <div class="grid g2"><label>Role<select name="role">${['agent', 'supervisor', ...(S.me.role === 'owner' ? ['admin'] : [])].map((r) => `<option ${a && a.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Max concurrent chats<input name="max_concurrent_chats" type="number" min="1" max="100" value="${a ? a.max_concurrent_chats : 5}"></label></div>
      ${a ? `<label class="check"><input type="checkbox" name="is_active" ${a.is_active ? 'checked' : ''}> Account active</label>` : ''}
      <div class="modal-actions">${a ? '<button type="button" class="btn danger" id="agDel">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`, (m) => {
      $('[data-x]', m).onclick = closeModal;
      $('#agDel') && ($('#agDel').onclick = async () => { closeModal(); if (await confirmBox(`Delete ${a.name}? Their open chats return to the queue.`)) { await tryDo(() => api('DELETE', '/agents/' + a.id)); pageAgents(); } });
      $('#agf').onsubmit = async (e) => {
        e.preventDefault(); const d = formData(e.target);
        if (a) { d.is_active = e.target.is_active.checked; if (!d.password) delete d.password; }
        if (await tryDo(() => a ? api('PATCH', '/agents/' + a.id, d) : api('POST', '/agents', d))) { closeModal(); toast('Saved'); pageAgents(); }
      };
    });
    $('#agAdd') && ($('#agAdd').onclick = () => form(null));
    $$('[data-e]').forEach((b) => b.onclick = () => form(S.agents.find((x) => x.id === b.dataset.e)));
  }

  // ============================================================
  // Widget design
  // ============================================================
  async function pageWidget() {
    const st = await api('GET', '/settings');
    const w = st.widget;
    const inp = (k, label, type = 'text', extra = '') => `<label>${label}<input name="${k}" type="${type}" value="${esc(w[k])}" ${extra}></label>`;
    const chk = (k, label) => `<label class="check"><input type="checkbox" name="${k}" ${w[k] ? 'checked' : ''}> ${label}</label>`;
    $('#main').innerHTML = `<div class="page" style="max-width:1300px"><div class="page-head"><h1>Widget Design</h1></div>
      <div class="wp-wrap"><form id="wf">
        <div class="card"><h2>Text</h2>
          ${inp('title', 'Header title')}${inp('header_text', 'Header subtitle')}
          <label>Welcome message<textarea name="welcome_message" rows="2">${esc(w.welcome_message)}</textarea></label>
          <label>Offline message<textarea name="offline_message" rows="2">${esc(w.offline_message)}</textarea></label>
          ${inp('player_id_label', 'Player ID field label')}
          <label>Language<select name="language"><option value="en" ${w.language === 'en' ? 'selected' : ''}>English</option><option value="bn" ${w.language === 'bn' ? 'selected' : ''}>বাংলা</option></select></label></div>
        <div class="card"><h2>Look</h2>
          <div class="grid g2">${inp('primary_color', 'Primary color', 'color')}${inp('secondary_color', 'Secondary color', 'color')}</div>
          ${inp('logo_url', 'Logo URL (https://…)', 'url')}
          <div class="grid g2"><label>Launcher icon<select name="launcher_icon">${['chat', 'help', 'headset'].map((x) => `<option ${w.launcher_icon === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Position<select name="position"><option value="right" ${w.position === 'right' ? 'selected' : ''}>Bottom right</option><option value="left" ${w.position === 'left' ? 'selected' : ''}>Bottom left</option></select></label></div>
          <div class="grid g2">${inp('width', 'Width (px)', 'number', 'min="300" max="600"')}${inp('height', 'Height (px)', 'number', 'min="400" max="900"')}</div></div>
        <div class="card"><h2>Behaviour</h2>
          ${chk('show_faq', 'Show FAQ / knowledge base on the home screen')}
          ${chk('require_player_id', 'Require Player ID before live chat')}
          ${chk('show_launcher', 'Show floating launcher button')}
          ${chk('enable_attachments', 'Allow customers to send files/images')}
          ${chk('enable_rating', 'Ask for a rating when a chat is resolved')}</div>
        <button class="btn primary">Save widget</button></form>
        <div><div class="wp-frame"><iframe id="wpFrame" src="/demo?preview=1"></iframe></div><small class="muted">Live preview — saves update it</small></div></div></div>`;
    $('#wf').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const d = formData(f);
      ['show_faq', 'require_player_id', 'show_launcher', 'enable_attachments', 'enable_rating'].forEach((k) => { d[k] = f[k].checked; });
      if (await tryDo(() => api('PUT', '/settings/widget', d))) { toast('Widget saved'); $('#wpFrame').contentWindow.location.reload(); }
    };
  }

  // ============================================================
  // Settings
  // ============================================================
  async function pageSettings() {
    const st = await api('GET', '/settings');
    const g = st.general, bh = st.business_hours, sec = st.security;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const sampleHash = `// On your website's server (Node.js example)\nconst crypto = require('crypto');\nconst hash = crypto.createHmac('sha256', IDENTITY_SECRET).update(playerId).digest('hex');\n\n<!-- then in your page -->\n<script src="${location.origin}/widget.js"\n  data-player-id="PLAYER_ID" data-player-hash="HASH"\n  data-name="Customer name" async></script>`;
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Settings</h1></div>
      <div class="card"><h2>Embed code</h2><p class="muted">Paste this before <code>&lt;/body&gt;</code> on every page where the chat should appear.</p>
        <div class="code" id="snip">${esc(st.embed_snippet)}</div><button class="btn sm" id="copySnip" style="margin-top:8px">Copy</button>
        <p class="muted" style="margin-top:12px">Optional attributes: <code>data-player-id</code> (auto-fill/skip the Player ID form), <code>data-player-hash</code> (verified identity), <code>data-name</code>, <code>data-email</code>, <code>data-open="true"</code> (open on load). JS API: <code>LiveSupport.open()</code>, <code>LiveSupport.close()</code>, <code>LiveSupport.identify({player_id, name, email, hash})</code>.</p></div>
      <form id="gf" class="card"><h2>General</h2>
        <label>Company name<input name="company_name" value="${esc(g.company_name)}"></label>
        <label class="check"><input type="checkbox" name="auto_assign" ${g.auto_assign ? 'checked' : ''}> Auto-assign new chats to the least busy online agent</label>
        <label class="check"><input type="checkbox" name="sound_notifications" ${g.sound_notifications ? 'checked' : ''}> Sound notifications in the inbox</label>
        <label>Reopen a resolved chat if the customer replies within (hours) — after that a new chat is created<input name="reopen_resolved_within_hours" type="number" min="0" max="720" value="${g.reopen_resolved_within_hours}"></label>
        <button class="btn primary">Save general</button></form>
      <form id="bf" class="card"><h2>Business hours</h2>
        <label class="check"><input type="checkbox" name="enabled" ${bh.enabled ? 'checked' : ''}> Enable business hours (outside these hours the widget shows the offline message)</label>
        <label>Timezone<input name="timezone" value="${esc(bh.timezone)}" placeholder="Asia/Dhaka"></label>
        <table><tbody>${days.map((d, i) => { const x = bh.days[i] || bh.days[String(i)] || { enabled: false, open: '09:00', close: '18:00' }; return `<tr><td><label class="check" style="margin:0"><input type="checkbox" name="d${i}_on" ${x.enabled ? 'checked' : ''}> ${d}</label></td>
          <td><input type="time" name="d${i}_open" value="${esc(x.open)}"></td><td><input type="time" name="d${i}_close" value="${esc(x.close)}"></td></tr>`; }).join('')}</tbody></table>
        <button class="btn primary" style="margin-top:12px">Save business hours</button></form>
      ${sec ? `<form id="sf" class="card"><h2>Security</h2>
        <label>Allowed website domains — one per line. Use <code>*.example.com</code> for subdomains. <b>Leave empty to allow any site (not recommended in production).</b>
          <textarea name="allowed_domains" rows="4" placeholder="example.com\nwww.example.com">${esc((sec.allowed_domains || []).join('\n'))}</textarea></label>
        <label>Identity verification secret (optional) — when set, sites can pass a signed Player ID so returning customers get their full chat history on any device.
          <div class="row"><input name="identity_secret" value="${esc(sec.identity_secret)}" placeholder="not set"><button type="button" class="btn" id="genSecret">Generate</button></div></label>
        <details><summary class="muted">How to sign a Player ID</summary><div class="code" style="margin-top:8px">${esc(sampleHash)}</div></details>
        <p class="muted">Without verification, a Player ID is treated as an identifier only: a new browser can start a chat, but cannot read earlier chats from other devices.</p>
        <button class="btn primary">Save security</button></form>` : ''}</div>`;
    $('#copySnip').onclick = () => { navigator.clipboard.writeText(st.embed_snippet); toast('Copied'); };
    $('#gf').onsubmit = async (e) => { e.preventDefault(); const f = e.target;
      if (await tryDo(() => api('PUT', '/settings/general', { company_name: f.company_name.value, auto_assign: f.auto_assign.checked, sound_notifications: f.sound_notifications.checked, reopen_resolved_within_hours: f.reopen_resolved_within_hours.value }))) { toast('Saved'); S.sound = f.sound_notifications.checked; $('#companyName').textContent = f.company_name.value; } };
    $('#bf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; const dd = {};
      for (let i = 0; i < 7; i++) dd[i] = { enabled: f[`d${i}_on`].checked, open: f[`d${i}_open`].value || '09:00', close: f[`d${i}_close`].value || '18:00' };
      if (await tryDo(() => api('PUT', '/settings/business_hours', { enabled: f.enabled.checked, timezone: f.timezone.value.trim(), days: dd }))) toast('Saved'); };
    if (sec) {
      $('#genSecret').onclick = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); $('#sf').identity_secret.value = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };
      $('#sf').onsubmit = async (e) => { e.preventDefault(); const f = e.target;
        if (await tryDo(() => api('PUT', '/settings/security', { allowed_domains: f.allowed_domains.value.split(/[\s,]+/).filter(Boolean), identity_secret: f.identity_secret.value.trim() }))) toast('Saved'); };
    }
  }

  // ============================================================
  // Analytics
  // ============================================================
  async function pageAnalytics(arg) {
    const days = parseInt(arg, 10) || 7;
    const r = await api('GET', '/analytics?days=' + days);
    const max = Math.max(1, ...r.daily.map((d) => Math.max(d.created, d.resolved)));
    const hourMax = Math.max(1, ...r.by_hour.map((h) => h.count));
    const hours = Array.from({ length: 24 }, (_, h) => (r.by_hour.find((x) => x.hour === h) || { count: 0 }).count);
    const t = r.totals;
    const k = (label, value) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`;
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Analytics</h1><div class="row">${[7, 30, 90].map((d) => `<a class="btn sm ${d === days ? 'primary' : ''}" href="#/analytics/${d}">${d} days</a>`).join('')}</div></div>
      <div class="grid g4">${k('Conversations', t.conversations)}${k('Resolved', t.resolved)}${k('Avg first response', fmtDur(t.avg_first_response_sec))}${k('Avg resolution time', fmtDur(t.avg_resolution_sec))}
        ${k('Customers', t.customers)}${k('Satisfaction', t.avg_rating ? t.avg_rating + ' / 5' : '—')}${k('Ratings received', t.ratings)}${k('Open now', (r.by_status.find((x) => x.status === 'open') || { count: 0 }).count)}</div>
      <div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">Conversations per day</h2><span class="spacer"></span><div class="legend"><span><i style="background:var(--pri)"></i>Created</span><span><i style="background:#93c5fd"></i>Resolved</span></div></div>
        <div class="bars">${r.daily.map((d) => `<div class="b" title="${d.day}: ${d.created} created, ${d.resolved} resolved"><div class="pair"><div class="col" style="height:${(d.created / max) * 100}%"></div><div class="col alt" style="height:${(d.resolved / max) * 100}%"></div></div><small>${days <= 31 ? d.day.slice(5) : ''}</small></div>`).join('')}</div></div>
      <div class="grid g2"><div class="card"><h2>Busiest hours</h2><div class="bars" style="height:120px">${hours.map((c, h) => `<div class="b" title="${h}:00 — ${c} chats"><div class="col" style="height:${(c / hourMax) * 100}%"></div><small>${h % 3 === 0 ? h : ''}</small></div>`).join('')}</div></div>
      <div class="card"><h2>By priority</h2>${['urgent', 'high', 'normal', 'low'].map((p) => `<div class="kv"><span><span class="badge ${p}">${p}</span></span><span>${(r.by_priority.find((x) => x.priority === p) || { count: 0 }).count}</span></div>`).join('')}
        <h2 style="margin-top:16px">By status (all time)</h2>${r.by_status.map((s) => `<div class="kv"><span><span class="badge ${s.status}">${s.status}</span></span><span>${s.count}</span></div>`).join('')}</div></div>
      <div class="card"><h2>Agent performance</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Handled</th><th>Resolved</th><th>Replies</th><th>Avg 1st response</th><th>Rating</th><th>Active now</th></tr></thead><tbody>
        ${r.agents.map((a) => `<tr><td><b>${esc(a.name)}</b> <span class="badge ${a.presence}">${a.presence}</span></td><td>${a.handled}</td><td>${a.resolved}</td><td>${a.replies}</td><td>${fmtDur(a.avg_first_response_sec)}</td><td>${a.avg_rating ? '⭐ ' + a.avg_rating : '—'}</td><td>${a.active_chats}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }

  // ============================================================
  // Audit logs
  // ============================================================
  async function pageAudit() {
    $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>Audit Logs</h1></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody id="alBody"></tbody></table></div>
      <button class="btn" id="alMore" style="margin-top:12px">Load more</button></div>`;
    let before = null;
    const load = async () => {
      const r = await api('GET', '/audit-logs?limit=50' + (before ? '&before=' + before : ''));
      $('#alBody').insertAdjacentHTML('beforeend', r.items.map((l) => `<tr><td>${fmtDT(l.created_at)}</td><td>${esc(l.actor_name || '—')}</td><td><code>${esc(l.action)}</code></td><td><small>${esc(JSON.stringify(l.metadata))}</small></td><td><small>${esc(l.ip || '')}</small></td></tr>`).join(''));
      before = r.next_before; $('#alMore').classList.toggle('hidden', !before);
    };
    $('#alMore').onclick = load;
    await load();
  }

  // ============================================================
  // Profile
  // ============================================================
  async function pageProfile() {
    const me = (await api('GET', '/auth/me')).user;
    $('#main').innerHTML = `<div class="page" style="max-width:640px"><div class="page-head"><h1>My profile</h1></div>
      <form id="prf" class="card"><h2>Profile</h2><label>Full name<input name="name" required value="${esc(me.name)}"></label>
        <label>Display name (customers see this)<input name="display_name" value="${esc(me.display_name || '')}"></label>
        <label>Email<input value="${esc(me.email)}" disabled></label><button class="btn primary">Save</button></form>
      <form id="pwf" class="card"><h2>Change password</h2><label>Current password<input name="current_password" type="password" required autocomplete="current-password"></label>
        <label>New password (min 8 characters)<input name="new_password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn primary">Change password</button></form>
      <div class="card"><h2>Sessions</h2><p class="muted">Sign out of every browser where you are logged in.</p><button class="btn danger" id="logoutAll">Log out everywhere</button></div></div>`;
    $('#prf').onsubmit = async (e) => { e.preventDefault(); if (await tryDo(() => api('PATCH', '/auth/profile', formData(e.target)))) { toast('Saved'); const d = formData(e.target); $('#meName').textContent = d.display_name || d.name; } };
    $('#pwf').onsubmit = async (e) => { e.preventDefault(); if (await tryDo(() => api('POST', '/auth/change-password', formData(e.target)))) { toast('Password changed'); e.target.reset(); connectSocket(); } };
    $('#logoutAll').onclick = async () => { if (await confirmBox('Log out of all devices?')) { await api('POST', '/auth/logout-all').catch(() => {}); showLogin(); } };
  }

  boot();
})();
