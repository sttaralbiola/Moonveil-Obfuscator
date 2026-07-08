const express = require("express");
const rateLimit = require("express-rate-limit");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_API_LIMIT = 5;
const WEB_LIMIT = 20;

app.use(express.json({ limit: "1mb" }));

const publicLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: PUBLIC_API_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: `Public API daily limit reached (${PUBLIC_API_LIMIT} requests/day). Try again tomorrow.`,
  },
});

const webLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: WEB_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: `Web dashboard daily limit reached (${WEB_LIMIT} requests/day). Try again tomorrow.`,
  },
});

function clientTypeMiddleware(req, res, next) {
  const clientType = req.headers["x-client-type"] || "public";
  req.clientType = clientType;
  next();
}

app.use("/api/obfuscate", clientTypeMiddleware, (req, res, next) => {
  if (req.clientType === "web") {
    return webLimiter(req, res, next);
  } else {
    return publicLimiter(req, res, next);
  }
});

const VALID_PRESETS = ["Minify", "Weak", "Medium", "Strong"];

const RECAPTCHA_SITE_KEY = "6LeqT0otAAAAAM8pq0CLcN9367Ya-jVAn0wVQg0n";
const RECAPTCHA_SECRET_KEY = "6LeqT0otAAAAACWkh7XC8UsQbNxVtSFo8YHKRJcV";

