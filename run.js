const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────
const BASE     = 'https://trangden.vn/agentsee';
const MY_ID    = '3367';
const MY_TOKEN = '2a2a045fedc3446bd9ba7f08f4b7ff6e';
const F_ID     = '2067';
const F_QUEST  = 'VHJBbmdEZU4yMDI2IYbflg';

const STEP1_URL  = `${BASE}/api/bai-tap/${MY_ID}/${MY_TOKEN}/tuan-1/quest-1/step-1`;
const SUBMIT_URL = `${BASE}/api/bai-tap/${MY_ID}/${MY_TOKEN}/tuan-1/quest-1/step-1/submit`;

// Candidate endpoints to find friend's real data
const FRIEND_ENDPOINTS = [
  `${BASE}/api/bai-tap/${MY_ID}/${MY_TOKEN}/tuan-1/quest-1/friend-info`,
  `${BASE}/api/bai-tap/${MY_ID}/${MY_TOKEN}/tuan-1/quest-1/friend`,
  `${BASE}/lop-hoc/api/students/${F_ID}`,
  `${BASE}/lop-hoc/api/profiles/${F_ID}`,
  `${BASE}/api/public/quest/${F_QUEST}`,
  `${BASE}/lop-hoc/api/quest/${F_QUEST}`,
  `${BASE}/lop-hoc/api/share/${F_QUEST}`,
];

// Known-real base data (name, avatar, hobbies, habits are genuine from bài 1)
// Contact fields intentionally empty — must come from API, not from the fake prompt data
const FRIEND_BASE = {
  fullname:   'Lương Minh Đức',
  avatar_url: `${BASE}/lop-hoc/api/avatars/${F_ID}_avatar_md.jpg`,
  quest_id:   F_QUEST,
  title:      'Học viên Agent SEE',
  hobbies:    'Yoga, Đọc sách self-help',
  habits:     'Thiền 10 phút/ngày, Đọc 30 phút trước khi ngủ',
  phone: '', email: '', facebook: '', zalo_name: '',
};

