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
  // data-fullscreen="true": chat fills the whole page (used by /chat and in-app WebViews)
  // data-launcher-image="URL": use your own round logo as the chat bubble
  var FULL = DATA.fullscreen === 'true';
  var LAUNCH_IMG = DATA.launcherImage || '';
  var LS_KEY = 'lsd_session_' + BASE;

  var T = {
    en: { search: 'Search for answers…', faq: 'Frequently asked questions', live: 'Start live chat', liveSub: 'Talk to our support team', back: 'Back', helpful: 'Was this helpful?', yes: 'Yes', no: 'No', thanks: 'Thanks for your feedback!',
      related: 'Related questions', more: 'More questions', stillHelp: 'Still need help?', enterId: 'Please enter your {label} to continue.', cont: 'Continue', welcome: 'Welcome to Live Support!',
      type: 'Type a message…', online: 'We are online', offline: 'We are offline', noResult: 'No matching questions', resolved: 'This chat has been resolved.', rate: 'How was your experience?', rated: 'Thank you for rating us!',
      newChat: 'Start a new chat', typing: 'is typing…', failed: 'Not sent — tap to retry', attach: 'Attach file', sending: 'Sending…', error: 'Something went wrong. Please try again.', name: 'Your name (optional)', history: 'Your conversations', poweredBy: 'Live Support', you: 'You', agent: 'Support', reply: 'Reply', voice: 'Voice message', photo: 'Photo', recording: 'Recording…', noMic: 'Microphone not available (needs HTTPS and permission).',
      helpTopics: 'Help topics', chooseTopic: 'Choose what you need help with, or type your message below.', solved: 'Solved, thanks', talkAgent: 'Talk to an agent', addPhoto: 'Add photo', skip: 'Skip', cancel: 'Cancel', optional: 'optional', checkDetails: 'Please check your details:', sendReq: 'Send to support', edit: 'Edit', badNumber: 'Please enter a valid amount (numbers only).', badPhone: 'Please enter a valid mobile number (01XXXXXXXXX).', badId: 'That ID does not look right. Please check and type it again.', pickOption: 'Please choose one of the buttons below.', useButtons: 'Please use the buttons below.', required: 'This is required.' },
    bn: { search: 'উত্তর খুঁজুন…', faq: 'সাধারণ প্রশ্নাবলি', live: 'লাইভ চ্যাট শুরু করুন', liveSub: 'আমাদের সাপোর্ট টিমের সাথে কথা বলুন', back: 'পেছনে', helpful: 'এটি কি সাহায্য করেছে?', yes: 'হ্যাঁ', no: 'না', thanks: 'মতামতের জন্য ধন্যবাদ!',
      related: 'সম্পর্কিত প্রশ্ন', more: 'আরও প্রশ্ন', stillHelp: 'আরও সাহায্য লাগবে?', enterId: 'চালিয়ে যেতে আপনার {label} দিন।', cont: 'চালিয়ে যান', welcome: 'লাইভ সাপোর্টে স্বাগতম!',
      type: 'মেসেজ লিখুন…', online: 'আমরা অনলাইনে আছি', offline: 'আমরা এখন অফলাইনে', noResult: 'কোনো প্রশ্ন পাওয়া যায়নি', resolved: 'চ্যাটটি সমাধান করা হয়েছে।', rate: 'আপনার অভিজ্ঞতা কেমন ছিল?', rated: 'রেটিং দেওয়ার জন্য ধন্যবাদ!',
      newChat: 'নতুন চ্যাট শুরু করুন', typing: 'লিখছেন…', failed: 'পাঠানো যায়নি — আবার চেষ্টা করুন', attach: 'ফাইল যুক্ত করুন', sending: 'পাঠানো হচ্ছে…', error: 'সমস্যা হয়েছে। আবার চেষ্টা করুন।', name: 'আপনার নাম (ঐচ্ছিক)', history: 'আপনার কথোপকথন', poweredBy: 'লাইভ সাপোর্ট', you: 'আপনি', agent: 'সাপোর্ট', reply: 'উত্তর দিন', voice: 'ভয়েস মেসেজ', photo: 'ছবি', recording: 'রেকর্ড হচ্ছে…', noMic: 'মাইক্রোফোন পাওয়া যায়নি (HTTPS ও অনুমতি লাগবে)।',
      helpTopics: 'সাহায্যের বিষয়', chooseTopic: 'কোন বিষয়ে সাহায্য লাগবে বেছে নিন, অথবা নিচে মেসেজ লিখুন।', solved: 'সমাধান হয়েছে, ধন্যবাদ', talkAgent: 'এজেন্টের সাথে কথা বলুন', addPhoto: 'ছবি দিন', skip: 'এড়িয়ে যান', cancel: 'বাতিল', optional: 'ঐচ্ছিক', checkDetails: 'আপনার তথ্যগুলো একবার দেখে নিন:', sendReq: 'সাপোর্টে পাঠান', edit: 'আবার লিখুন', badNumber: 'সঠিক পরিমাণ লিখুন (শুধু সংখ্যা)।', badPhone: 'সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।', badId: 'আইডিটি সঠিক মনে হচ্ছে না। আবার দেখে লিখুন।', pickOption: 'নিচের বোতাম থেকে একটি বেছে নিন।', useButtons: 'নিচের বোতাম ব্যবহার করুন।', required: 'এটি দিতেই হবে।' },
  };

  var cfg = null, t = T.en, root, shadow, panel, launcher, badge;
  var state = { open: false, screen: 'chat', session: null, conv: null, messages: [], socket: null, unread: 0, online: false, faqCache: null, replyTo: null, rated: {} };
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
      '.ls-launch.img{background:transparent;padding:0;overflow:visible}.ls-launch.img img{width:64px;height:64px;border-radius:50%;display:block;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}' +
      '.ls-launch.img{width:64px;height:64px}' +
      (FULL ? '.ls-panel,.ls-panel.open{top:0;left:0;right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0;box-shadow:none;transform:none;opacity:1;pointer-events:auto}[data-close]{display:none!important}' : '') +
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
      '.mw{display:flex;align-items:center;gap:4px;max-width:86%;transition:transform .15s}.mw.c{align-self:flex-end;flex-direction:row-reverse}.mw.a{align-self:flex-start}.mw .m{max-width:100%}' +
      '.mw.hl .m{box-shadow:0 0 0 3px ' + p + '66}' +
      '.rp{opacity:0;border:0;background:#e2e8f0;color:#334155;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:13px;flex-shrink:0;transition:opacity .15s}.mw:hover .rp,.rp:focus{opacity:1}' +
      '@media(hover:none){.rp{display:none}}' +
      '.qt{border-left:3px solid ' + p + ';background:rgba(0,0,0,.06);border-radius:6px;padding:4px 8px;margin:2px 0 4px;cursor:pointer;font-size:12.5px;display:flex;flex-direction:column;min-width:0}' +
      '.m.c .qt{background:rgba(255,255,255,.2);border-left-color:#fff}' +
      '.qt b{font-size:12px;color:' + p + '}.m.c .qt b{color:#fff}.qt span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85;max-width:240px}' +
      '.m.media{padding:4px}.m.media .tm{padding:0 6px 2px}.m .ph{display:block;max-width:240px;max-height:260px;width:auto;border-radius:10px;cursor:zoom-in;background:#e2e8f0;min-width:80px;min-height:60px;object-fit:cover}' +
      '.m .tx{padding:0}.m.media .tx{padding:4px 6px 0}' +
      '.vn{display:flex;align-items:center;gap:8px;min-width:200px;padding:4px 4px 0}' +
      '.vp{width:36px;height:36px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + p + '}.vp svg{width:18px;height:18px;fill:#fff}' +
      '.m.c .vp{background:#fff}.m.c .vp svg{fill:' + p + '}' +
      '.vt{flex:1;display:flex;flex-direction:column;gap:3px}.vb{height:6px;border-radius:3px;background:rgba(0,0,0,.15);cursor:pointer;position:relative;overflow:hidden}.m.c .vb{background:rgba(255,255,255,.35)}' +
      '.vb i{position:absolute;left:0;top:0;bottom:0;width:0;background:' + p + ';border-radius:3px}.m.c .vb i{background:#fff}.vd{font-size:11px;opacity:.8}.vm{font-size:16px}' +
      '.rbar{display:flex;align-items:center;gap:6px;padding:6px 10px 0;background:#fff;border-top:1px solid #e2e8f0}.rbar .qt{flex:1;margin:0;cursor:default}' +
      '.recb{flex:1;display:flex;align-items:center;gap:8px;padding:0 6px;font-size:14px;color:#dc2626}.recb small{color:#64748b}' +
      '.recb .dot{width:10px;height:10px;border-radius:50%;background:#dc2626;animation:lsblink 1s infinite}@keyframes lsblink{50%{opacity:.2}}' +
      '.lb{position:absolute;inset:0;background:rgba(0,0,0,.88);z-index:5;align-items:center;justify-content:center}.lb img{max-width:96%;max-height:92%;border-radius:6px}.lb .x{position:absolute;top:12px;right:12px}' +
      '.ib.snd svg{width:20px;height:20px}' +
      '.m.bot{max-width:86%}.m.bot.err{background:#fef2f2;color:#991b1b}.m.bot .tx{white-space:pre-wrap}' +
      '.chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:92%;margin:2px 0 4px}' +
      '.chip-b{border:1.5px solid ' + p + ';color:' + p + ';background:#fff;border-radius:18px;padding:7px 13px;font-size:13.5px;cursor:pointer;text-align:left;line-height:1.3;transition:all .15s}' +
      '.chip-b:hover{background:' + p + ';color:#fff}.chip-b:disabled{opacity:.55;cursor:default}' +
      '.chip-b.pri{background:' + p + ';color:#fff}.chip-b.ghost{border-color:#cbd5e1;color:#64748b}.chip-b.ghost:hover{background:#f1f5f9;color:#334155}' +
      '.sum{margin-top:6px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}.sum .st{background:#f1f5f9;padding:6px 10px;font-weight:700;font-size:13px}' +
      '.sum .sr{display:flex;justify-content:space-between;gap:10px;padding:5px 10px;border-top:1px solid #f1f5f9;font-size:13px}.sum .sr span{color:#64748b}.sum .sr b{text-align:right;word-break:break-all}' +
      '.m .rq{border-left:3px solid #f59e0b;padding-left:8px}.m.c .rq{border-left-color:#fde68a}' +
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
      setLauncher(false);
      badge = document.createElement('span'); badge.className = 'ls-badge'; badge.style.display = 'none'; launcher.appendChild(badge);
      launcher.onclick = toggle;
      if (cfg.show_launcher && !FULL) wrap.appendChild(launcher);
      if (FULL) wrap.className = 'no-launcher';
      panel = document.createElement('div'); panel.className = 'ls-panel'; panel.setAttribute('role', 'dialog');
      wrap.appendChild(panel);

      // data-player-id: identify silently (switch identity if another player was stored)
      if (DATA.playerId && (!state.session || state.session.player_id !== DATA.playerId)) {
        identify({ player_id: DATA.playerId, hash: DATA.playerHash, name: DATA.name, email: DATA.email }, true);
      }
      if (state.session) checkSession();
      render();
      if (FULL || DATA.open === 'true' || /[?&]preview=1/.test(location.search)) open();
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
  function setLauncher(isOpen) {
    var img = LAUNCH_IMG && /^(https?:)?\/\/|^\//.test(LAUNCH_IMG);
    launcher.classList.toggle('img', !!img && !isOpen);
    launcher.innerHTML = isOpen ? ICONS.close : (img ? '<img alt="Support" src="' + esc(LAUNCH_IMG) + '">' : (ICONS[cfg.launcher_icon] || ICONS.chat));
    if (badge) launcher.appendChild(badge);
  }
  function open() {
    state.open = true; panel.classList.add('open');
    setLauncher(true);
    state.unread = 0; updateBadge();
    if (state.screen === 'chat') { scrollBottom(); markRead(); var ta = $('textarea'); ta && ta.focus(); }
  }
  function close() {
    if (FULL) return;
    state.open = false; panel.classList.remove('open');
    setLauncher(false);
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
        .catch(function (err) { var el = $('#ls-err'); if (el) el.textContent = err.message; btn.disabled = false; });
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

  // ---------------------------------------------------------- guided help (bot)
  // The chat opens straight away. Topic buttons start a short step-by-step form; the answers are
  // sent to the agents as one detailed request. Anything typed outside a form is normal live chat.
  var bot = { showMenu: true, menuCat: null, flow: null, needId: false, pendingText: null, err: null };

  function loadTopics() {
    if (state.faqCache) return Promise.resolve(state.faqCache);
    return api('GET', '/faqs').then(function (r) { state.faqCache = r; drawMessages(); return r; }).catch(function () { return { categories: [] }; });
  }
  function topicCats() { return ((state.faqCache && state.faqCache.categories) || []).filter(function (c) { return c.faqs && c.faqs.length; }); }

  function botBubble(html, cls) { return '<div class="m a bot' + (cls ? ' ' + cls : '') + '"><div class="nm">' + esc(state.company || t.agent) + '</div>' + html + '</div>'; }
  function chips(list) {
    return '<div class="chips">' + list.map(function (c) {
      return '<button class="chip-b' + (c.cls ? ' ' + c.cls : '') + '" data-bot="' + esc(c.act) + '"' + (c.arg != null ? ' data-arg="' + esc(c.arg) + '"' : '') + (c.disabled ? ' disabled' : '') + '>' + esc(c.label) + '</button>';
    }).join('') + '</div>';
  }

  function botHtml() {
    var h = '';
    var f = bot.flow;
    if (f) {
      f.log.forEach(function (l) {
        if (l.from === 'me') h += '<div class="mw c"><div class="m c' + (l.img ? ' media' : '') + '">' + (l.img ? '<img class="ph" src="' + esc(l.img) + '" data-full="' + esc(l.img) + '" alt="">' : '<div class="tx">' + esc(l.text) + '</div>') + '</div></div>';
        else h += botBubble('<div class="tx">' + linkify(l.text) + '</div>', l.err ? 'err' : '');
      });
      if (f.info) {
        h += chips([{ act: 'solved', label: '✅ ' + t.solved }, { act: 'agent', label: '💬 ' + t.talkAgent }]);
      } else if (f.i < f.fields.length) {
        var cur = f.fields[f.i];
        var list = [];
        if (cur.type === 'select') (cur.options || []).forEach(function (o) { list.push({ act: 'opt', arg: o, label: o }); });
        if (cur.type === 'image') list.push({ act: 'photo', label: '📷 ' + t.addPhoto, cls: 'pri' });
        if (!cur.required && cur.type !== 'player_id') list.push({ act: 'skip', label: t.skip });
        list.push({ act: 'cancel', label: '✖ ' + t.cancel, cls: 'ghost' });
        h += chips(list);
      } else {
        var rows = f.fields.filter(function (x) { return x.type !== 'image' && x.id !== '__pid' && f.answers[x.id]; })
          .map(function (x) { return '<div class="sr"><span>' + esc(x.name || String(x.label).replace(/\s*[?？]\s*$/, '')) + '</span><b>' + esc(f.answers[x.id]) + '</b></div>'; }).join('');
        h += botBubble('<div class="tx"><b>' + esc(t.checkDetails) + '</b></div><div class="sum"><div class="st">📋 ' + esc(f.faq.question) + '</div>' + rows +
          (f.atts.length ? '<div class="sr"><span>📷</span><b>' + f.atts.length + ' ' + esc(t.photo) + '</b></div>' : '') + '</div>');
        h += chips([{ act: 'submit', label: f.sending ? t.sending : '✅ ' + t.sendReq, cls: 'pri', disabled: f.sending },
          { act: 'edit', label: '✏️ ' + t.edit, disabled: f.sending }, { act: 'cancel', label: '✖ ' + t.cancel, cls: 'ghost', disabled: f.sending }]);
      }
      return h;
    }
    if (bot.needId) {
      return botBubble('<div class="tx">' + esc(t.enterId.replace('{label}', cfg.player_id_label || 'Player ID')) + '</div>') +
        chips([{ act: 'cancelid', label: '✖ ' + t.cancel, cls: 'ghost' }]);
    }
    if (!state.messages.length || bot.showMenu) {
      if (!state.messages.length) h += botBubble('<div class="tx">' + linkify(cfg.welcome_message) + '</div>');
      var cats = topicCats();
      if (!cats.length) return h;
      if (cats.length > 1 && !bot.menuCat) {
        h += botBubble('<div class="tx">' + esc(t.chooseTopic) + '</div>');
        h += chips(cats.map(function (c) { return { act: 'cat', arg: c.id, label: c.title }; }));
      } else {
        var cat = cats.length === 1 ? cats[0] : cats.filter(function (c) { return c.id === bot.menuCat; })[0] || cats[0];
        h += botBubble('<div class="tx">' + esc(cat.title) + '</div>');
        var items = cat.faqs.map(function (q) { return { act: 'topic', arg: q.id, label: (q.has_form ? '📋 ' : '💡 ') + q.question }; });
        if (cats.length > 1) items.push({ act: 'cats', label: '‹ ' + t.back, cls: 'ghost' });
        h += chips(items);
      }
    }
    return h;
  }

  function bindBot(box) {
    Array.prototype.slice.call(box.querySelectorAll('[data-bot]')).forEach(function (b) {
      b.onclick = function () { onBot(b.dataset.bot, b.dataset.arg); };
    });
  }
  function redrawBot() { drawMessages(); var ta = $('#ls-ta'); if (ta) ta.focus(); }

  function onBot(act, arg) {
    var f = bot.flow;
    if (act === 'cat') { bot.menuCat = arg; return redrawBot(); }
    if (act === 'cats') { bot.menuCat = null; return redrawBot(); }
    if (act === 'topic') return startTopic(arg);
    if (act === 'cancelid') { bot.needId = false; bot.pendingText = null; return redrawBot(); }
    if (!f) return;
    if (act === 'cancel') { bot.flow = null; bot.showMenu = true; return redrawBot(); }
    if (act === 'edit') return startTopic(f.faq.id, true);
    if (act === 'opt') return answerField(arg);
    if (act === 'skip') { f.log.push({ from: 'me', text: '— ' + t.skip }); f.i++; return advance(); }
    if (act === 'photo') return pickFlowPhoto();
    if (act === 'submit') return submitRequest();
    if (act === 'solved') { f.log.push({ from: 'me', text: t.solved }); bot.flow = null; bot.showMenu = false; return redrawBot(); }
    if (act === 'agent') { f.info = false; f.log.push({ from: 'me', text: t.talkAgent }); f.notifyOnly = true; return ensureIdThen(function () { submitRequest(); }); }
  }

  function startTopic(id, restart) {
    api('POST', '/faq-events', { event_type: 'click', faq_id: id }).catch(function () {});
    return api('GET', '/faqs/' + id).then(function (faq) {
      var fields = (faq.fields || []).slice();
      var hasPid = fields.some(function (x) { return x.type === 'player_id'; });
      // a request needs to know who is asking: ask the Player ID first if we don't know it yet
      if (!state.session && !hasPid && cfg.require_player_id) fields.unshift({ id: '__pid', label: t.enterId.replace('{label}', cfg.player_id_label || 'Player ID'), type: 'player_id', required: true });
      bot.flow = { faq: faq, fields: fields, i: 0, answers: {}, atts: [], log: [{ from: 'me', text: faq.question }], cid: uid(), asked: {} };
      bot.showMenu = false; bot.needId = false;
      if (faq.answer) bot.flow.log.push({ from: 'bot', text: faq.answer });
      if (!faq.fields || !faq.fields.length) {
        // information topic: show the answer; tell the agents if the admin chose so, or if the customer asks for one
        if (faq.notify_agent) { bot.flow.notifyOnly = true; return ensureIdThen(function () { submitRequest(); }); }
        bot.flow.info = true; return redrawBot();
      }
      advance();
    }).catch(function () { bot.flow = null; redrawBot(); });
  }

  function advance() {
    var f = bot.flow; if (!f) return;
    while (f.i < f.fields.length) {
      var cur = f.fields[f.i];
      if (cur.type === 'player_id' && state.session && state.session.player_id) { f.answers[cur.id] = state.session.player_id; f.i++; continue; }
      if (!f.asked[f.i]) { f.asked[f.i] = true; f.log.push({ from: 'bot', text: cur.label + (cur.required || cur.type === 'player_id' ? '' : ' (' + t.optional + ')') }); }
      break;
    }
    redrawBot();
  }

  function fieldError(cur, v) {
    if (cur.type === 'number') { var n = Number(String(v).replace(/[,\s৳]/g, '')); if (!(n > 0)) return t.badNumber; }
    if (cur.type === 'phone') { var p = String(v).replace(/[\s-]/g, '').replace(/^\+?880/, '0'); if (!/^01[3-9]\d{8}$/.test(p)) return t.badPhone; }
    if (cur.type === 'player_id' && !/^[\w.@\-+:]{1,150}$/.test(v)) return t.badId;
    if (cur.type === 'select' && (cur.options || []).indexOf(v) < 0) return t.pickOption;
    return null;
  }

  // a typed answer (or an option button) for the current step
  function answerField(v) {
    var f = bot.flow; if (!f || f.i >= f.fields.length) return;
    var cur = f.fields[f.i];
    v = String(v || '').trim();
    if (cur.type === 'select') {
      var match = (cur.options || []).filter(function (o) { return o.toLowerCase() === v.toLowerCase(); })[0];
      if (match) v = match;
    }
    if (cur.type === 'image') { f.log.push({ from: 'bot', text: t.useButtons, err: true }); return redrawBot(); }
    if (!v) { if (cur.required || cur.type === 'player_id') { f.log.push({ from: 'bot', text: t.required, err: true }); return redrawBot(); } }
    var err = v ? fieldError(cur, v) : null;
    if (err) { f.log.push({ from: 'me', text: v }); f.log.push({ from: 'bot', text: err, err: true }); return redrawBot(); }
    f.log.push({ from: 'me', text: v });
    if (cur.type === 'player_id' && (!state.session || state.session.player_id !== v)) {
      // first time we learn who this is: start their session, then continue the form
      return identify({ player_id: v }).then(function () { f.answers[cur.id] = v; f.i++; connect(); advance(); })
        .catch(function (e) { f.log.push({ from: 'bot', text: e.message || t.error, err: true }); redrawBot(); });
    }
    f.answers[cur.id] = v; f.i++; advance();
  }

  function pickFlowPhoto() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () {
      var file = inp.files && inp.files[0]; if (!file) return;
      var f = bot.flow; if (!f) return;
      var preview = URL.createObjectURL(file);
      f.log.push({ from: 'me', img: preview });
      f.log.push({ from: 'bot', text: t.sending }); var waitIdx = f.log.length - 1;
      redrawBot();
      ensureIdThen(function () {
        compressImage(file).then(function (c) {
          return ensureConversation().then(function () {
            var fd = new FormData(); fd.append('conversation_id', state.conv.id); fd.append('file', c, c.name);
            return api('POST', '/uploads', fd, true);
          });
        }).then(function (att) {
          f.log.splice(waitIdx, 1); f.atts.push(att.id); f.i++; advance();
        }).catch(function (e) {
          f.log.splice(waitIdx, 1); f.log.push({ from: 'bot', text: e.message || t.error, err: true }); redrawBot();
        });
      });
    };
    inp.click();
  }

  // make sure we have a customer session (asks the Player ID if needed), then run fn
  function ensureIdThen(fn) {
    if (state.session) return fn();
    if (!cfg.require_player_id) return identify({}).then(fn).catch(function (e) { $('#ls-typ').textContent = e.message || t.error; });
    bot.needId = true; bot.afterId = fn; redrawBot();
  }

  function submitRequest() {
    var f = bot.flow; if (!f || f.sending) return;
    f.sending = true; f.error = null; redrawBot();
    var answers = {}; Object.keys(f.answers).forEach(function (k) { if (k !== '__pid') answers[k] = f.answers[k]; });
    api('POST', '/requests', { faq_id: f.faq.id, answers: answers, attachment_ids: f.atts, conversation_id: state.conv ? state.conv.id : null, client_message_id: f.cid })
      .then(function (r) {
        var newConv = !state.conv || state.conv.id !== r.conversation.id;
        state.conv = r.conversation;
        if (r.message) upsertMessage(r.message);
        bot.flow = null; bot.showMenu = false;
        connect();
        if (newConv && state.socket) state.socket.emit('customer:conversation:join', { conversation_id: state.conv.id }, function () {});
        drawMessages();
        setTimeout(loadHistory, 400); // pick up the automatic confirmation
      })
      .catch(function (e) {
        f.sending = false;
        if (e.code === 'session_expired') { saveSession(null); }
        f.log.push({ from: 'bot', text: e.message || t.error, err: true });
        // a bad answer: go back to that question
        redrawBot();
      });
  }

  // everything typed in the box goes through here
  function submitComposer() {
    var ta = $('#ls-ta'); if (!ta) return;
    var v = ta.value.trim();
    if (bot.needId) {
      if (!v) return;
      if (!/^[\w.@\-+:]{1,150}$/.test(v)) { $('#ls-typ').textContent = t.badId; return; }
      ta.value = ''; ta.style.height = 'auto';
      return identify({ player_id: v }).then(function () {
        bot.needId = false; connect();
        var fn = bot.afterId; bot.afterId = null;
        var pending = bot.pendingText; bot.pendingText = null;
        drawMessages();
        if (fn) fn(); else if (pending) send({ content: pending });
      }).catch(function (e) { $('#ls-typ').textContent = e.message || t.error; });
    }
    if (bot.flow) {
      if (bot.flow.info) { bot.flow = null; } // typing after reading an answer = talk to an agent
      else if (bot.flow.i < bot.flow.fields.length) { if (!v && bot.flow.fields[bot.flow.i].type !== 'image') return; ta.value = ''; ta.style.height = 'auto'; return answerField(v); }
      else { $('#ls-typ').textContent = t.useButtons; return; }
    }
    if (!v) return;
    if (!state.session) {
      if (!cfg.require_player_id) { ta.value = ''; return identify({}).then(function () { connect(); send({ content: v }); }); }
      bot.pendingText = v; bot.needId = true; ta.value = ''; ta.style.height = 'auto'; return redrawBot();
    }
    bot.showMenu = false;
    send();
  }

  // ---------------------------------------------------------- chat
  // WhatsApp-style: photos (many at once, compressed before upload), voice notes, swipe/hover to reply.
  var MIC = '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V22h2v-3.1A7 7 0 0019 12h-2z"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  var rec = null; // active voice recording

  function renderChat() {
    var agent = state.conv && state.conv.agent_name;
    loadTopics();
    if (!state.session && !cfg.require_player_id) identify({}, true).then(function () { connect(); });
    panel.innerHTML = header(false, cfg.title, agent ? esc(agent) : null) +
      (!state.online ? '<div class="bnr">' + esc(cfg.offline_message) + '</div>' : '') +
      '<div class="bd" id="ls-bd"><div class="msgs" id="ls-msgs"></div></div><div class="typ" id="ls-typ"></div>' +
      '<div id="ls-reply"></div>' +
      '<div class="cmp" id="ls-cmp">' +
      '<button class="ib" id="ls-topics" title="' + t.helpTopics + '">☰</button>' +
      (cfg.enable_attachments ? '<button class="ib" id="ls-att" title="' + t.attach + '">📎</button><input type="file" id="ls-file" style="display:none" multiple accept="image/*,audio/*,.pdf,.txt,.zip,.doc,.docx">' : '') +
      '<textarea id="ls-ta" rows="1" placeholder="' + t.type + '" maxlength="5000"></textarea>' +
      '<button class="ib snd" id="ls-send" aria-label="Send">' + (cfg.enable_attachments ? MIC : ICONS.send) + '</button></div>' +
      '<div class="lb" id="ls-lb" style="display:none"><img alt=""><button class="x" data-lbx>✕</button></div>';
    bindHeader();
    drawReplyBar();
    drawMessages();
    var ta = $('#ls-ta'); var typingOn = false, tt;
    var stop = function () { if (typingOn && state.socket && state.conv) { typingOn = false; state.socket.emit('customer:typing:stop', { conversation_id: state.conv.id }); } };
    var sendBtn = $('#ls-send');
    var refreshBtn = function () {
      var voice = cfg.enable_attachments && !ta.value.trim() && !!state.session && !bot.flow && !bot.needId;
      sendBtn.innerHTML = voice ? MIC : ICONS.send;
      sendBtn.setAttribute('aria-label', voice ? t.voice : 'Send');
    };
    ta.oninput = function () {
      ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      refreshBtn();
      if (state.socket && state.conv) {
        if (!typingOn) typingOn = true;
        state.socket.emit('customer:typing:start', { conversation_id: state.conv.id, preview: ta.value.slice(-120) });
        clearTimeout(tt); tt = setTimeout(stop, 2500);
      }
    };
    ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stop(); submitComposer(); refreshBtn(); } };
    sendBtn.onclick = function () {
      stop();
      var voice = cfg.enable_attachments && !ta.value.trim() && !!state.session && !bot.flow && !bot.needId;
      if (voice) startRecording(); else { submitComposer(); refreshBtn(); }
    };
    $('#ls-topics').onclick = function () {
      if (bot.flow && !bot.flow.info) return; // finish or cancel the current form first
      bot.flow = null; bot.needId = false; bot.menuCat = null; bot.showMenu = !bot.showMenu || !state.messages.length;
      redrawBot(); refreshBtn();
    };
    if (cfg.enable_attachments) {
      $('#ls-att').onclick = function () { ensureIdThen(function () { $('#ls-file').click(); }); };
      $('#ls-file').onchange = function (e) { var files = Array.prototype.slice.call(e.target.files); e.target.value = ''; sendFiles(files); };
      ta.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.files) ? Array.prototype.slice.call(e.clipboardData.files) : [];
        if (items.length) { e.preventDefault(); sendFiles(items); }
      });
      var bd = $('#ls-bd');
      bd.addEventListener('dragover', function (e) { e.preventDefault(); });
      bd.addEventListener('drop', function (e) { e.preventDefault(); sendFiles(Array.prototype.slice.call(e.dataTransfer.files || [])); });
    }
    $('[data-lbx]').onclick = function () { $('#ls-lb').style.display = 'none'; };
    $('#ls-lb').onclick = function (e) { if (e.target.id === 'ls-lb') $('#ls-lb').style.display = 'none'; };
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

  function fmtDur(ms) { var s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function quoteName(r) { return r.sender_type === 'customer' ? t.you : (r.sender_name || t.agent); }
  function quoteText(m) {
    if (m.content) return m.content;
    var a = (m.attachments || [])[0];
    if (a && a.mime_type.indexOf('audio/') === 0) return '🎤 ' + t.voice;
    if (a && a.mime_type.indexOf('image/') === 0) return '📷 ' + t.photo;
    return a ? '📎 ' + a.file_name : '';
  }
  function attUrl(u) { return /^(blob:|https?:)/.test(u) ? u : BASE + u; }

  function msgHtml(m) {
    if (m.message_type === 'system' || m.sender_type === 'system') return '<div class="m s">' + linkify(m.content) + '</div>';
    var mine = m.sender_type === 'customer';
    var atts = (m.attachments || []).map(function (a) {
      var url = attUrl(a.url);
      if (a.mime_type.indexOf('image/') === 0) {
        return '<img class="ph" src="' + esc(attUrl(a.thumb_url || a.url)) + '" data-full="' + esc(url) + '" alt="' + esc(a.file_name || '') + '" loading="lazy">';
      }
      if (a.mime_type.indexOf('audio/') === 0) {
        return '<div class="vn" data-src="' + esc(url) + '" data-dur="' + (a.duration_ms || 0) + '"><button class="vp" aria-label="Play">' + PLAY + '</button>' +
          '<div class="vt"><div class="vb"><i></i></div><span class="vd">' + fmtDur(a.duration_ms) + '</span></div><span class="vm">🎤</span></div>';
      }
      return '<a class="fl" href="' + esc(url) + '" target="_blank" rel="noopener">📄 ' + esc(a.file_name) + '</a>';
    }).join('');
    var q = m.reply_to ? '<div class="qt" data-goto="' + esc(m.reply_to.id) + '"><b>' + esc(quoteName(m.reply_to)) + '</b><span>' + esc(m.reply_to.content || '') + '</span></div>' : '';
    var time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var status = mine ? (m._failed ? ' · ' + t.failed : m._pending ? ' · 🕓' : m.read_at ? ' · ✓✓' : ' · ✓') : '';
    var canReply = m.id && !m._pending && !m._failed;
    return '<div class="mw ' + (mine ? 'c' : 'a') + '" data-mid="' + esc(m.id || '') + '">' +
      '<div class="m ' + (mine ? 'c' : 'a') + (m._failed ? ' fail' : '') + ((m.attachments || []).length && !m.content ? ' media' : '') + '" data-cid="' + esc(m.client_message_id || '') + '">' +
      (!mine ? '<div class="nm">' + esc(m.sender_name || t.agent) + '</div>' : '') + q + atts + (m.content ? '<div class="tx">' + linkify(m.content) + '</div>' : '') +
      '<div class="tm">' + time + status + '</div></div>' +
      (canReply ? '<button class="rp" data-reply="' + esc(m.id) + '" title="' + t.reply + '">↩</button>' : '') + '</div>';
  }

  function drawMessages() {
    var box = $('#ls-msgs'); if (!box) return;
    var html = state.messages.map(msgHtml).join('');
    var c = state.conv;
    if (c && (c.status === 'resolved' || c.status === 'closed') && cfg.enable_rating && !c.rating && !state.rated[c.id]) {
      html += '<div class="rate" id="ls-rate">' + t.rate + '<div class="stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<span data-r="' + n + '">★</span>'; }).join('') + '</div></div>';
    }
    box.innerHTML = html + botHtml();
    bindMessages(box);
    bindBot(box);
    if (player) { // keep a playing voice note playing across redraws
      var again = Array.prototype.slice.call(box.querySelectorAll('.vn')).filter(function (v) { return v.dataset.src === player.src; })[0];
      if (again) { player.el = again; again.querySelector('.vp').innerHTML = player.audio.paused ? PLAY : PAUSE; } else stopPlayback();
    }
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

  function bindMessages(box) {
    $$('.m.fail').forEach(function (el) { el.onclick = function () { retry(el.dataset.cid); }; });
    $$('[data-reply]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); setReply(b.dataset.reply); }; });
    $$('.ph').forEach(function (img) { img.onclick = function () { var lb = $('#ls-lb'); lb.querySelector('img').src = img.dataset.full; lb.style.display = 'flex'; }; });
    $$('[data-goto]').forEach(function (q) {
      q.onclick = function () {
        var el = box.querySelector('[data-mid="' + q.dataset.goto + '"]');
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('hl'); setTimeout(function () { el.classList.remove('hl'); }, 1200); }
      };
    });
    $$('.vn').forEach(function (v) {
      v.querySelector('.vp').onclick = function () { togglePlay(v); };
      v.querySelector('.vb').onclick = function (e) { seek(v, e); };
    });
    // swipe right on a message to reply (touch screens)
    $$('.mw').forEach(function (w) {
      var x0 = null, dx = 0, id = w.dataset.mid;
      if (!id) return;
      w.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; dx = 0; }, { passive: true });
      w.addEventListener('touchmove', function (e) { if (x0 == null) return; dx = Math.max(0, Math.min(80, e.touches[0].clientX - x0)); w.style.transform = 'translateX(' + dx + 'px)'; }, { passive: true });
      w.addEventListener('touchend', function () { w.style.transform = ''; if (dx > 55) setReply(id); x0 = null; });
    });
  }

  // ---- reply / quote
  function setReply(id) {
    var m = state.messages.find(function (x) { return x.id === id; });
    if (!m) return;
    state.replyTo = m; drawReplyBar();
    var ta = $('#ls-ta'); if (ta) ta.focus();
  }
  function drawReplyBar() {
    var box = $('#ls-reply'); if (!box) return;
    var m = state.replyTo;
    if (!m) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="rbar"><div class="qt"><b>' + esc(quoteName(m)) + '</b><span>' + esc(quoteText(m)) + '</span></div><button class="ib" id="ls-rx">✕</button></div>';
    $('#ls-rx').onclick = function () { state.replyTo = null; drawReplyBar(); };
  }
  function takeReply() { var r = state.replyTo; state.replyTo = null; drawReplyBar(); return r ? r.id : null; }

  // ---- voice note player (one at a time)
  var player = null;
  function stopPlayback() {
    if (!player) return;
    player.audio.pause();
    var b = player.el && player.el.querySelector('.vp'); if (b) b.innerHTML = PLAY;
    player = null;
  }
  function togglePlay(v) {
    if (player && player.src === v.dataset.src) {
      if (player.audio.paused) { player.audio.play(); v.querySelector('.vp').innerHTML = PAUSE; } else { player.audio.pause(); v.querySelector('.vp').innerHTML = PLAY; }
      return;
    }
    stopPlayback();
    var audio = new Audio(v.dataset.src);
    var dur = +v.dataset.dur || 0;
    var p = player = { el: v, audio: audio, src: v.dataset.src };
    var total = function () { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : dur; };
    audio.ontimeupdate = function () {
      var bar = p.el.querySelector('.vb i'), lbl = p.el.querySelector('.vd');
      if (total()) bar.style.width = Math.min(100, audio.currentTime * 1000 / total() * 100) + '%';
      lbl.textContent = fmtDur(audio.currentTime * 1000);
    };
    audio.onended = function () {
      p.el.querySelector('.vb i').style.width = '0%'; p.el.querySelector('.vd').textContent = fmtDur(dur);
      p.el.querySelector('.vp').innerHTML = PLAY; if (player === p) player = null;
    };
    audio.play().then(function () { p.el.querySelector('.vp').innerHTML = PAUSE; }).catch(function () { var ty = $('#ls-typ'); if (ty) ty.textContent = t.error; });
  }
  function seek(v, e) {
    if (!player || player.src !== v.dataset.src) return togglePlay(v);
    var a = player.audio; var tot = isFinite(a.duration) && a.duration > 0 ? a.duration : (+v.dataset.dur || 0) / 1000;
    var rect = e.currentTarget.getBoundingClientRect();
    if (tot) a.currentTime = tot * Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  // ---- voice recording
  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/aac'];
    if (!window.MediaRecorder) return null;
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }
  function startRecording() {
    if (rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || pickMime() === null) {
      $('#ls-typ').textContent = t.noMic; return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var mime = pickMime();
      var mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 }) : new MediaRecorder(stream);
      rec = { mr: mr, stream: stream, chunks: [], start: Date.now(), cancel: false };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.onstop = function () {
        var r = rec; rec = null;
        r.stream.getTracks().forEach(function (tr) { tr.stop(); });
        clearInterval(r.timer);
        renderComposerBack();
        var ms = Date.now() - r.start;
        if (r.cancel || ms < 700) return;
        var type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        var ext = type.indexOf('mp4') >= 0 ? 'm4a' : type.indexOf('ogg') >= 0 ? 'ogg' : type.indexOf('aac') >= 0 ? 'aac' : 'webm';
        var blob = new Blob(r.chunks, { type: type });
        sendMedia(new File([blob], 'voice-' + Date.now() + '.' + ext, { type: type }), ms, '');
      };
      mr.start(250);
      var cmp = $('#ls-cmp');
      cmp.innerHTML = '<button class="ib" id="ls-rcx" title="Cancel">🗑</button><div class="recb"><i class="dot"></i><span id="ls-rt">0:00</span><small>' + t.recording + '</small></div>' +
        '<button class="ib snd" id="ls-rsend">' + ICONS.send + '</button>';
      rec.timer = setInterval(function () {
        var el = $('#ls-rt'); if (el) el.textContent = fmtDur(Date.now() - rec.start);
        if (Date.now() - rec.start > 5 * 60000) mr.stop(); // 5 minute limit
      }, 250);
      $('#ls-rcx').onclick = function () { rec.cancel = true; mr.stop(); };
      $('#ls-rsend').onclick = function () { mr.stop(); };
    }).catch(function () { $('#ls-typ').textContent = t.noMic; });
  }
  function renderComposerBack() {
    // rebuild the normal composer after recording (keeps messages & reply bar)
    if (state.screen !== 'chat') return;
    var keep = state.replyTo; render(); state.replyTo = keep; drawReplyBar();
  }

  // ---- image compression (like WhatsApp: max 1600px, JPEG ~75%)
  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return resolve(file);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var s = Math.min(1, max / Math.max(w, h));
        var cw = Math.round(w * s), ch = Math.round(h * s);
        try {
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function (b) {
            if (!b || (b.size >= file.size && s === 1)) return resolve(file);
            resolve(new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.75);
        } catch (e) { resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // e.g. HEIC on Chrome → server converts
      img.src = url;
    });
  }

  function ensureConversation() {
    if (state.conv) return Promise.resolve(state.conv);
    return api('POST', '/conversations', {}).then(function (r) {
      state.conv = r.conversation;
      if (state.socket) state.socket.emit('customer:conversation:join', { conversation_id: state.conv.id }, function () {});
      return state.conv;
    });
  }

  function sendFiles(files) {
    if (!files.length) return;
    if (!state.session) return ensureIdThen(function () { sendFiles(files); });
    var ta = $('#ls-ta'); var caption = ta ? ta.value.trim() : '';
    if (caption) { ta.value = ''; ta.style.height = 'auto'; }
    files.slice(0, 10).forEach(function (f, i) { sendMedia(f, 0, i === 0 ? caption : ''); });
  }

  // Shows the photo/voice immediately, compresses, uploads, then sends as a message.
  function sendMedia(file, durationMs, caption, retryMsg) {
    var cid = retryMsg ? retryMsg.client_message_id : uid();
    var replyId = retryMsg ? retryMsg._replyId : takeReply();
    var local = retryMsg || {
      client_message_id: cid, sender_type: 'customer', message_type: 'text', content: caption || null, created_at: new Date().toISOString(),
      _pending: true, _file: file, _dur: durationMs, _replyId: replyId,
      reply_to: replyId ? (function (r) { return r ? { id: r.id, sender_type: r.sender_type, sender_name: r.sender_name, content: quoteText(r) } : null; })(state.messages.find(function (x) { return x.id === replyId; })) : null,
      attachments: [{ mime_type: file.type || 'application/octet-stream', file_name: file.name, url: URL.createObjectURL(file), duration_ms: durationMs }],
    };
    local._pending = true; local._failed = false;
    upsertMessage(local); drawMessages();
    var prep = /^image\//.test(file.type) ? compressImage(file) : Promise.resolve(file);
    prep.then(function (f) {
      return ensureConversation().then(function () {
        var fd = new FormData();
        fd.append('conversation_id', state.conv.id);
        if (durationMs) fd.append('duration_ms', String(Math.round(durationMs)));
        fd.append('file', f, f.name);
        return api('POST', '/uploads', fd, true);
      });
    }).then(function (att) {
      local._attachment = att;
      send({ content: caption || '', client_message_id: cid, _attachment: att, _replyId: replyId, _local: local });
    }).catch(function (e) {
      local._pending = false; local._failed = true; upsertMessage(local); drawMessages();
      $('#ls-typ').textContent = e.message || t.error;
    });
  }

  function upsertMessage(m) {
    var i = -1;
    for (var k = 0; k < state.messages.length; k++) {
      var x = state.messages[k];
      if ((m.id && x.id === m.id) || (m.client_message_id && x.client_message_id === m.client_message_id)) { i = k; break; }
    }
    if (i >= 0) state.messages[i] = m; else state.messages.push(m);
  }

  // Sends text (or an already-uploaded attachment). Retry-safe: same client_message_id never duplicates.
  function send(opt) {
    opt = opt || {};
    var ta = $('#ls-ta');
    var content = opt.content != null ? opt.content : (ta ? ta.value.trim() : '');
    var att = opt._attachment || null;
    if (!content && !att) return;
    var cid = opt.client_message_id || uid();
    var replyId = opt._replyId !== undefined ? opt._replyId : takeReply();
    if (opt.content == null && ta) { ta.value = ''; ta.style.height = 'auto'; }
    var local = opt._local || { client_message_id: cid, sender_type: 'customer', message_type: 'text', content: content, created_at: new Date().toISOString(), attachments: [], _replyId: replyId,
      reply_to: replyId ? (function (r) { return r ? { id: r.id, sender_type: r.sender_type, sender_name: r.sender_name, content: quoteText(r) } : null; })(state.messages.find(function (x) { return x.id === replyId; })) : null };
    local._pending = true; local._failed = false;
    upsertMessage(local); drawMessages();
    var payload = { conversation_id: state.conv ? state.conv.id : null, content: content, client_message_id: cid, attachment_id: att ? att.id : null, reply_to_id: replyId };
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
    if (!m) return;
    if (m._file && !m._attachment) return sendMedia(m._file, m._dur, m.content, m);
    send({ content: m.content || '', client_message_id: m.client_message_id, _attachment: m._attachment, _replyId: m._replyId, _local: m });
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
      s.on('chat:session:revoked', function () { saveSession(null); disconnect(); state.conv = null; state.messages = []; state.screen = 'chat'; bot.flow = null; bot.showMenu = true; render(); });
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
        if (state.screen === 'chat') { if (agentChanged && !rec) { var keep = state.replyTo; render(); state.replyTo = keep; drawReplyBar(); } else drawMessages(); }
      });
      s.on('chat:agent:online', function () { setOnline(true); });
      s.on('chat:agent:offline', function () { setOnline(false); });
    }).catch(function () { console.warn('[LiveSupport] realtime unavailable'); });
  }
  function setOnline(v) { if (state.online === v) return; state.online = v; if (rec) return; if (state.screen !== 'chat' || !$('#ls-ta') || !$('#ls-ta').value) render(); }
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
      return p.then(function () { saveSession(null); disconnect(); state.conv = null; state.messages = []; state.screen = 'chat'; bot.flow = null; bot.showMenu = true; render(); });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