async function verifyRecaptcha(token) {
  const url = "https://www.google.com/recaptcha/api/siteverify";
  const params = new URLSearchParams({
    secret: RECAPTCHA_SECRET_KEY,
    response: token,
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await response.json();
    return data.success === true;
  } catch (err) {
    console.error("reCAPTCHA verification error:", err);
    return false;
  }
}

app.post("/api/obfuscate", async (req, res) => {
  const { code, preset, recaptchaToken } = req.body || {};

  if (req.clientType === "web") {
    if (!recaptchaToken) {
      return res.status(400).json({ error: "reCAPTCHA verification required." });
    }
    const isValid = await verifyRecaptcha(recaptchaToken);
    if (!isValid) {
      return res.status(400).json({ error: "reCAPTCHA verification failed. Please try again." });
    }
  }

  if (typeof code !== "string" || code.trim().length === 0) {
    return res.status(400).json({ error: "Missing 'code' in request body." });
  }
  if (code.length > 200000) {
    return res.status(400).json({ error: "Script too large (200KB max)." });
  }
  const chosenPreset = VALID_PRESETS.includes(preset) ? preset : "Medium";

  const id = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(os.tmpdir(), `moonveil-${id}.lua`);
  const outputPath = path.join(os.tmpdir(), `moonveil-${id}.obfuscated.lua`);

  fs.writeFile(inputPath, code, (writeErr) => {
    if (writeErr) {
      return res.status(500).json({ error: "Could not write temp file." });
    }

    execFile(
      "lua5.1",
      ["prometheus/cli.lua", "--preset", chosenPreset, inputPath],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.unlink(inputPath, () => {});

        if (err) {
          fs.unlink(outputPath, () => {});
          return res.status(500).json({
            error: "Obfuscation failed.",
            details: (stderr || err.message || "").slice(0, 500),
          });
        }

        fs.readFile(outputPath, "utf8", (readErr, data) => {
          fs.unlink(outputPath, () => {});

          if (readErr) {
            return res.status(500).json({
              error: "Could not read obfuscated output file.",
              details: readErr.message,
            });
          }

          if (!data || data.trim().length === 0) {
            return res.status(500).json({ error: "Obfuscator returned empty output." });
          }

          const credit = "-- Obfuscated by Moonveil Obfuscator\n-- https://moonveil-obfuscator.onrender.com\n\n";
          const resultWithCredit = credit + data;

          res.json({ result: resultWithCredit, preset: chosenPreset });
        });
      }
    );
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/", (req, res) => {
  res.type("html").send(HTML_PAGE);
});

app.listen(PORT, () => {
  console.log(`Moonveil Obfuscator listening on port ${PORT}`);
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Moonveil Obfuscator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
<style>
  :root{
    --bg: #0b0e14;
    --panel: #12161f;
    --panel-2: #171c27;
    --border: #232937;
    --text: #e4e7ec;
    --muted: #6b7688;
    --accent: #8fa8d9;
    --accent-2: #a78bfa;
    --good: #6ee7b7;
    --bad: #f87171;
  }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{
    background:var(--bg); color:var(--text);
    font-family:'IBM Plex Mono', monospace;
    display:flex; min-height:100vh;
  }
  h1,h2,h3,.display{font-family:'Space Grotesk', sans-serif;}
  a{color:inherit;}

  .sidebar{
    width:220px; flex-shrink:0;
    background:var(--panel); border-right:1px solid var(--border);
    padding:28px 18px; display:flex; flex-direction:column; gap:6px;
    position:sticky; top:0; height:100vh; overflow-y:auto;
  }
  .logo{ display:flex; align-items:center; gap:10px; margin-bottom:28px; padding-left:4px;}
  .moon{ width:22px;height:22px;border-radius:50%; background:linear-gradient(135deg, var(--accent), var(--accent-2)); position:relative; flex-shrink:0;}
  .moon::after{ content:''; position:absolute; top:0; left:6px; width:22px;height:22px;border-radius:50%; background:var(--panel);}
  .logo-text{font-weight:600; font-size:15px;}
  .logo-text span{color:var(--accent);}

  .nav-item{
    display:flex; align-items:center; gap:10px; padding:10px 12px;
    border-radius:8px; font-size:13px; color:var(--muted);
    cursor:pointer; border:1px solid transparent; transition:.15s;
  }
  .nav-item:hover{ color:var(--text); background:var(--panel-2); }
  .nav-item.active{ color:var(--text); background:var(--panel-2); border-color:var(--border); }
  .nav-item.active .dot{background:var(--accent);}
  .dot{width:5px;height:5px;border-radius:50%; background:var(--muted); flex-shrink:0;}
  .sidebar-foot{ margin-top:auto; font-size:11px; color:var(--muted); padding-top:14px; border-top:1px solid var(--border);}

  .mobile-bar{
    display:none; align-items:center; justify-content:space-between;
    padding:16px 20px; background:var(--panel); border-bottom:1px solid var(--border);
    position:sticky; top:0; z-index:20;
  }
  .hamburger{
    width:34px; height:34px; border-radius:8px; border:1px solid var(--border);
    background:var(--panel-2); color:var(--text); font-size:16px; cursor:pointer;
  }
  .overlay{
    display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:30;
  }
  .overlay.open{display:block;}
  .mobile-menu{
    position:fixed; top:0; left:0; width:240px; height:100%;
    background:var(--panel); border-right:1px solid var(--border);
    padding:24px 16px; transform:translateX(-100%); transition:transform .2s ease;
    z-index:31; display:flex; flex-direction:column; gap:6px;
  }
  .mobile-menu.open{ transform:translateX(0); }

  main{flex:1; padding:40px 56px; max-width:1000px; width:100%;}
  .section{display:none;}
  .section.active{display:block;}

  .eyebrow{ font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin-bottom:14px;}
  h1.display{ font-size:34px; font-weight:700; line-height:1.2; margin-bottom:14px;}
  h1.display .grad{ background:linear-gradient(90deg,var(--accent),var(--accent-2)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .lead{ color:var(--muted); font-size:14px; max-width:560px; line-height:1.6; margin-bottom:28px;}

  .panel{ background:var(--panel); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:24px;}
  .panel-head{ display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--border); font-size:12px; color:var(--muted); flex-wrap:wrap;}
  .tdot{width:9px;height:9px;border-radius:50%;}

  .toolbar{ display:flex; gap:10px; align-items:center; margin-left:auto; flex-wrap:wrap;}
  select, textarea, input{
    font-family:inherit; background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:6px; padding:8px 10px; font-size:12.5px;
  }
  .grid2{display:grid; grid-template-columns:1fr 1fr;}
  .grid2 > div{padding:14px 16px;}
  .grid2 > div:first-child{border-right:1px solid var(--border);}
  .col-label{font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin-bottom:8px;}
  textarea{width:100%; height:260px; resize:vertical; line-height:1.6;}
  textarea:read-only{color:#c3c9d6;}

  .btn{ font-family:inherit; font-size:13px; padding:10px 18px; border-radius:8px; border:1px solid var(--border); cursor:pointer;}
  .btn-primary{ background:var(--accent); color:#0b0e14; border:none; font-weight:600;}
  .btn-ghost{ background:transparent; color:var(--text);}
  .btn:disabled{opacity:.5; cursor:not-allowed;}

  .status{font-size:12px; margin-top:10px; min-height:16px;}
  .status.err{color:var(--bad);}
  .status.ok{color:var(--good);}

  .stats{display:flex; gap:28px; margin-top:8px; flex-wrap:wrap;}
  .stat b{font-family:'Space Grotesk'; font-size:20px; display:block;}
  .stat span{font-size:11px; color:var(--muted);}

  .prose{color:#c3c9d6; font-size:13.5px; line-height:1.9; max-width:640px;}
  .prose h3{font-size:15px; margin:20px 0 8px; color:var(--text);}
  .prose code{background:var(--panel-2); padding:2px 6px; border-radius:4px; font-size:12.5px;}
  .prose ul, .prose ol{margin-left:20px; margin-bottom:10px;}
  .prose li{margin-bottom:6px;}

  .kv{display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:13px; margin:14px 0;}
  .kv b{color:var(--accent-2);}

  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 100;
    align-items: center;
    justify-content: center;
  }
  .modal-overlay.open {
    display: flex;
  }
  .modal-box {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px 40px;
    max-width: 420px;
    width: 90%;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.8);
  }
  .modal-box h2 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 22px;
    margin-bottom: 12px;
  }
  .modal-box p {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 24px;
  }
  .modal-box .g-recaptcha {
    display: inline-block;
    margin-bottom: 16px;
  }
  .modal-box .btn {
    width: 100%;
    margin-top: 8px;
  }

  @media (max-width: 860px){
    body{flex-direction:column;}
    .sidebar{display:none;}
    .mobile-bar{display:flex;}
    main{padding:28px 20px;}
    .grid2{grid-template-columns:1fr;}
    .grid2 > div:first-child{border-right:none; border-bottom:1px solid var(--border);}
    h1.display{font-size:26px;}
    .stats{gap:20px;}
  }
</style>
</head>
<body>

  <div class="mobile-bar">
    <div class="logo"><div class="moon"></div><div class="logo-text">Moon<span>veil</span></div></div>
    <button class="hamburger" id="hamburgerBtn">☰</button>
  </div>
  <div class="overlay" id="overlay"></div>
  <div class="mobile-menu" id="mobileMenu">
    <div class="nav-item active" data-section="obfuscator"><span class="dot"></span> Obfuscator</div>
    <div class="nav-item" data-section="howto"><span class="dot"></span> How to use</div>
    <div class="nav-item" data-section="why"><span class="dot"></span> Why use Obfuscator</div>
    <div class="nav-item" data-section="privacy"><span class="dot"></span> Privacy &amp; Policy</div>
    <div class="nav-item" data-section="apidocs"><span class="dot"></span> API Docs</div>
  </div>

  <aside class="sidebar">
    <div class="logo"><div class="moon"></div><div class="logo-text">Moon<span>veil</span></div></div>
    <div class="nav-item active" data-section="obfuscator"><span class="dot"></span> Obfuscator</div>
    <div class="nav-item" data-section="howto"><span class="dot"></span> How to use</div>
    <div class="nav-item" data-section="why"><span class="dot"></span> Why use Obfuscator</div>
    <div class="nav-item" data-section="privacy"><span class="dot"></span> Privacy &amp; Policy</div>
    <div class="nav-item" data-section="apidocs"><span class="dot"></span> API Docs</div>
    <div class="sidebar-foot">v1.0 · powered by Prometheus</div>
    <div style="margin-top:16px; padding:8px 0; border-top:1px solid var(--border); text-align:center;">
      <div id="container-5952bfce13644b78ffd9d0a04528e086"></div>
    </div>
  </aside>

  <main>

    <section class="section active" id="sec-obfuscator">
      <div class="eyebrow">Lua obfuscation, self-hosted</div>
      <h1 class="display">Protect your scripts<br>before they leave <span class="grad">your hands.</span></h1>
      <p class="lead">Paste your Luau below, pick a preset, and Moonveil runs it through Prometheus for you.</p>

      <div class="panel">
        <div class="panel-head">
          <span class="tdot" style="background:#ff5f57"></span>
          <span class="tdot" style="background:#febc2e"></span>
          <span class="tdot" style="background:#28c840"></span>
          <span style="margin-left:8px;">script.lua</span>
          <div class="toolbar">
            <select id="presetSelect">
              <option value="Minify">Minify</option>
              <option value="Weak">Weak</option>
              <option value="Medium" selected>Medium</option>
              <option value="Strong">Strong</option>
            </select>
            <button class="btn btn-primary" id="obfuscateBtn">Obfuscate →</button>
          </div>
        </div>
        <div class="grid2">
          <div>
            <div class="col-label">Input</div>
            <textarea id="inputCode" placeholder="local function greet(name)&#10;  print('Hello, ' .. name)&#10;end&#10;greet('Player')"></textarea>
          </div>
          <div>
            <div class="col-label">Output</div>
            <textarea id="outputCode" readonly placeholder="Obfuscated result will appear here..."></textarea>
          </div>
        </div>
        <div style="padding:0 16px 16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
          <button class="btn btn-ghost" id="copyBtn">Copy output</button>
          <button class="btn btn-ghost" id="downloadBtn">Download as .lua</button>
          <div class="status" id="statusMsg"></div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><b>4</b><span>obfuscation presets</span></div>
        <div class="stat"><b>&lt;15s</b><span>request timeout</span></div>
        <div class="stat"><b>${WEB_LIMIT}/day</b><span>web dashboard limit</span></div>
        <div class="stat"><b>${PUBLIC_API_LIMIT}/day</b><span>public API limit</span></div>
      </div>
    </section>

    <section class="section" id="sec-howto">
      <div class="eyebrow">Getting started</div>
      <h1 class="display">How to use Moonveil</h1>
      <div class="prose">
        <ol>
          <li>Open the <b>Obfuscator</b> tab.</li>
          <li>Paste your Luau/Lua script into the <b>Input</b> box.</li>
          <li>Choose a preset — <code>Minify</code> for light cleanup, <code>Strong</code> for maximum obfuscation.</li>
          <li>Click <b>Obfuscate →</b> – you'll need to complete a reCAPTCHA verification (once per session).</li>
          <li>After verification, the obfuscation runs and the result appears in the Output box.</li>
          <li>Copy the result or download it as a .lua file.</li>
        </ol>
        <h3>Presets explained</h3>
        <ul>
          <li><b>Minify</b> — strips whitespace/comments, barely changes structure.</li>
          <li><b>Weak</b> — light renaming and basic control-flow changes.</li>
          <li><b>Medium</b> — balanced: harder to read, still reasonably fast to run.</li>
          <li><b>Strong</b> — heaviest transformation, slower script, hardest to reverse.</li>
        </ul>
        <h3>Prefer the API?</h3>
        <p>See the <b>API Docs</b> tab for the same functionality via <code>curl</code> or your own scripts.</p>
      </div>
    </section>

    <section class="section" id="sec-why">
      <div class="eyebrow">The case for obfuscation</div>
      <h1 class="display">Why use an Obfuscator</h1>
      <div class="prose">
        <p>Roblox scripts run client-side in many cases, which means anyone can extract and read your source if it's shipped in plain text.</p>
        <h3>Obfuscation helps you:</h3>
        <ul>
          <li>Make it impractical for others to copy your game logic wholesale.</li>
          <li>Slow down cheat developers looking for exploitable values or remotes.</li>
          <li>Protect anti-cheat and monetization logic from casual tampering.</li>
        </ul>
        <h3>What it won't do</h3>
        <p>Obfuscation raises the cost of reverse-engineering — it doesn't make a script literally unreadable forever. Treat it as one layer of protection, not the only one.</p>
      </div>
    </section>

    <section class="section" id="sec-privacy">
      <div class="eyebrow">Legal</div>
      <h1 class="display">Privacy &amp; Policy</h1>
      <div class="prose">
        <ul>
          <li>Scripts submitted for obfuscation are written to a temporary file, processed, and deleted immediately after the response is sent.</li>
          <li>We do not store, log, or share the contents of submitted scripts.</li>
          <li>Basic request metadata (IP address, timestamp) is used only to enforce the daily rate limit and is not retained long-term.</li>
          <li>Don't submit scripts you don't have the right to obfuscate or that contain sensitive credentials — treat this tool like any third-party service.</li>
          <li>reCAPTCHA is provided by Google and is subject to their privacy policy.</li>
        </ul>
      </div>
    </section>

    <section class="section" id="sec-apidocs">
      <div class="eyebrow">Reference</div>
      <h1 class="display">API Docs</h1>
      <div class="prose">
        <h3>Endpoint</h3>
        <p><code>POST /api/obfuscate</code></p>
        <h3>Body (JSON)</h3>
        <div class="kv">
          <b>code</b><span>string — the Lua/Luau source to obfuscate</span>
          <b>preset</b><span>"Minify" | "Weak" | "Medium" | "Strong" (default: Medium)</span>
          <b>recaptchaToken</b><span>string — required for web dashboard requests</span>
        </div>
        <h3>Example</h3>
        <p><code>curl -X POST https://moonveil-obfuscator.onrender.com/api/obfuscate \\<br>
        &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
        &nbsp;&nbsp;-d '{"code":"print(1)","preset":"Strong"}'</code></p>
        <p><em>Note: Public API calls do not require reCAPTCHA.</em></p>
        <h3>Limits</h3>
        <ul>
          <li><b>Public API:</b> ${PUBLIC_API_LIMIT} requests per day per IP.</li>
          <li><b>Web dashboard:</b> ${WEB_LIMIT} requests per day per IP (plus reCAPTCHA).</li>
          <li>Max script size: <b>200KB</b>.</li>
          <li>Request timeout: <b>15 seconds</b>.</li>
        </ul>
        <p>Exceeding the limit returns HTTP 429 with a JSON error message.</p>
      </div>
    </section>

  </main>

  <script async="async" data-cfasync="false" src="https://pl30259060.effectivecpmnetwork.com/5952bfce13644b78ffd9d0a04528e086/invoke.js"></script>

  <div class="modal-overlay" id="recaptchaModal">
    <div class="modal-box">
      <h2>🔐 Human Verification</h2>
      <p>Please complete the reCAPTCHA to prove you're human.</p>
      <div class="g-recaptcha" data-sitekey="${RECAPTCHA_SITE_KEY}" data-callback="onRecaptchaSuccess" data-expired-callback="onRecaptchaExpired"></div>
      <button class="btn btn-primary" id="modalVerifyBtn" disabled>Verify & Obfuscate</button>
      <div style="margin-top:10px; font-size:12px; color:var(--muted);">
        <span id="modalStatus"></span>
      </div>
    </div>
  </div>

  <script>
    const sections = document.querySelectorAll('.section');
    const navItems = document.querySelectorAll('.nav-item');

    function showSection(name){
      sections.forEach(s => s.classList.toggle('active', s.id === 'sec-' + name));
      navItems.forEach(n => n.classList.toggle('active', n.dataset.section === name));
      closeMobileMenu();
    }
    navItems.forEach(item => {
      item.addEventListener('click', () => showSection(item.dataset.section));
    });

    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const overlay = document.getElementById('overlay');
    const mobileMenu = document.getElementById('mobileMenu');
    function openMobileMenu(){ overlay.classList.add('open'); mobileMenu.classList.add('open'); }
    function closeMobileMenu(){ overlay.classList.remove('open'); mobileMenu.classList.remove('open'); }
    hamburgerBtn.addEventListener('click', openMobileMenu);
    overlay.addEventListener('click', closeMobileMenu);

    const obfuscateBtn = document.getElementById('obfuscateBtn');
    const inputCode = document.getElementById('inputCode');
    const outputCode = document.getElementById('outputCode');
    const presetSelect = document.getElementById('presetSelect');
    const statusMsg = document.getElementById('statusMsg');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');

    const modal = document.getElementById('recaptchaModal');
    const modalVerifyBtn = document.getElementById('modalVerifyBtn');
    const modalStatus = document.getElementById('modalStatus');

    let pendingObfuscate = null;

    async function sendObfuscateRequest(code, preset, token) {
      try {
        const res = await fetch('/api/obfuscate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Type': 'web'
          },
          body: JSON.stringify({ code, preset, recaptchaToken: token })
        });
        const data = await res.json();
        if (!res.ok) {
          statusMsg.textContent = data.error || 'Something went wrong.';
          statusMsg.className = 'status err';
          return;
        }
        outputCode.value = data.result;
        statusMsg.textContent = 'Done — preset: ' + data.preset;
        statusMsg.className = 'status ok';
      } catch (e) {
        statusMsg.textContent = 'Network error. Try again.';
        statusMsg.className = 'status err';
      } finally {
        obfuscateBtn.disabled = false;
      }
    }

    window.onRecaptchaSuccess = function(token) {
      modalVerifyBtn.disabled = false;
      modalStatus.textContent = '✓ Verified';
      modalStatus.style.color = 'var(--good)';
    };

    window.onRecaptchaExpired = function() {
      modalVerifyBtn.disabled = true;
      modalStatus.textContent = 'Verification expired, please re-solve.';
      modalStatus.style.color = 'var(--bad)';
    };

    obfuscateBtn.addEventListener('click', () => {
      const code = inputCode.value;
      if (!code.trim()) {
        statusMsg.textContent = 'Paste a script first.';
        statusMsg.className = 'status err';
        return;
      }

      const savedToken = sessionStorage.getItem('recaptchaToken');
      if (savedToken) {
        obfuscateBtn.disabled = true;
        statusMsg.textContent = 'Obfuscating...';
        statusMsg.className = 'status';
        sendObfuscateRequest(code, presetSelect.value, savedToken);
        return;
      }

      pendingObfuscate = { code, preset: presetSelect.value };
      modal.classList.add('open');
      modalStatus.textContent = 'Please solve the reCAPTCHA.';
      modalStatus.style.color = 'var(--muted)';
      modalVerifyBtn.disabled = true;
      if (typeof grecaptcha !== 'undefined' && grecaptcha.reset) {
        grecaptcha.reset();
      }
    });

    modalVerifyBtn.addEventListener('click', async () => {
      if (!pendingObfuscate) return;
      const token = document.querySelector('.g-recaptcha-response')?.value;
      if (!token) {
        modalStatus.textContent = 'Please solve the reCAPTCHA first.';
        modalStatus.style.color = 'var(--bad)';
        return;
      }

      sessionStorage.setItem('recaptchaToken', token);
      modal.classList.remove('open');

      obfuscateBtn.disabled = true;
      statusMsg.textContent = 'Obfuscating...';
      statusMsg.className = 'status';
      await sendObfuscateRequest(pendingObfuscate.code, pendingObfuscate.preset, token);
      pendingObfuscate = null;
    });

    copyBtn.addEventListener('click', () => {
      if (!outputCode.value) return;
      navigator.clipboard.writeText(outputCode.value);
      statusMsg.textContent = 'Copied to clipboard.';
      statusMsg.className = 'status ok';
    });

    downloadBtn.addEventListener('click', () => {
      const content = outputCode.value;
      if (!content) {
        statusMsg.textContent = 'Nothing to download — obfuscate first.';
        statusMsg.className = 'status err';
        return;
      }
      const random = Math.random().toString(36).substring(2, 8);
      const filename = 'moonveil-obfuscated-' + random + '.lua';
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      statusMsg.textContent = 'Downloaded as ' + filename;
      statusMsg.className = 'status ok';
    });
  </script>
</body>
</html>`;