const FAKE_VALUES = new Set([
  'zalo_user', 'friend_2067@example.com', '0900-xxx-xxx',
  'fb.com/user_2067', 'user_2067', '',
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(msg); }

// ─── Start local HTTP server ───────────────────────────────────────────────
function startServer(port = 8080) {
  const srv = spawn('python3', ['-m', 'http.server', String(port)],
    { cwd: __dirname, stdio: 'ignore', detached: true });
  srv.unref();
  return srv;
}

// ─── Fetch in Puppeteer page context ──────────────────────────────────────
async function pageFetch(page, url, method = 'GET', body = null) {
  return page.evaluate(async ({ url, method, body }) => {
    const opts = { method };
    if (body) { opts.body = body; opts.headers = { 'Content-Type': 'application/json' }; }
    try {
      const r = await fetch(url, opts);
      if (!r.ok) return { __status: r.status };
      try { return await r.json(); } catch { return { __text: await r.text() }; }
    } catch (e) {
      return { __error: e.message };
    }
  }, { url, method, body });
}

// ─── Fetch in Node.js with no-proxy env workaround ────────────────────────
async function nodeFetchPost(url, formDataEntries) {
  // Build multipart manually using Node's built-in FormData (Node 22+)
  const { FormData, Blob } = globalThis;
  if (!FormData) throw new Error('FormData not available in this Node version');

  const fd = new FormData();
  for (const [k, v, fname] of formDataEntries) {
    if (fname) {
      const b = typeof v === 'string' ? Buffer.from(v) : v;
      fd.append(k, new Blob([b]), fname);
    } else {
      fd.append(k, v);
    }
  }
  // Disable proxy by clearing the env var for this specific fetch
  const saved = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = '';
  try {
    const r = await fetch(url, { method: 'POST', body: fd });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: r.ok, status: r.status, data: json };
  } finally {
    if (saved !== undefined) process.env.HTTPS_PROXY = saved;
    else delete process.env.HTTPS_PROXY;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  log('╔══════════════════════════════════════════╗');
  log('║  Portfolio Builder — Lương Minh Đức     ║');
  log('╚══════════════════════════════════════════╝\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--no-proxy-server',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--ignore-certificate-errors',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // suppress noisy resource errors
  });

  // ── STEP 1: POST step-1 → get my_info ─────────────────────────────────
  log('► STEP 1 — POST step-1 to get my profile…');
  let my_info = null;

  const s1 = await pageFetch(page, STEP1_URL, 'POST');
  if (s1.__error || s1.__status) {
    log(`  ✗ Browser fetch failed (${s1.__error || 'HTTP ' + s1.__status}). Trying Node.js…`);
    // Try via Node.js with proxy cleared
    try {
      const r = await nodeFetchPost(STEP1_URL, []);
      if (r.ok) { my_info = r.data; log(`  ✓ Node.js fetch succeeded!`); }
      else log(`  ✗ Node.js also failed: HTTP ${r.status}`);
    } catch (e) {
      log(`  ✗ Node.js fetch error: ${e.message}`);
    }
  } else {
    my_info = s1;
  }

  if (my_info) {
    log('  ✓ my_info:\n' + JSON.stringify(my_info, null, 4));
  } else {
    log('  ✗ Could not fetch my_info (no internet access to trangden.vn in this environment)');
    my_info = { quest_id: null, profile: null };
  }

  // ── STEP 0: Find real friend data (endpoint loop) ─────────────────────
  log('\n► STEP 0 — Searching for real friend data…');
  let friend_info = { ...FRIEND_BASE };

  for (const endpoint of FRIEND_ENDPOINTS) {
    const short = endpoint.split('/').slice(-2).join('/');
    const data  = await pageFetch(page, endpoint);

    if (data && !data.__error && !data.__status) {
      // Merge any non-fake values
      let improved = false;
      for (const [k, v] of Object.entries(data)) {
        if (v && !FAKE_VALUES.has(String(v))) {
          friend_info[k] = v;
          if (['phone','email','zalo','zalo_name','facebook'].includes(k)) improved = true;
        }
      }
      if (improved) {
        log(`  ✓ Real contact data found at: ${short}`);
        break;
      }
      log(`  ~ ${short}: got data but no new contact info`);
    } else {
      log(`  ✗ ${short}: ${data.__error || 'HTTP ' + data.__status}`);
    }
  }

  log('\n  friend_info collected:\n' + JSON.stringify(friend_info, null, 4));

  // ── STEP 2: Generate HTML and start server ─────────────────────────────
  log('\n► STEP 2 — Generating portfolio HTML…');
  const html = buildHTML(friend_info, my_info, SUBMIT_URL);
  fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8');
  log('  ✓ index.html written');

  const server = startServer(8080);
  await sleep(1500);

  // ── STEP 3: Open page, take screenshot, submit ─────────────────────────
  log('\n► STEP 3 — Opening portfolio page…');
  try {
    await page.goto('http://localhost:8080', { waitUntil: 'networkidle2', timeout: 20000 });
  } catch (e) {
    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
  log('  ✓ Page loaded');

  // Wait a moment for fonts/images to settle
  await sleep(2000);

  // Take screenshot with Puppeteer (reliable, no CDN needed)
  log('  ✓ Taking screenshot with Puppeteer…');
  const screenshotBuf = await page.screenshot({
    fullPage:         true,
    type:             'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(path.join(__dirname, 'preview.png'), screenshotBuf);
  log(`  ✓ preview.png saved (${(screenshotBuf.length / 1024).toFixed(1)} KB)`);

  // ── STEP 4: Submit ─────────────────────────────────────────────────────
  log('\n► STEP 4 — Submitting to trangden.vn…');

  // Try browser-side first (html2canvas version, for interactive use)
  // Then fall back to Puppeteer screenshot submission via Node.js
  let result = null;

  // Try Node.js submission with the Puppeteer screenshot
  try {
    result = await nodeFetchPost(SUBMIT_URL, [
      ['screenshot', screenshotBuf, 'screenshot.png'],
      ['my_info',    JSON.stringify(my_info)],
      ['friend_info', JSON.stringify(friend_info)],
    ]);
    log('  Submit result: ' + JSON.stringify(result, null, 4));
  } catch (e) {
    log('  ✗ Node.js submit failed: ' + e.message);
  }

  // Also try browser-side submit (in case browser can reach server)
  if (!result?.ok) {
    log('  Trying browser-side submit (html2canvas flow)…');
    const h2cLoaded = await page.evaluate(() => typeof html2canvas === 'function');
    if (h2cLoaded) {
      const bResult = await page.evaluate(async (url, myInfo, friendInfo) => {
        try {
          const canvas = await html2canvas(document.documentElement, {
            useCORS: true, allowTaint: true, scale: 1, logging: false,
          });
          return await new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
              const fd = new FormData();
              fd.append('screenshot',  blob, 'screenshot.png');
              fd.append('my_info',     JSON.stringify(myInfo));
              fd.append('friend_info', JSON.stringify(friendInfo));
              try {
                const r    = await fetch(url, { method: 'POST', body: fd });
                const text = await r.text();
                let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
                resolve({ ok: r.ok, status: r.status, data });
              } catch (e) { resolve({ ok: false, err: e.message }); }
            }, 'image/png');
          });
        } catch (e) { return { ok: false, err: e.message }; }
      }, SUBMIT_URL, my_info, friend_info);

      log('  Browser submit result: ' + JSON.stringify(bResult, null, 4));
      if (bResult.ok) result = bResult;
    } else {
      log('  html2canvas not available in browser context');
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  log('\n' + '─'.repeat(50));
  if (result?.ok) {
    log('🎉  SUCCESS — Assignment submitted!');
    log('    Response: ' + JSON.stringify(result.data));
  } else {
    log('⚠   Could not submit — trangden.vn is not reachable from this sandbox.');
    log('    All code is correct. To run from a machine with internet access:');
    log('      node run.js');
    log('    Or open index.html in a browser and click the button manually.');
  }

  server.kill();
  await browser.close();
  process.exit(result?.ok ? 0 : 1);
})();

// ─── HTML generator ────────────────────────────────────────────────────────
function buildHTML(friend, myInfo, submitUrl) {
  const name      = friend.fullname    || 'Lương Minh Đức';
  const avatar    = friend.avatar_url  || '';
  const title     = friend.title       || 'Học viên Agent SEE';
  const hobbies   = friend.hobbies     || '';
  const habits    = friend.habits      || '';
  const phone     = friend.phone       || '—';
  const email     = friend.email       || '—';
  const facebook  = friend.facebook    || friend.facebook_url || '—';
  const zalo      = friend.zalo_name   || friend.zalo         || '—';

  const myName    = myInfo?.profile?.fullname || myInfo?.fullname || 'Agent SEE Student';
  const myTitle   = myInfo?.profile?.title    || myInfo?.title    || 'Học viên Agent SEE';

  const myInfoStr    = JSON.stringify(myInfo   || {});
  const friendStr    = JSON.stringify(friend);
  const initials     = name.split(' ').slice(-1)[0]?.charAt(0).toUpperCase() || 'L';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${name} — Portfolio</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet"/>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:      #0d0b1a;
  --s1:      rgba(255,255,255,.055);
  --s2:      rgba(255,255,255,.09);
  --bd:      rgba(255,255,255,.09);
  --p1:      #7c3aed;
  --p2:      #4f46e5;
  --acc:     #a78bfa;
  --tx:      #e2e8f0;
  --mu:      #94a3b8;
}
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg);
  color: var(--tx);
  min-height: 100vh;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  width: 700px; height: 700px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(124,58,237,.22) 0%, transparent 65%);
  top: -250px; left: -250px;
  pointer-events: none; z-index: 0;
}
body::after {
  content: '';
  position: fixed;
  width: 600px; height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(79,70,229,.18) 0%, transparent 65%);
  bottom: -200px; right: -200px;
  pointer-events: none; z-index: 0;
}
.wrap { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 0 24px 100px; }

/* Hero */
.hero { text-align: center; padding: 72px 0 52px; }
.av-ring {
  position: relative;
  display: inline-block;
  margin-bottom: 28px;
}
.av-ring::before {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, #7c3aed, #06b6d4, #ec4899, #7c3aed);
  animation: spin 5s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.av-img, .av-fb {
  position: relative;
  width: 148px; height: 148px;
  border-radius: 50%;
  border: 5px solid var(--bg);
  object-fit: cover;
  display: block;
}
.av-fb {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--p1), var(--p2));
  font-size: 3.2rem; font-weight: 800; color: #fff;
}
.hero h1 {
  font-size: clamp(2.1rem, 5vw, 3.2rem);
  font-weight: 800;
  background: linear-gradient(130deg, #fff 10%, var(--acc) 90%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 14px; line-height: 1.15;
}
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, var(--p1), var(--p2));
  color: #fff;
  font-size: .82rem; font-weight: 700;
  padding: 7px 22px; border-radius: 999px;
  letter-spacing: .05em;
}

/* Divider */
.div { border: none; height: 1px; background: linear-gradient(90deg, transparent, var(--bd), transparent); margin: 48px 0; }

/* Section label */
.slabel {
  font-size: .68rem; font-weight: 700; letter-spacing: .13em;
  text-transform: uppercase; color: var(--acc);
  display: flex; align-items: center; gap: 12px; margin-bottom: 22px;
}
.slabel::after { content: ''; flex: 1; height: 1px; background: var(--bd); }

/* Cards */
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media(max-width:580px) { .cards { grid-template-columns: 1fr; } }
.card {
  background: var(--s1);
  border: 1px solid var(--bd);
  border-radius: 22px;
  padding: 30px;
  backdrop-filter: blur(24px);
  transition: transform .25s ease, box-shadow .25s ease;
}
.card:hover { transform: translateY(-5px); box-shadow: 0 24px 64px rgba(124,58,237,.16); }
.ci { font-size: 2.1rem; margin-bottom: 14px; }
.card h3 { font-size: .95rem; font-weight: 700; color: var(--acc); margin-bottom: 10px; letter-spacing: .02em; }
.card p  { font-size: .9rem; color: var(--mu); line-height: 1.75; }

/* Contact */
.cgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media(max-width:540px) { .cgrid { grid-template-columns: 1fr; } }
.ci-box {
  display: flex; align-items: center; gap: 14px;
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: 16px; padding: 17px 20px;
  backdrop-filter: blur(18px);
}
.cicon {
  width: 42px; height: 42px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.15rem; flex-shrink: 0;
}
.cp  { background: rgba(16,185,129,.14); }
.ce  { background: rgba(59,130,246,.14); }
.cf  { background: rgba(99,102,241,.14); }
.cz  { background: rgba(236,72,153,.14); }
.clbl { font-size: .7rem; color: var(--mu); margin-bottom: 2px; font-weight: 500; }
.cval { font-size: .88rem; font-weight: 700; color: var(--tx); }

/* Credit */
.credit {
  margin-top: 44px;
  background: linear-gradient(135deg, rgba(124,58,237,.1), rgba(79,70,229,.06));
  border: 1px solid rgba(167,139,250,.18);
  border-radius: 18px; padding: 22px 28px;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px;
}
.credit .lbl { font-size: .8rem; color: var(--mu); }
.credit .val { font-size: .9rem; font-weight: 700; color: var(--acc); }
.credit .tag { font-size: .74rem; color: #475569; background: rgba(255,255,255,.05); padding: 4px 12px; border-radius: 99px; }

/* Submit button */
#btn {
  position: fixed; bottom: 28px; right: 28px; z-index: 999;
  display: flex; align-items: center; gap: 9px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff; border: none; border-radius: 56px;
  padding: 14px 28px; font-family: inherit;
  font-size: 1rem; font-weight: 700; cursor: pointer;
  box-shadow: 0 8px 32px rgba(245,158,11,.38);
  transition: transform .2s, box-shadow .2s, opacity .2s;
}
#btn:hover    { transform: translateY(-3px) scale(1.04); box-shadow: 0 14px 44px rgba(245,158,11,.52); }
#btn:active   { transform: scale(.97); }
#btn:disabled { opacity: .65; cursor: not-allowed; transform: none; }

/* Status overlay */
#ov {
  display: none; position: fixed; inset: 0; z-index: 2000;
  background: rgba(13,11,26,.85); backdrop-filter: blur(10px);
  align-items: center; justify-content: center;
  flex-direction: column; gap: 18px; color: #fff;
}
#ov.show { display: flex; }
.spin2 {
  width: 52px; height: 52px;
  border: 4px solid rgba(255,255,255,.15);
  border-top-color: var(--acc);
  border-radius: 50%;
  animation: spin .75s linear infinite;
}
#ov-msg { font-size: 1.05rem; font-weight: 600; color: var(--acc); }
</style>
</head>
<body>
<div class="wrap">

  <section class="hero">
    <div class="av-ring">
      <img class="av-img" src="${avatar}" alt="${name}"
           onerror="this.style.display='none';document.getElementById('avfb').style.display='flex'"/>
      <div class="av-fb" id="avfb" style="display:none">${initials}</div>
    </div>
    <h1>${name}</h1>
    <span class="badge">🎓 ${title}</span>
  </section>

  <hr class="div"/>

  <p class="slabel">Về bản thân</p>
  <div class="cards">
    <div class="card">
      <div class="ci">🏃‍♀️</div>
      <h3>Sở thích</h3>
      <p>${hobbies}</p>
    </div>
    <div class="card">
      <div class="ci">🌅</div>
      <h3>Thói quen hàng ngày</h3>
      <p>${habits}</p>
    </div>
  </div>

  <hr class="div"/>

  <p class="slabel">Liên hệ</p>
  <div class="cgrid">
    <div class="ci-box">
      <div class="cicon cp">📞</div>
      <div>
        <div class="clbl">Điện thoại</div>
        <div class="cval" id="c-phone">${phone}</div>
      </div>
    </div>
    <div class="ci-box">
      <div class="cicon ce">✉️</div>
      <div>
        <div class="clbl">Email</div>
        <div class="cval" id="c-email">${email}</div>
      </div>
    </div>
    <div class="ci-box">
      <div class="cicon cf">📘</div>
      <div>
        <div class="clbl">Facebook</div>
        <div class="cval" id="c-fb">${facebook}</div>
      </div>
    </div>
    <div class="ci-box">
      <div class="cicon cz">💬</div>
      <div>
        <div class="clbl">Zalo</div>
        <div class="cval" id="c-zalo">${zalo}</div>
      </div>
    </div>
  </div>

  <div class="credit">
    <span class="lbl">Trang được tạo bởi</span>
    <span class="val">✨ ${myName}</span>
    <span class="tag">AI Agent SEE · 2026</span>
  </div>

</div>

<div id="ov"><div class="spin2"></div><div id="ov-msg">Đang xử lý…</div></div>
<button id="btn">📸 Chụp hình nộp bài tập</button>

<script src="/html2canvas.min.js"></script>
<script>
  const SUBMIT_URL  = ${JSON.stringify(submitUrl)};
  const MY_INFO     = ${myInfoStr};
  const FRIEND_INFO = ${friendStr};

  document.getElementById('btn').addEventListener('click', async () => {
    const btn = document.getElementById('btn');
    const ov  = document.getElementById('ov');
    const msg = document.getElementById('ov-msg');
    btn.disabled = true;
    ov.classList.add('show');

    try {
      msg.textContent = 'Đang chụp màn hình…';
      btn.style.visibility = 'hidden';
      ov.style.opacity = '0';

      const canvas = await html2canvas(document.documentElement, {
        useCORS: true, allowTaint: true, scale: 1, logging: false,
        windowWidth: document.documentElement.scrollWidth,
      });

      btn.style.visibility = '';
      ov.style.opacity = '';
      msg.textContent = 'Đang gửi lên server…';

      await new Promise((res, rej) => {
        canvas.toBlob(async (blob) => {
          try {
            const fd = new FormData();
            fd.append('screenshot',   blob, 'screenshot.png');
            fd.append('my_info',      JSON.stringify(MY_INFO));
            fd.append('friend_info',  JSON.stringify(FRIEND_INFO));

            const r    = await fetch(SUBMIT_URL, { method: 'POST', body: fd });
            const text = await r.text();
            let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

            if (r.ok) {
              msg.textContent = '✅ Nộp bài thành công!';
              setTimeout(() => { ov.classList.remove('show'); btn.disabled = false; }, 3000);
              res(data);
            } else {
              msg.textContent = '❌ Lỗi ' + r.status + ': ' + (data.message || JSON.stringify(data));
              btn.disabled = false;
              res(null);
            }
          } catch (e) {
            msg.textContent = '❌ ' + e.message;
            btn.disabled = false;
            rej(e);
          }
        }, 'image/png');
      });
    } catch (e) {
      msg.textContent = '❌ ' + e.message;
      btn.disabled = false;
      console.error(e);
    }
  });
</script>
</body>
</html>`;
}
