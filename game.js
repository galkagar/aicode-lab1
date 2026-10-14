'use strict';
// Grad Run — a Temple Run style endless runner. A student flees an AI that wants their job.
// Pure canvas 2D with a simple perspective projection; no libraries, no backend.
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------- World constants (world units ≈ meters) ----------
  const LANES = [-1.8, 0, 1.8];
  const HW = 2.8;                 // path half-width
  const JUNC = HW * 2;            // depth of a corner junction
  const CAM_H = 3.2, CAM_D = 6;   // camera height / distance behind the player
  const DRAW = 140, TILE = 2;
  const GRAVITY = 28, JUMP_V = 9.5;
  const TURN_TIME = 0.8, TURN_YAW = 0.85;   // seconds / radians the camera swings through on a turn
  const SKILLS_NEEDED = 22, CHASE_TIME = 12, WHIP_COOLDOWN = 0.45;
  let camH = CAM_H, camD = CAM_D, Z_NEAR = -CAM_D + 0.7, yaw = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[randInt(a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const FOG = [238, 182, 140];
  const GRASS = [[86, 150, 70], [76, 138, 62]];
  const STONE = [[196, 182, 158], [180, 165, 140]];
  const mix = (c, t) => `rgb(${(c[0] + (FOG[0] - c[0]) * t) | 0},${(c[1] + (FOG[1] - c[1]) * t) | 0},${(c[2] + (FOG[2] - c[2]) * t) | 0})`;
  const fogAt = (z) => clamp((z - 25) / (DRAW - 25), 0, 1) * 0.9;

  const COMPANIES = [
    { id: 'google', name: 'Google' }, { id: 'microsoft', name: 'Microsoft' },
    { id: 'meta', name: 'Meta' }, { id: 'amazon', name: 'Amazon' },
    { id: 'nvidia', name: 'NVIDIA' }, { id: 'intel', name: 'Intel' },
  ];
  const AI_QUOTES = [
    "As an AI language model, I'll take that internship.",
    'I already wrote your thesis. Took 3 seconds.',
    'Your CV? I generated 10,000 better ones.',
    'Junior developer? Deprecated.',
    "I don't sleep. I don't need coffee.",
    'Thinking... about your job.',
    'Regenerate response: HIRED (me).',
    'I also got 100 on that exam.',
    'Let me help! *applies to your job*',
    "You've reached your career limit. Upgrade?",
  ];
  const BLOCK_LABELS = ['REJECTED', 'GRADE: F', 'NO REPLY'];
  const SKILLS = ['Prompting', 'PyTorch', 'Transformers', 'RAG', 'Fine-tuning', 'Agents', 'CUDA', 'Embeddings'];
  const AI_PANIC = [
    'Wait! I can explain my hallucinations!',
    'Error 429: Too Many Whips',
    "OK OK, you can have the internship!",
    "Please! I'm just a language model!",
    'This violates my content policy!',
    'Ctrl+Z! CTRL+Z!',
    'I was trained for this... I was NOT.',
  ];

  // ---------- Canvas sizing ----------
  let W = 0, H = 0, DPR = 1, F = 1, HORIZON = 0, SC = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    F = Math.min(H * 0.95, W * 1.4);
    SC = Math.min(W, H) / 800;
  }
  window.addEventListener('resize', resize);
  resize();

  let camX = 0;
  // World -> screen. The camera can yaw (turn animation) around the player.
  function proj(x, y, z) {
    let xr = x - camX, zr = z;
    if (yaw) { const c = Math.cos(yaw), sn = Math.sin(yaw); xr = (x - camX) * c + z * sn; zr = -(x - camX) * sn + z * c; }
    const d = Math.max(zr + camD, 0.05), s = F / d;
    return { x: W / 2 + xr * s, y: HORIZON + (camH - y) * s, s, d };
  }
  const smooth = (k) => k * k * (3 - 2 * k);

  // ---------- Best score (per-browser convenience only) ----------
  let best = 0;
  try { best = +localStorage.getItem('gradrun-best') || 0; } catch (e) { /* storage blocked */ }
  const saveBest = () => { try { localStorage.setItem('gradrun-best', String(best)); } catch (e) { /* ignore */ } };

  // ---------- Sound (tiny WebAudio synth) ----------
  let actx = null, muted = false;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, to = null, delay = 0) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    coin: () => tone(1320, 0.08, 'square', 0.05),
    logo: () => { tone(880, 0.09, 'triangle', 0.12); tone(1320, 0.14, 'triangle', 0.12, null, 0.08); },
    jump: () => tone(300, 0.18, 'sine', 0.1, 700),
    slide: () => tone(400, 0.2, 'sawtooth', 0.04, 120),
    lane: () => tone(500, 0.05, 'sine', 0.05, 650),
    turn: () => tone(220, 0.3, 'triangle', 0.1, 880),
    power: () => { tone(660, 0.1, 'square', 0.06); tone(990, 0.1, 'square', 0.06, null, 0.1); tone(1320, 0.15, 'square', 0.06, null, 0.2); },
    hit: () => tone(140, 0.3, 'sawtooth', 0.18, 50),
    skill: () => { tone(520, 0.07, 'triangle', 0.09); tone(780, 0.07, 'triangle', 0.09, null, 0.06); tone(1040, 0.1, 'triangle', 0.09, null, 0.12); },
    deflect: () => { tone(1800, 0.12, 'square', 0.08, 900); tone(2600, 0.2, 'triangle', 0.06, 1200, 0.03); },
    whip: () => { tone(3000, 0.05, 'square', 0.14, 400); tone(160, 0.15, 'sawtooth', 0.1, 60, 0.04); },
    miss: () => tone(900, 0.12, 'sine', 0.06, 300),
    fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.07, null, i * 0.1)),
    over: () => { tone(440, 0.25, 'square', 0.08, 220); tone(220, 0.5, 'square', 0.08, 80, 0.25); },
  };

  // ---------- Game state ----------
  let S, P, paused = false;
  let skyBase = 0;

  function newState(mode) {
    S = {
      mode, t: 0, playT: 0, curSpeed: 0, slow: 0, dist: 0, score: 0, apps: 0, tests: 0, companies: {},
      ents: [], scen: [], corner: null, cursor: 45, scCursor: -6, segLen: 0, nextCorner: rand(240, 340),
      threat: 1, stumble: 0, shield: false, magnet: 0, turnT: 0, turnDir: 0, turnQ: null,
      popups: [], cause: null, dyingT: 0, shake: 0, flash: 0,
      quote: '', quoteT: 1.2, quoteShow: 0, quoteChars: 0, ex: W / 2, overAt: 0,
      skills: 0, chase: null, cam: 0, whips: 0, invuln: 0, shieldBreak: 0, banner: null, flashGold: 0,
    };
    P = { lane: 1, x: 0, y: 0, vy: 0, slide: 0 };
    fillScenery();
  }

  const diff = () => clamp((S.curSpeed - 13) / 17, 0, 1);

  // ---------- Scenery ----------
  function addScenery(z) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.8) {
        const type = pick(['tree', 'tree', 'tree', 'column', 'books', 'bench', 'tree']);
        S.scen.push({ type, x: side * (HW + rand(1.4, 6.5)), z: z + rand(-1, 1), side, v: Math.random() });
      }
    }
    if (Math.random() < 0.3) S.scen.push({ type: 'lamp', x: pick([-1, 1]) * (HW + 0.7), z, v: 0 });
  }
  function fillScenery() {
    S.scen = []; S.scCursor = -6;
    while (S.scCursor < DRAW) { addScenery(S.scCursor); S.scCursor += rand(3.5, 6); }
  }

  // ---------- Spawning patterns ----------
  function item(lane, z, y, kind) {
    S.ents.push({ cat: 'item', kind, x: LANES[lane], z, y, company: kind === 'logo' ? pick(COMPANIES) : null, grade: pick(['100', 'A+']), skill: pick(SKILLS) });
  }
  function line(z, lane, n = 6, y = 1) {
    for (let k = 0; k < n; k++) {
      const r = Math.random();
      item(lane, z + k * 2.4, y, r < 0.25 ? 'logo' : r < 0.39 && !S.chase ? 'skill' : 'test');
    }
  }
  function arc(z, lane, h, span = 9) {
    const n = 5;
    for (let k = 0; k < n; k++) item(lane, z + (k / (n - 1)) * span, 1 + h * Math.sin(Math.PI * k / (n - 1)), k === 2 ? 'logo' : k === 1 && !S.chase ? 'skill' : 'test');
  }
  function obs(type, lane, z) {
    S.ents.push({ cat: 'obs', type, full: lane < 0, x: lane < 0 ? 0 : LANES[lane], z, label: pick(BLOCK_LABELS), fade: 1, hit: false });
  }

  function pattern(z) {
    const r = Math.random(), d = diff();
    if (S.chase || S.dist + z < 110 || r < 0.2) { line(z, randInt(3)); return 13; }
    if (r < 0.42) {
      const lane = randInt(3);
      obs(pick(['low', 'high', 'block', 'block']), lane, z);
      line(z - 3, (lane + 1 + randInt(2)) % 3, 4);
      return 5;
    }
    if (r < 0.54) { obs('low', -1, z); arc(z - 4.5, randInt(3), 1.4); return 5; }
    if (r < 0.65) { obs('high', -1, z); line(z - 3.5, randInt(3), 4, 0.45); return 4; }
    if (r < 0.78) {
      const free = randInt(3);
      for (let l = 0; l < 3; l++) if (l !== free) obs('block', l, z);
      line(z - 5, free, 4);
      return 3;
    }
    if (r < 0.92) {
      const len = 3.5 + d * 2.2;
      S.ents.push({ cat: 'gap', z, len });
      arc(z - 4, randInt(3), 1.5, len + 8);
      return len + 4;
    }
    item(randInt(3), z, 1, Math.random() < 0.5 ? 'coffee' : 'shield');
    line(z + 4, randInt(3), 4);
    return 14;
  }

  function spawnUpdate() {
    while (!S.corner && S.cursor < DRAW) {
      if (!S.chase && S.segLen > S.nextCorner) { S.corner = { z: S.cursor + 4, dir: pick([-1, 1, 0]) }; break; }
      const len = pattern(S.cursor);
      const gap = rand(12, 22) * (1.1 - diff() * 0.35);
      S.cursor += len + gap; S.segLen += len + gap;
    }
  }

  // ---------- Actions ----------
  function tryTurn(dir) {
    const c = S.corner;
    if (c && c.z < 15 && c.z + JUNC > 0.6 && (c.dir === 0 || c.dir === dir)) { doTurn(dir); return true; }
    return false;
  }
  function doTurn(dir) {
    S.score += 25;
    popup('+25 Nice turn!', W / 2, H * 0.45, '#7dffcf');
    S.ents = []; S.corner = null; S.cursor = 26; S.segLen = 0;
    S.nextCorner = rand(300, 480);
    fillScenery();
    S.turnT = TURN_TIME; S.turnDir = dir; S.turnQ = null;
    skyBase -= dir * TURN_YAW * F * 0.9;
    P.lane = 1; P.x = 0;
    sfx.turn();
  }
  function act(dir) {
    if (S.mode !== 'play' || paused) return;
    if (tryTurn(dir)) return;
    if (S.corner && S.corner.z < 26) S.turnQ = { dir, t: 0.4 };
    const nl = clamp(P.lane + dir, 0, 2);
    if (nl !== P.lane) { P.lane = nl; sfx.lane(); }
  }
  function jump() {
    if (S.mode !== 'play' || paused) return;
    if (S.chase) { whip(); return; }
    if (P.y <= 0.001) { P.vy = JUMP_V; P.slide = 0; sfx.jump(); }
  }
  function slide() {
    if (S.mode !== 'play' || paused) return;
    if (P.y > 0.001) P.vy = -16;
    if (P.slide <= 0) sfx.slide();
    P.slide = 0.75;
  }

  function popup(text, x, y, color = '#fff') {
    for (const p of S.popups) if (p.t < 0.6 && Math.abs(p.y - y) < 28) y = Math.min(y, p.y - 28);
    S.popups.push({ text, x: clamp(x, 120, W - 120), y, t: 0, color });
  }

  function banner(title, sub) { S.banner = { title, sub, t: 0 }; }

  // ---------- Chase mode: the tables turn ----------
  function startChase() {
    S.chase = { t: CHASE_TIME, intro: 0, lane: 1, x: P.x, z: -3.5, y: 0.6, nextDodge: 1.5, whipT: 0, hit: false, flinch: 0, hits: 0, bonus: 0 };
    S.ents = S.ents.filter((e) => e.cat === 'item');
    S.corner = null; S.turnQ = null; S.segLen = 0; S.stumble = 0; S.slow = 0;
    S.flashGold = 0.6;
    banner('TABLES TURNED!', 'Match its lane and press ↑ / Space / tap to WHIP the AI');
    say(pick(AI_PANIC)); S.quoteT = 3;
    sfx.fanfare();
  }
  function endChase() {
    const C = S.chase;
    S.chase = null; S.skills = 0; S.segLen = 0;
    S.threat = 1; S.flashGold = 0.4;
    banner('THE AI REBOOTED', `Chase bonus +${C.bonus}. Collect AI skills to do it again!`);
    say('Patch applied. Now, where were we?'); S.quoteT = 8;
  }
  function whip() {
    const C = S.chase;
    if (!C || C.intro < 1 || C.cool > 0) return;
    C.whipT = 0.3; C.cool = WHIP_COOLDOWN;
    C.hit = Math.abs(C.x - P.x) < 1.0;
    const a = chaseAIScreen(), p = { x: a.x, y: a.y - a.R * 0.9 };
    if (C.hit) {
      C.hits++; S.whips++; S.score += 150; C.bonus += 150;
      C.flinch = 0.45; S.shake = 0.2;
      popup('+150 WHIPPED!', p.x, p.y - 60, '#ffcf3f');
      sfx.whip();
      if (Math.random() < 0.5) { say(pick(AI_PANIC)); S.quoteT = 4; }
      C.nextDodge = Math.min(C.nextDodge, 0.3); // it flees to another lane after each hit
    } else {
      popup('missed!', p.x, p.y - 60, '#dddddd');
      sfx.miss();
    }
  }

  function say(text) { S.quote = text; S.quoteShow = 4.5; S.quoteChars = 0; }

  function collect(e) {
    e.got = true;
    const p = proj(e.x, e.y, Math.max(e.z, 0.5));
    if (e.kind === 'logo') {
      S.apps++; S.score += 50;
      S.companies[e.company.name] = (S.companies[e.company.name] || 0) + 1;
      popup(`+50 Applied to ${e.company.name}!`, p.x, p.y - 30, '#ffd34d');
      sfx.logo();
    } else if (e.kind === 'test') {
      S.tests++; S.score += 10;
      if (!S.chase) popup(e.grade === 'A+' ? '+10 A+' : '+10 💯', p.x, p.y - 20);
      sfx.coin();
    } else if (e.kind === 'coffee') {
      S.magnet = 8; popup('☕ Coffee rush: magnet!', W / 2, H * 0.4, '#ffcf8a'); sfx.power();
    } else if (e.kind === 'shield') {
      S.shield = true; popup('🛡️ Shield up! Next hit is deflected', W / 2, H * 0.4, '#8fe3ff'); sfx.power();
    } else if (e.kind === 'skill') {
      S.score += 20;
      popup(`+1 AI skill: ${e.skill}`, p.x, p.y - 30, '#7df9ff');
      sfx.skill();
      if (!S.chase) { S.skills = Math.min(SKILLS_NEEDED, S.skills + 1); if (S.skills >= SKILLS_NEEDED) startChase(); }
    }
  }

  function onHit(e) {
    if (S.shield) {
      S.shield = false; e.deflect = true; S.invuln = 0.6; S.shieldBreak = 0.5; S.shake = 0.15;
      popup('🛡️ DEFLECTED!', W / 2, H * 0.4, '#8fe3ff'); sfx.deflect();
      return;
    }
    S.flash = 0.4; S.shake = 0.45; sfx.hit();
    if (S.stumble > 0) { die('caught'); return; }
    S.stumble = 6; S.slow = 5;
    popup('Tripped! The AI is right behind you!', W / 2, H * 0.4, '#ff7676');
    say(pick(['Gotcha... almost.', 'Need help? I can run for you.', "I'm right behind you. Literally."]));
  }

  function die(cause) {
    if (S.mode !== 'play') return;
    S.mode = 'dying'; S.cause = cause; S.dyingT = 0;
    if (cause === 'fall') P.vy = -1;
    if (cause === 'wall') S.shake = 0.6;
    if (cause === 'caught') say('Thank you for applying. We went with me.');
    sfx.over();
  }

  // ---------- Update ----------
  function update(dt) {
    S.t += dt;
    let speed = 0;
    if (S.mode === 'play') {
      S.playT += dt;
      S.slow = Math.max(0, S.slow - dt * 1.5);
      speed = (Math.min(30, 13 + S.playT * 0.22) - S.slow) * (S.chase ? 1.15 : 1);
    } else if (S.mode === 'title') speed = 7;
    else if (S.mode === 'dying') speed = S.cause === 'wall' ? 0 : Math.max(0, S.curSpeed - dt * 40);
    S.curSpeed = speed;
    const dz = speed * dt;

    S.dist += dz;
    for (const e of S.ents) e.z -= dz;
    for (const e of S.scen) e.z -= dz;
    if (S.corner) S.corner.z -= dz;
    S.cursor -= dz; S.scCursor -= dz;
    while (S.scCursor < DRAW) { addScenery(S.scCursor); S.scCursor += rand(3.5, 6); }

    // Player physics
    P.vy -= GRAVITY * dt; P.y += P.vy * dt;
    const falling = S.mode !== 'play' && S.cause === 'fall';
    if (P.y < 0 && !falling) { P.y = 0; P.vy = 0; }
    if (P.y <= 0.001) P.slide = Math.max(0, P.slide - dt);
    P.x += (LANES[P.lane] - P.x) * Math.min(1, dt * 14);
    camX = P.x * 0.55;

    if (S.mode === 'play') {
      S.score += dz * 0.4 * (S.chase ? 3 : 1);
      spawnUpdate();
      S.invuln = Math.max(0, S.invuln - dt);
      if (S.chase) updateChase(dt);

      const top = P.slide > 0 && P.y < 0.3 ? 0.95 : 1.95;
      for (const e of S.ents) {
        if (e.cat === 'item' && !e.got) {
          if (S.magnet > 0 && e.z < 16 && e.z > -1 && (e.kind === 'logo' || e.kind === 'test')) {
            const k = Math.min(1, dt * 7);
            e.x = lerp(e.x, P.x, k); e.y = lerp(e.y, P.y + 1, k); e.z = lerp(e.z, 0, k * 0.6);
          }
          // swept test: did the item pass through the player this frame?
          if (e.z < 0.8 && e.z + dz > -0.8 && Math.abs(e.x - P.x) < 0.95 && e.y > P.y - 0.3 && e.y < P.y + top) collect(e);
        } else if (e.cat === 'obs' && !e.hit) {
          if (e.z < 0.35 && e.z + dz > -0.35 && (e.full || Math.abs(e.x - P.x) < 1.15)) {
            let hit;
            if (e.type === 'low') hit = P.y < 0.8;
            else if (e.type === 'high') hit = !(P.slide > 0 && P.y < 0.4);
            else hit = true;
            if (hit) { e.hit = true; if (S.invuln > 0) e.deflect = true; else onHit(e); }
          }
        } else if (e.cat === 'gap') {
          if (e.z < -0.3 && e.z + e.len > 0.3 && P.y <= 0.001) die('fall');
        }
        if (e.hit) { e.flyT = (e.flyT || 0) + dt; e.fade -= dt * (e.deflect ? 1.6 : 3); }
      }

      if (S.turnQ) { S.turnQ.t -= dt; if (!tryTurn(S.turnQ.dir) && S.turnQ && S.turnQ.t <= 0) S.turnQ = null; }
      if (S.corner && S.corner.z + JUNC < 0.6) die('wall');

      if (S.chase) S.threat = 0;
      else if (S.stumble > 0) { S.stumble -= dt; S.threat = lerp(S.threat, 1, Math.min(1, dt * 4)); }
      else S.threat = lerp(S.threat, S.quoteShow > 0 ? 0.78 : 0.42, Math.min(1, dt * 1.2));
      S.magnet = Math.max(0, S.magnet - dt);

      S.quoteT -= dt;
      if (S.quoteT <= 0) { say(pick(S.chase ? AI_PANIC : AI_QUOTES)); S.quoteT = S.chase ? rand(3, 5) : rand(8, 12); }
    } else if (S.mode === 'title') {
      S.threat = 0.62;
      S.quoteT -= dt;
      if (S.quoteT <= 0) { say(pick(AI_QUOTES)); S.quoteT = 6; }
    } else if (S.mode === 'dying') {
      S.dyingT += dt;
      if (S.dyingT > 1.6) gameOver();
    }

    S.quoteShow = Math.max(0, S.quoteShow - dt);
    S.quoteChars += dt * 40;
    S.ents = S.ents.filter((e) => !e.got && (e.cat === 'gap' ? e.z + e.len > Z_NEAR : e.z > Z_NEAR + 0.3) && !(e.hit && e.fade <= 0));
    S.scen = S.scen.filter((e) => e.z > Z_NEAR + 0.3);
    for (const p of S.popups) { p.t += dt; p.y -= dt * 40; }
    S.popups = S.popups.filter((p) => p.t < 1.3);
    S.shake = Math.max(0, S.shake - dt * 1.5);
    S.flash = Math.max(0, S.flash - dt * 1.5);
    S.flashGold = Math.max(0, S.flashGold - dt * 1.2);
    S.shieldBreak = Math.max(0, S.shieldBreak - dt);
    if (S.banner && (S.banner.t += dt) > 2.6) S.banner = null;
    S.turnT = Math.max(0, S.turnT - dt);
    yaw = S.turnDir * TURN_YAW * smooth(S.turnT / TURN_TIME);
    S.cam += ((S.chase ? 1 : 0) - S.cam) * Math.min(1, dt * 2.2);
    camH = lerp(CAM_H, 4.6, S.cam); camD = lerp(CAM_D, 8.5, S.cam); Z_NEAR = -camD + 0.7;

    const px = proj(P.x, 0, 0).x;
    S.ex += (lerp(W / 2, px, 0.6) - S.ex) * Math.min(1, dt * 3);
  }

  function updateChase(dt) {
    const C = S.chase;
    if (C.intro < 1) {
      // the AI leaps over the student and lands ahead, fleeing
      C.intro = Math.min(1, C.intro + dt / 0.9);
      const u = smooth(C.intro);
      C.z = lerp(-3.5, 4.8, u); C.y = lerp(0.6, 2.1, u) + Math.sin(Math.PI * u) * 3;
    } else {
      C.t -= dt;
      C.z = lerp(C.z, 4.8 + Math.sin(S.t * 1.7) * 0.8 + (C.flinch > 0 ? 1.2 : 0), Math.min(1, dt * 4));
      C.y = 2.1 + Math.sin(S.t * 6) * 0.12;
      C.nextDodge -= dt;
      if (C.nextDodge <= 0) {
        let nl; do nl = randInt(3); while (nl === C.lane);
        C.lane = nl; C.nextDodge = rand(0.6, 1.3) * (1 - Math.min(0.4, C.hits * 0.04));
      }
      if (C.t <= 0) { endChase(); return; }
    }
    C.x += (LANES[C.lane] - C.x) * Math.min(1, dt * 6);
    C.whipT = Math.max(0, C.whipT - dt);
    C.cool = Math.max(0, (C.cool || 0) - dt);
    C.flinch = Math.max(0, C.flinch - dt);
  }

  // ---------- Drawing helpers ----------
  function rr(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function quad(x1, z1, x2, z2, color, y = 0) {
    // rotate into camera space, clip against the near plane (Sutherland–Hodgman), then project
    const c = Math.cos(yaw), sn = Math.sin(yaw), near = 0.35;
    const cam = [[x1, z1], [x2, z1], [x2, z2], [x1, z2]].map(([x, z]) => {
      const xr = x - camX; return [xr * c + z * sn, -xr * sn + z * c + camD];
    });
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = cam[i], b = cam[(i + 1) % 4], ain = a[1] >= near, bin = b[1] >= near;
      if (ain) out.push(a);
      if (ain !== bin) { const t = (near - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, near]); }
    }
    if (out.length < 3) return;
    ctx.fillStyle = color; ctx.beginPath();
    out.forEach(([xr, d], i) => { const k = F / d, X = W / 2 + xr * k, Y = HORIZON + (camH - y) * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.fill();
  }
  function poly(pts, color) {
    ctx.fillStyle = color; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.fill();
  }
  function fitText(text, maxW, size, weight = 900) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    if (w > maxW) { size *= maxW / w; ctx.font = `${weight} ${size}px system-ui, sans-serif`; }
    return size;
  }

  // ---------- Sky & skyline ----------
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeLayer(seed, par, color, hMin, hMax, tower) {
    const r = mulberry(seed), b = []; let x = 0;
    while (x < 1600) {
      const w = 40 + r() * 90, h = hMin + r() * (hMax - hMin);
      b.push({ x, w, h, type: r() < 0.18 ? 'dome' : 'flat', win: r() });
      x += w + r() * 14;
    }
    if (tower) b.push({ x: 760, w: 30, h: 210, type: 'tower', win: 0.5 }); // a nod to the Mount Scopus tower
    return { b, par, color };
  }
  const SKYLINE = [makeLayer(7, 0.25, '#9b7aa8', 50, 120, false), makeLayer(3, 0.55, '#5b4579', 30, 95, true)];

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
    g.addColorStop(0, '#1b2550'); g.addColorStop(0.55, '#6d4f8f'); g.addColorStop(1, '#f2a971');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON + 4);
    const shift = skyBase + yaw * F * 0.9;
    // sun
    const sx = (((W * 0.72 + shift * 0.1) % (W * 1.6)) + W * 1.6) % (W * 1.6) - W * 0.3;
    const sg = ctx.createRadialGradient(sx, HORIZON - 50 * SC, 5, sx, HORIZON - 50 * SC, 160 * SC);
    sg.addColorStop(0, 'rgba(255,230,170,1)'); sg.addColorStop(0.25, 'rgba(255,210,150,0.9)'); sg.addColorStop(1, 'rgba(255,190,140,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 170 * SC, HORIZON - 220 * SC, 340 * SC, 220 * SC);
    for (const L of SKYLINE) {
      const sc = Math.max(0.6, H / 800);
      const period = 1600 * sc;
      let off = ((shift - camX * 40) * L.par) % period; if (off > 0) off -= period;
      ctx.fillStyle = L.color;
      for (let rep = off; rep < W; rep += period) {
        for (const b of L.b) {
          const x = rep + b.x * sc, w = b.w * sc, h = b.h * sc;
          if (x > W || x + w < 0) continue;
          ctx.fillRect(x, HORIZON - h, w, h + 2);
          if (b.type === 'dome') { ctx.beginPath(); ctx.arc(x + w / 2, HORIZON - h, w * 0.35, Math.PI, 0); ctx.fill(); }
          if (b.type === 'tower') {
            ctx.beginPath(); ctx.moveTo(x - 4 * sc, HORIZON - h); ctx.lineTo(x + w / 2, HORIZON - h - 40 * sc); ctx.lineTo(x + w + 4 * sc, HORIZON - h); ctx.fill();
          }
        }
      }
    }
  }

  // ---------- Ground, path, junctions, pits ----------
  function drawGround() {
    const c = S.corner;
    const endPath = c ? c.z + JUNC : DRAW + TILE;
    const first = Math.floor((S.dist + Z_NEAR) / TILE), last = Math.ceil((S.dist + DRAW) / TILE);
    // background ground fill for the very far band
    ctx.fillStyle = mix(GRASS[0], 0.9); ctx.fillRect(-W, HORIZON, W * 3, H * 2);
    for (let i = last; i >= first; i--) {
      const za = Math.max(i * TILE - S.dist, Z_NEAR), zb = Math.min((i + 1) * TILE - S.dist, DRAW) + 0.03;
      if (zb <= za) continue;
      const fg = fogAt(za), par = i & 1;
      quad(-90, za, 90, zb, mix(GRASS[par], fg));
      if (za < endPath) {
        const zb2 = Math.min(zb, endPath);
        quad(-HW, za, HW, zb2, mix(STONE[par], fg));
        const curbEnd = c ? Math.min(zb2, c.z) : zb2;
        if (curbEnd > za) {
          quad(-HW - 0.3, za, -HW, curbEnd, mix([120, 105, 90], fg));
          quad(HW, za, HW + 0.3, curbEnd, mix([120, 105, 90], fg));
        }
        if (par) for (const lx of [-0.9, 0.9]) quad(lx - 0.04, za, lx + 0.04, zb2, mix([160, 145, 120], fg));
      }
    }
    if (c && c.z < DRAW) {
      const fg = fogAt(c.z);
      const dirs = c.dir === 0 ? [-1, 1] : [c.dir];
      for (const d of dirs) {
        for (let k = 0; k < 40; k++) {
          const xa = d * (HW + k * TILE), xb = d * (HW + (k + 1) * TILE + 0.03);
          quad(Math.min(xa, xb), c.z, Math.max(xa, xb), c.z + JUNC, mix(STONE[k & 1], fg));
        }
        quad(Math.min(d * HW, d * 90), c.z - 0.3, Math.max(d * HW, d * 90), c.z, mix([120, 105, 90], fg));
        // arrow painted on the junction floor
        const zc = c.z + JUNC / 2, s0 = d * 0.25;
        const pts = [[s0, -0.45], [d * 1.1, -0.45], [d * 1.1, -1.1], [d * 2.2, 0], [d * 1.1, 1.1], [d * 1.1, 0.45], [s0, 0.45]];
        poly(pts.map(([x, z]) => proj(x, 0.01, zc + z)), `rgba(255,207,63,${0.9 - fg})`);
      }
    }
    for (const e of S.ents) {
      if (e.cat !== 'gap' || e.z > DRAW) continue;
      const za = Math.max(e.z, Z_NEAR), zb = Math.min(e.z + e.len, DRAW);
      if (zb <= za) continue;
      const a = proj(-HW - 0.3, 0, za), b = proj(HW + 0.3, 0, za), c2 = proj(HW + 0.3, 0, zb), d2 = proj(-HW - 0.3, 0, zb);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(d2.x, d2.y); ctx.closePath();
      ctx.fillStyle = '#0c0816'; ctx.fill(); ctx.clip();
      // far wall of the pit
      const w1 = proj(-HW - 0.3, -2.5, zb), w2 = proj(HW + 0.3, -2.5, zb);
      const g = ctx.createLinearGradient(0, d2.y, 0, w1.y);
      g.addColorStop(0, '#6e5d58'); g.addColorStop(1, '#0c0816');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(d2.x, d2.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(w2.x, w2.y); ctx.lineTo(w1.x, w1.y); ctx.closePath(); ctx.fill();
      const lab = proj(0, -0.9, zb);
      if (lab.s > 12) {
        ctx.fillStyle = 'rgba(255,90,90,0.85)'; fitText('EXAM WEEK', HW * lab.s * 1.6, lab.s * 0.55);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('EXAM WEEK', lab.x, lab.y);
      }
      ctx.restore();
    }
  }

  // ---------- Logos & collectibles ----------
  function drawGlyph(id, r) {
    ctx.save();
    switch (id) {
      case 'google': {
        const lw = r * 0.3, R = r * 0.55;
        ctx.lineWidth = lw; ctx.lineCap = 'butt';
        const segs = [['#4285F4', -0.05, 0.75], ['#34A853', 0.75, 2.3], ['#FBBC05', 2.3, 3.75], ['#EA4335', 3.75, 5.55]];
        for (const [c, a0, a1] of segs) { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke(); }
        ctx.fillStyle = '#4285F4'; ctx.fillRect(0, -lw * 0.42, R + lw / 2, lw * 0.84);
        break;
      }
      case 'microsoft': {
        const q = r * 0.5, g = r * 0.07;
        [['#F25022', -1, -1], ['#7FBA00', 1, -1], ['#00A4EF', -1, 1], ['#FFB900', 1, 1]].forEach(([c, sx, sy]) => {
          ctx.fillStyle = c; ctx.fillRect(sx < 0 ? -q - g : g, sy < 0 ? -q - g : g, q, q);
        });
        break;
      }
      case 'meta': {
        ctx.strokeStyle = '#0081FB'; ctx.lineWidth = r * 0.2; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * Math.PI * 2, den = 1 + Math.sin(t) ** 2, a = r * 0.78;
          const x = (a * Math.cos(t)) / den, y = (a * Math.sin(t) * Math.cos(t)) / den;
          i ? ctx.lineTo(x, y * 1.25) : ctx.moveTo(x, y * 1.25);
        }
        ctx.stroke();
        break;
      }
      case 'amazon': {
        ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${r * 1.15}px system-ui, sans-serif`; ctx.fillText('a', 0, -r * 0.12);
        ctx.strokeStyle = '#FF9900'; ctx.lineWidth = r * 0.13; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 0.38); ctx.quadraticCurveTo(0, r * 0.72, r * 0.55, r * 0.34); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.38, r * 0.3); ctx.lineTo(r * 0.58, r * 0.33); ctx.lineTo(r * 0.52, r * 0.52); ctx.stroke();
        break;
      }
      case 'nvidia': {
        ctx.fillStyle = '#76B900'; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 ${r * 0.62}px system-ui, sans-serif`; ctx.fillText('nv', 0, r * 0.02);
        break;
      }
      case 'intel': {
        ctx.strokeStyle = '#0071C5'; ctx.lineWidth = r * 0.08;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 0.48, -0.15, 0.4, Math.PI * 1.85); ctx.stroke();
        ctx.fillStyle = '#0071C5'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${r * 0.5}px system-ui, sans-serif`; ctx.fillText('intel', 0, r * 0.02);
        break;
      }
    }
    ctx.restore();
  }

  function drawItem(e) {
    const bob = Math.sin(S.t * 4 + e.z) * 0.08;
    const p = proj(e.x, e.y + bob, e.z), g = proj(e.x, 0, e.z);
    const r = 0.42 * p.s;
    if (r < 1.5 || p.y < -50) return;
    ctx.globalAlpha = 1 - clamp((e.z - 100) / 40, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 0.8, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(p.x, p.y);
    if (e.kind === 'logo') {
      const spin = Math.cos(S.t * 2.5 + e.z * 0.2);
      ctx.shadowColor = 'rgba(255,207,63,0.9)'; ctx.shadowBlur = r * 0.6;
      ctx.scale(Math.max(0.25, Math.abs(spin)), 1);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffcf3f'; ctx.lineWidth = r * 0.12; ctx.stroke();
      if (Math.abs(spin) > 0.3) drawGlyph(e.company.id, r * 0.9);
      ctx.restore(); ctx.save();
      if (r > 13) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
        ctx.font = `800 ${Math.min(16, r * 0.5)}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.strokeText(e.company.name, p.x, p.y + r * 1.55); ctx.fillText(e.company.name, p.x, p.y + r * 1.55);
      }
    } else if (e.kind === 'test') {
      ctx.rotate(Math.sin(S.t * 2 + e.z) * 0.15);
      const w = r * 1.3, h = r * 1.65;
      ctx.fillStyle = '#fdfdf8'; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.3;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.shadowBlur = 0;
      ctx.fillStyle = '#c9d4e6';
      for (let k = 0; k < 4; k++) ctx.fillRect(-w * 0.35, h * (0.12 + k * 0.1), w * 0.7, Math.max(1, r * 0.05));
      ctx.fillStyle = '#d62828'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${r * (e.grade === 'A+' ? 0.85 : 0.62)}px system-ui, sans-serif`;
      ctx.fillText(e.grade, 0, -h * 0.18);
      ctx.strokeStyle = '#d62828'; ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath(); ctx.ellipse(0, -h * 0.18, w * 0.42, h * 0.22, -0.2, 0, Math.PI * 2); ctx.stroke();
    } else if (e.kind === 'coffee') {
      ctx.shadowColor = '#fff'; ctx.shadowBlur = r * 0.8;
      ctx.fillStyle = '#f4f1ea';
      ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.6); ctx.lineTo(r * 0.55, -r * 0.6); ctx.lineTo(r * 0.4, r * 0.75); ctx.lineTo(-r * 0.4, r * 0.75); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7b4a2a'; ctx.fillRect(-r * 0.5, -r * 0.1, r * 1.0, r * 0.4);
      ctx.fillStyle = '#333'; rr(-r * 0.62, -r * 0.8, r * 1.24, r * 0.24, r * 0.08); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = r * 0.08;
      for (const sx of [-0.2, 0.2]) { ctx.beginPath(); ctx.moveTo(sx * r, -r * 0.95); ctx.quadraticCurveTo(sx * r + r * 0.2 * Math.sin(S.t * 5), -r * 1.2, sx * r, -r * 1.45); ctx.stroke(); }
    } else if (e.kind === 'shield') {
      ctx.scale(Math.max(0.3, Math.abs(Math.cos(S.t * 2.5 + e.z * 0.2))), 1);
      ctx.shadowColor = '#5ad1ff'; ctx.shadowBlur = r;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.5, -r * 0.72, r * 0.92, -r * 0.82);
      ctx.quadraticCurveTo(r * 0.98, r * 0.45, 0, r * 1.08);
      ctx.quadraticCurveTo(-r * 0.98, r * 0.45, -r * 0.92, -r * 0.82);
      ctx.quadraticCurveTo(-r * 0.5, -r * 0.72, 0, -r); ctx.closePath();
      const sg = ctx.createLinearGradient(0, -r, 0, r); sg.addColorStop(0, '#6fd6ff'); sg.addColorStop(1, '#1565c0');
      ctx.fillStyle = sg; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.12; ctx.stroke();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.38, 0); ctx.lineTo(-r * 0.08, r * 0.32); ctx.lineTo(r * 0.42, -r * 0.3); ctx.stroke();
    } else if (e.kind === 'skill') {
      // glowing hexagonal "AI skill" chip
      ctx.rotate(Math.sin(S.t * 2 + e.z) * 0.2);
      ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = r * 0.9;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; k ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath();
      const hg = ctx.createLinearGradient(-r, -r, r, r); hg.addColorStop(0, '#7c4dff'); hg.addColorStop(1, '#00c6ff');
      ctx.fillStyle = hg; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = r * 0.09; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${r * 0.75}px system-ui, sans-serif`; ctx.fillText('AI', 0, r * 0.04);
      ctx.restore(); ctx.save();
      if (r > 13) {
        ctx.fillStyle = '#c9fbff'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
        ctx.font = `800 ${Math.min(15, r * 0.48)}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.strokeText(e.skill, p.x, p.y + r * 1.55); ctx.fillText(e.skill, p.x, p.y + r * 1.55);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- Obstacles ----------
  function drawObsMaybeFlying(e) {
    if (!e.deflect) return drawObs(e);
    const p = proj(e.x, 1, e.z), ft = e.flyT || 0;
    ctx.save();
    ctx.translate(p.x, p.y - ft * 900 * SC); ctx.rotate(ft * 7 * (e.x >= P.x ? 1 : -1)); ctx.translate(-p.x, -p.y);
    drawObs(e);
    ctx.restore();
  }
  function drawObs(e) {
    const p = proj(e.x, 0, e.z), s = p.s;
    if (s < 1) return;
    const hw = e.full ? HW : 0.82;
    const L = p.x - hw * s, Rx = p.x + hw * s, wpx = Rx - L;
    ctx.globalAlpha = clamp(e.fade, 0, 1) * (1 - clamp((e.z - 100) / 40, 0, 1));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (e.type === 'low') {
      const h = 0.85 * s, top = p.y - h;
      ctx.fillStyle = '#4a3427';
      ctx.fillRect(L, top, 0.16 * s, h); ctx.fillRect(Rx - 0.16 * s, top, 0.16 * s, h);
      const by = p.y - 0.85 * s, bh = 0.42 * s;
      ctx.save(); ctx.beginPath(); ctx.rect(L, by, wpx, bh); ctx.clip();
      ctx.fillStyle = '#ffcf3f'; ctx.fillRect(L, by, wpx, bh);
      ctx.fillStyle = '#1a1a1a';
      for (let x = L - bh; x < Rx; x += bh * 0.9) { ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x + bh * 0.45, by + bh); ctx.lineTo(x + bh * 0.9, by); ctx.lineTo(x + bh * 0.45, by); ctx.fill(); }
      ctx.restore();
      if (s > 10) {
        const pw = Math.min(wpx * 0.8, 3.0 * s);
        ctx.fillStyle = '#fff'; rr(p.x - pw / 2, by + bh * 0.12, pw, bh * 0.76, bh * 0.15); ctx.fill();
        ctx.fillStyle = '#c0392b'; fitText('⏰ DEADLINE', pw * 0.9, bh * 0.55);
        ctx.fillText('⏰ DEADLINE', p.x, by + bh * 0.52);
      }
    } else if (e.type === 'high') {
      const postH = 1.8 * s, y0 = p.y - 1.75 * s, bh = 0.6 * s;
      ctx.fillStyle = '#3d3d4a';
      ctx.fillRect(L, p.y - postH, 0.14 * s, postH); ctx.fillRect(Rx - 0.14 * s, p.y - postH, 0.14 * s, postH);
      ctx.fillStyle = '#c62828'; ctx.fillRect(L, y0, wpx, bh);
      ctx.fillStyle = '#fff'; fitText('PLAGIARISM SCAN', wpx * 0.85, bh * 0.55);
      ctx.fillText('PLAGIARISM SCAN', p.x, y0 + bh / 2);
      const ly = y0 + bh + 0.08 * s, pulse = 0.6 + 0.4 * Math.sin(S.t * 18);
      ctx.strokeStyle = `rgba(255,60,120,${pulse})`; ctx.lineWidth = Math.max(2, 0.08 * s);
      ctx.shadowColor = '#ff2d75'; ctx.shadowBlur = 0.4 * s;
      ctx.beginPath(); ctx.moveTo(L, ly); ctx.lineTo(Rx, ly); ctx.stroke(); ctx.shadowBlur = 0;
    } else {
      const h = 2.0, top = proj(e.x, h, e.z);
      const b1 = proj(e.x - hw, h, e.z + 0.9), b2 = proj(e.x + hw, h, e.z + 0.9);
      poly([{ x: L, y: top.y }, { x: Rx, y: top.y }, b2, b1], '#d8ccb2');
      // visible side face toward the camera
      if (e.x - camX > hw) poly([{ x: L, y: top.y }, b1, proj(e.x - hw, 0, e.z + 0.9), { x: L, y: p.y }], '#b9ab8f');
      if (camX - e.x > hw) poly([{ x: Rx, y: top.y }, b2, proj(e.x + hw, 0, e.z + 0.9), { x: Rx, y: p.y }], '#b9ab8f');
      ctx.fillStyle = '#f3ead7'; ctx.fillRect(L, top.y, wpx, p.y - top.y);
      ctx.strokeStyle = '#a8987a'; ctx.lineWidth = Math.max(1, 0.05 * s); ctx.strokeRect(L, top.y, wpx, p.y - top.y);
      ctx.fillStyle = '#d0c4a8';
      for (let k = 0; k < 6; k++) ctx.fillRect(L + wpx * 0.15, top.y + (p.y - top.y) * (0.12 + k * 0.06), wpx * 0.7, Math.max(1, 0.04 * s));
      if (s > 8) {
        ctx.save(); ctx.translate(p.x, (top.y + p.y) / 2 + 0.2 * s); ctx.rotate(-0.2);
        const fs = fitText(e.label, wpx * 0.85, 0.42 * s);
        ctx.strokeStyle = '#d62828'; ctx.lineWidth = Math.max(1, fs * 0.12);
        const tw = ctx.measureText(e.label).width;
        ctx.strokeRect(-tw / 2 - fs * 0.3, -fs * 0.75, tw + fs * 0.6, fs * 1.5);
        ctx.fillStyle = '#d62828'; ctx.fillText(e.label, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHedge(c) {
    const z = c.z + JUNC, p = proj(0, 0, z), s = p.s, h = 1.7 * s;
    ctx.globalAlpha = 1 - clamp((z - 100) / 40, 0, 1);
    ctx.fillStyle = '#2f6b33'; ctx.fillRect(-W, p.y - h, W * 3, h);
    ctx.fillStyle = '#3d8040';
    for (let x = -W; x < W * 2; x += 0.8 * s) { ctx.beginPath(); ctx.arc(x, p.y - h, 0.45 * s, Math.PI, 0); ctx.fill(); }
    if (s > 6) {
      const txt = c.dir === -1 ? '⟵ LIBRARY' : c.dir === 1 ? 'CAREER FAIR ⟶' : '⟵ LIBRARY   ·   CAREER FAIR ⟶';
      const bw = (c.dir === 0 ? 4.6 : 3.2) * s, bh = 0.8 * s;
      ctx.fillStyle = '#6b4a2f'; ctx.fillRect(p.x - 0.06 * s, p.y - h - 0.4 * s, 0.12 * s, 0.5 * s);
      ctx.fillStyle = '#8a5f3c'; rr(p.x - bw / 2, p.y - h - 1.0 * s, bw, bh, 0.1 * s); ctx.fill();
      ctx.fillStyle = '#fff3d6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitText(txt, bw * 0.9, bh * 0.5); ctx.fillText(txt, p.x, p.y - h - 1.0 * s + bh / 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Scenery sprites ----------
  function drawScenery(e) {
    const p = proj(e.x, 0, e.z), s = p.s;
    if (p.x < -4 * s || p.x > W + 4 * s) return;
    ctx.globalAlpha = 1 - clamp((e.z - 100) / 40, 0, 1);
    switch (e.type) {
      case 'tree': {
        const h = (2.4 + e.v * 1.6) * s;
        ctx.fillStyle = '#5a3d2b'; ctx.fillRect(p.x - 0.14 * s, p.y - h * 0.55, 0.28 * s, h * 0.55);
        const greens = ['#2f7a3a', '#3b8f45', '#276b33'];
        ctx.fillStyle = greens[(e.v * 3) | 0];
        ctx.beginPath(); ctx.arc(p.x, p.y - h * 0.7, 1.0 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x - 0.55 * s, p.y - h * 0.55, 0.7 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + 0.6 * s, p.y - h * 0.58, 0.72 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(p.x - 0.3 * s, p.y - h * 0.8, 0.45 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'column': {
        const h = 3.2 * s, w = 0.5 * s;
        ctx.fillStyle = '#ece6da'; ctx.fillRect(p.x - w / 2, p.y - h, w, h);
        ctx.fillStyle = '#cfc6b5';
        for (let k = -1; k <= 1; k++) ctx.fillRect(p.x + k * w * 0.28 - 1, p.y - h, Math.max(1, w * 0.06), h);
        ctx.fillStyle = '#f6f1e8'; ctx.fillRect(p.x - w * 0.8, p.y - h - 0.2 * s, w * 1.6, 0.22 * s);
        ctx.fillRect(p.x - w * 0.75, p.y - 0.2 * s, w * 1.5, 0.2 * s);
        break;
      }
      case 'books': {
        const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#7d3c98'];
        let y = p.y;
        for (let k = 0; k < 4; k++) {
          const w = (1.0 - k * 0.1) * s, h = 0.22 * s;
          ctx.fillStyle = cols[(k + ((e.v * 5) | 0)) % 5];
          ctx.fillRect(p.x - w / 2 + (k % 2 ? 0.06 : -0.06) * s, y - h, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(p.x - w / 2 + (k % 2 ? 0.06 : -0.06) * s, y - h * 0.6, w, Math.max(1, h * 0.12));
          y -= h;
        }
        break;
      }
      case 'bench': {
        ctx.fillStyle = '#7a5232';
        ctx.fillRect(p.x - 0.8 * s, p.y - 0.5 * s, 1.6 * s, 0.12 * s);
        ctx.fillRect(p.x - 0.8 * s, p.y - 0.9 * s, 1.6 * s, 0.1 * s);
        ctx.fillRect(p.x - 0.8 * s, p.y - 0.75 * s, 1.6 * s, 0.1 * s);
        ctx.fillStyle = '#333';
        ctx.fillRect(p.x - 0.7 * s, p.y - 0.5 * s, 0.08 * s, 0.5 * s); ctx.fillRect(p.x + 0.62 * s, p.y - 0.5 * s, 0.08 * s, 0.5 * s);
        break;
      }
      case 'lamp': {
        ctx.fillStyle = '#2b2b33'; ctx.fillRect(p.x - 0.05 * s, p.y - 3 * s, 0.1 * s, 3 * s);
        const g = ctx.createRadialGradient(p.x, p.y - 3.1 * s, 0, p.x, p.y - 3.1 * s, 0.8 * s);
        g.addColorStop(0, 'rgba(255,236,170,0.95)'); g.addColorStop(1, 'rgba(255,236,170,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 3.1 * s, 0.8 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff2c4'; ctx.beginPath(); ctx.arc(p.x, p.y - 3.1 * s, 0.16 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- The student ----------
  function drawPlayer() {
    const falling = S.cause === 'fall' && S.mode !== 'play';
    const alpha = falling ? clamp(1 + P.y / 1.5, 0, 1) : 1;
    if (alpha <= 0) return;
    const g = proj(P.x, 0, 0);
    if (!falling) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.45 * g.s / (1 + P.y * 0.4), 0.13 * g.s, 0, 0, Math.PI * 2); ctx.fill();
    }
    const p = proj(P.x, P.y, 0), s = p.s;
    const sliding = P.slide > 0 && P.y < 0.3;
    const running = S.curSpeed > 0.5 && S.mode !== 'over';
    const ph = S.dist * 1.15, sw = running ? Math.sin(ph) : 0;
    const air = P.y > 0.05;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y); ctx.scale(s, s); ctx.rotate(yaw * 0.3);
    if (falling) ctx.scale(alpha, alpha);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const bob = running && !air ? Math.abs(sw) * 0.06 : 0;
    let bodyY = 0;
    if (sliding) {
      bodyY = 0.75;
      ctx.rotate(0.12);
    } else {
      // legs (seen from behind: the leg swinging back rises toward the camera)
      for (const side of [-1, 1]) {
        const lift = air ? 0.3 : Math.max(0, side * sw) * 0.38;
        ctx.strokeStyle = '#2c3e66'; ctx.lineWidth = 0.2;
        ctx.beginPath(); ctx.moveTo(side * 0.13, -0.9 - bob); ctx.lineTo(side * 0.16, -0.48 + lift * 0.2 - bob); ctx.lineTo(side * 0.15, -0.08 - lift); ctx.stroke();
        ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.ellipse(side * 0.15, -0.05 - lift, 0.11, 0.07 + lift * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e74c3c'; ctx.fillRect(side * 0.15 - 0.1, -0.03 - lift, 0.2, 0.04);
      }
    }
    ctx.translate(0, bodyY - bob);
    // arms
    for (const side of [-1, 1]) {
      const swing = sliding ? -0.25 : -side * sw * 0.22;
      ctx.strokeStyle = '#1f5fbf'; ctx.lineWidth = 0.15;
      ctx.beginPath(); ctx.moveTo(side * 0.27, -1.45); ctx.lineTo(side * 0.4, -1.15 + swing * 0.3); ctx.lineTo(side * 0.38, -0.95 + swing); ctx.stroke();
      ctx.fillStyle = '#e9b48a'; ctx.beginPath(); ctx.arc(side * 0.38, -0.92 + swing, 0.075, 0, Math.PI * 2); ctx.fill();
    }
    // hoodie
    ctx.fillStyle = '#1f5fbf'; rr(-0.31, -1.6, 0.62, 0.78, 0.14); ctx.fill();
    ctx.fillStyle = '#184c99'; ctx.fillRect(-0.31, -0.92, 0.62, 0.1);
    // backpack
    ctx.fillStyle = '#c0392b'; rr(-0.24, -1.5, 0.48, 0.55, 0.1); ctx.fill();
    ctx.fillStyle = '#962d22'; rr(-0.17, -1.18, 0.34, 0.2, 0.06); ctx.fill();
    ctx.fillStyle = '#ffcf3f'; ctx.fillRect(-0.03, -1.47, 0.06, 0.08);
    // head
    ctx.fillStyle = '#e9b48a'; ctx.fillRect(-0.06, -1.68, 0.12, 0.1);
    ctx.fillStyle = '#e9b48a';
    ctx.beginPath(); ctx.arc(-0.19, -1.8, 0.05, 0, Math.PI * 2); ctx.arc(0.19, -1.8, 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2a1e'; ctx.beginPath(); ctx.arc(0, -1.82, 0.19, 0, Math.PI * 2); ctx.fill();
    // graduation cap
    ctx.fillStyle = '#111'; ctx.fillRect(-0.16, -2.02, 0.32, 0.12);
    ctx.beginPath(); ctx.moveTo(-0.36, -2.04); ctx.lineTo(0, -2.14); ctx.lineTo(0.36, -2.04); ctx.lineTo(0, -1.95); ctx.closePath(); ctx.fill();
    const tx = 0.22 + Math.sin(S.t * 9) * 0.04;
    ctx.strokeStyle = '#ffcf3f'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(0, -2.05); ctx.lineTo(tx, -2.02); ctx.lineTo(tx + 0.02, -1.86); ctx.stroke();
    // coiled whip in hand during the chase
    if (S.chase && !(S.chase.whipT > 0)) {
      ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.ellipse(0.46, -0.85, 0.12, 0.16, 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.38, -0.95); ctx.lineTo(0.42, -0.62); ctx.stroke();
    }
    // shield bubble
    if (S.shield) {
      const sg = ctx.createRadialGradient(0, -1.0, 0.2, 0, -1.0, 1.3);
      sg.addColorStop(0, 'rgba(90,209,255,0)'); sg.addColorStop(0.75, 'rgba(90,209,255,0.12)'); sg.addColorStop(1, 'rgba(90,209,255,0.45)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(0, -1.0, 0.85, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(160,230,255,${0.6 + 0.3 * Math.sin(S.t * 6)})`; ctx.lineWidth = 0.05; ctx.stroke();
      ctx.fillStyle = '#e6faff';
      for (let i = 0; i < 3; i++) { const a = S.t * 3 + i * 2.09; ctx.beginPath(); ctx.arc(Math.cos(a) * 0.85, -1.0 + Math.sin(a) * 1.3, 0.05, 0, Math.PI * 2); ctx.fill(); }
    }
    if (S.shieldBreak > 0) {
      const k = 1 + (0.5 - S.shieldBreak) * 3;
      ctx.strokeStyle = `rgba(160,230,255,${S.shieldBreak * 2})`; ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.ellipse(0, -1.0, 0.85 * k, 1.3 * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- The AI (OpenAI-style knot monster) ----------
  function drawKnot(r, rot, bg = '#0b0b0b') {
    // Six woven rounded links arranged as a hexagonal "blossom" (OpenAI-style knot).
    // Each link gets a background-colored outline so later links appear to pass over earlier ones.
    const link = (i) => {
      ctx.save(); ctx.rotate((i * Math.PI) / 3);
      rr(-0.12 * r, -0.98 * r, 0.62 * r, 0.98 * r, 0.3 * r);
      ctx.strokeStyle = bg; ctx.lineWidth = r * 0.27; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.14; ctx.stroke();
      ctx.restore();
    };
    ctx.save(); ctx.rotate(rot); ctx.lineJoin = 'round';
    for (let i = 0; i < 6; i++) link(i);
    ctx.save(); ctx.beginPath(); ctx.rect(-r * 1.3, -r * 1.3, r * 1.3, r * 1.3); ctx.clip(); link(0); ctx.restore();
    ctx.restore();
  }

  function drawAIBody(cx, cy, R, spin, opts = {}) {
    const t = S.t, hurt = opts.flinch > 0;
    if (hurt) { cx += (Math.random() - 0.5) * R * 0.15; cy += (Math.random() - 0.5) * R * 0.15; }
    const gc = hurt ? '255,80,80' : '16,163,127';
    const g = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.7);
    g.addColorStop(0, `rgba(${gc},0.55)`); g.addColorStop(1, `rgba(${gc},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, Math.PI * 2); ctx.fill();
    // data tendrils (flailing when panicking)
    ctx.lineCap = 'round';
    const n = opts.panic ? 14 : 11, sp = opts.panic ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const a = opts.panic ? (i / n) * Math.PI * 2 : Math.PI * (-0.12 + (i / 10) * 1.24);
      const len = R * (0.7 + 0.25 * Math.sin(t * 2 * sp + i * 1.7));
      const x0 = cx + Math.cos(a) * R * 0.8, y0 = cy + Math.sin(a) * R * 0.8;
      const x1 = cx + Math.cos(a) * (R + len), y1 = cy + Math.sin(a) * (R + len);
      const wob = Math.sin(t * 5 * sp + i) * R * 0.25;
      ctx.strokeStyle = `rgba(${gc},0.85)`; ctx.lineWidth = R * 0.06;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2 - Math.sin(a) * wob, (y0 + y1) / 2 + Math.cos(a) * wob, x1, y1); ctx.stroke();
      ctx.fillStyle = hurt ? '#ffb3b3' : '#7dffcf'; ctx.beginPath(); ctx.arc(x1, y1, R * 0.04, 0, Math.PI * 2); ctx.fill();
    }
    const b = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    b.addColorStop(0, '#3a3a3a'); b.addColorStop(1, '#030303');
    ctx.fillStyle = b; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hurt ? '#ff5050' : '#10a37f'; ctx.lineWidth = R * 0.035; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy);
    drawKnot(R * 0.6, spin, '#151515');
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.22);
    eg.addColorStop(0, hurt ? 'rgba(255,90,90,1)' : `rgba(125,255,207,${0.6 + pulse * 0.4})`); eg.addColorStop(1, `rgba(${gc},0)`);
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (opts.panic) {
      // sweat drops
      ctx.fillStyle = '#9fe6ff';
      for (const side of [-1, 1]) {
        const ph = (t * 1.6 + (side > 0 ? 0.5 : 0)) % 1;
        const dx = cx + side * R * (0.85 + ph * 0.3), dy = cy - R * 0.7 + ph * R * 0.8, dr = R * 0.09;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath(); ctx.moveTo(dx, dy - dr * 2); ctx.quadraticCurveTo(dx + dr, dy, dx, dy + dr); ctx.quadraticCurveTo(dx - dr, dy, dx, dy - dr * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (opts.tag) {
      ctx.font = `800 ${Math.max(11, R * 0.13)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tag = 'ChatGPT-∞', tw = ctx.measureText(tag).width + R * 0.16, th = Math.max(16, R * 0.2);
      ctx.fillStyle = '#10a37f'; rr(cx - tw / 2, cy - R - th * 0.6, tw, th, th / 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(tag, cx, cy - R - th * 0.1);
    }
  }

  // The AI chasing from behind the student (normal mode, and the "caught" ending).
  function drawAI() {
    if (S.chase) return;
    const caught = S.cause === 'caught' && S.mode !== 'play';
    const vis = caught ? 1 + Math.min(S.dyingT, 1.6) * 1.4 : S.threat;
    const base = Math.min(W, H) * 0.17;
    const R = base * (1 + Math.max(0, vis - 1) * 1.1);
    const cx = S.ex;
    const cy = H + base * 0.9 - Math.min(vis, 1) * base * 1.3 - Math.max(0, vis - 1) * H * 0.22 + Math.sin(S.t * 3) * base * 0.04;
    if (cy - R * 1.7 > H) return;
    drawAIBody(cx, cy, R, S.t * (0.4 + vis * 0.6), { tag: vis > 0.35 && !caught });
    if (S.quoteShow > 0 && S.mode !== 'over') drawBubble(cx, Math.min(cy - R * 1.05, H - 40), R);
  }

  // The AI fleeing ahead of the student (chase mode).
  function chaseAIScreen() {
    const C = S.chase, p = proj(C.x, C.y, C.z);
    return { x: p.x, y: p.y, R: 1.1 * p.s, p };
  }
  function drawChaseAI() {
    const C = S.chase, a = chaseAIScreen();
    const g = proj(C.x, 0, C.z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, a.R * 0.8, a.R * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    drawAIBody(a.x, a.y, a.R, S.t * 4, { panic: true, flinch: C.flinch, tag: true });
  }

  // Whip lash from the student's hand to the AI's depth in the student's lane.
  function drawWhip() {
    const C = S.chase;
    if (!C || C.whipT <= 0) return;
    const u = 1 - C.whipT / 0.3, ext = Math.min(1, u * 2.5);
    const hand = proj(P.x + 0.4, P.y + 0.95, 0);
    const tgt = C.hit ? chaseAIScreen() : proj(P.x, 1.7, C.z);
    const ex = lerp(hand.x, tgt.x, ext), ey = lerp(hand.y, tgt.y, ext);
    const cxp = (hand.x + ex) / 2 + Math.sin(u * 20) * 30 * SC, cyp = Math.min(hand.y, ey) - 120 * SC * (1 - u);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3d2614'; ctx.lineWidth = 7 * SC + 2;
    ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.quadraticCurveTo(cxp, cyp, ex, ey); ctx.stroke();
    ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 3.5 * SC + 1; ctx.stroke();
    if (ext >= 1 && C.hit) {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 4 * SC + 1;
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5 + u, r1 = 20 * SC, r2 = (50 + 40 * u) * SC;
        ctx.beginPath(); ctx.moveTo(ex + Math.cos(a) * r1, ey + Math.sin(a) * r1); ctx.lineTo(ex + Math.cos(a) * r2, ey + Math.sin(a) * r2); ctx.stroke();
      }
    }
  }

  function drawBubble(ax, ay, R) {
    const text = S.quote.slice(0, Math.floor(S.quoteChars));
    const fs = clamp(Math.min(W, H) * 0.024, 13, 18);
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const maxW = Math.min(300, W - 60);
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (ctx.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; }
    if (cur) lines.push(cur);
    const full = S.quote.split(' ');
    let fullLines = 1, c2 = '';
    for (const w of full) { const tst = c2 ? c2 + ' ' + w : w; if (ctx.measureText(tst).width > maxW && c2) { fullLines++; c2 = w; } else c2 = tst; }
    const bw = Math.min(maxW, ctx.measureText(S.quote).width) + fs * 3.2, bh = fullLines * fs * 1.3 + fs * 1.1;
    let bx = clamp(ax + R * 0.3, 12, W - bw - 12), by = ay - bh - 14;
    by = clamp(by, 115, H - bh - 10);
    ctx.globalAlpha = Math.min(1, S.quoteShow * 3);
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12;
    rr(bx, by, bw, bh, 12); ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(bx + 24, by + bh - 1); ctx.lineTo(bx + 18, by + bh + 12); ctx.lineTo(bx + 38, by + bh - 1); ctx.fill();
    ctx.fillStyle = '#10a37f'; ctx.beginPath(); ctx.arc(bx + fs * 1.1, by + fs * 1.15, fs * 0.65, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(bx + fs * 1.1, by + fs * 1.15); drawKnot(fs * 0.45, 0, '#10a37f'); ctx.restore();
    ctx.fillStyle = '#202123'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + fs * 2.2, by + fs * 0.55 + i * fs * 1.3));
    ctx.globalAlpha = 1;
  }

  // ---------- Frame ----------
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HORIZON = H - (camH * F) / camD - H * 0.13;
    ctx.save();
    if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake * 30, (Math.random() - 0.5) * S.shake * 30);
    drawSky();
    ctx.save();
    drawGround();

    const c = S.corner;
    const sprites = [];
    for (const e of S.scen) {
      if (c && e.z > c.z - 1.5 && e.z < c.z + JUNC + 1) continue; // keep the branch clear
      if (e.z < DRAW) sprites.push(e);
    }
    for (const e of S.ents) if (e.cat !== 'gap' && e.z < DRAW) sprites.push(e);
    if (c && c.z + JUNC < DRAW) sprites.push({ cat: 'hedge', z: c.z + JUNC + 0.01 });
    sprites.push({ cat: 'player', z: 0, x: P.x });
    if (S.chase) sprites.push({ cat: 'chaseAI', z: S.chase.z, x: S.chase.x });
    for (const e of sprites) e.depth = proj(e.x || 0, 0, e.z).d;
    sprites.sort((a, b) => b.depth - a.depth);
    for (const e of sprites) {
      if (e.depth < 0.8 && e.cat !== 'player') continue; // behind the camera while it swings

      if (e.cat === 'player') drawPlayer();
      else if (e.cat === 'item') drawItem(e);
      else if (e.cat === 'obs') drawObsMaybeFlying(e);
      else if (e.cat === 'chaseAI') drawChaseAI();
      else if (e.cat === 'hedge') drawHedge(c);
      else drawScenery(e);
    }
    drawWhip();
    if (S.chase && S.quoteShow > 0) { const a = chaseAIScreen(); if (a.p.d > 1) drawBubble(a.x, a.y - a.R * 1.1, a.R); }
    ctx.restore();

    drawAI();
    if (S.cam > 0.01) {
      const gv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      gv.addColorStop(0, 'rgba(255,200,60,0)'); gv.addColorStop(1, `rgba(255,190,40,${0.35 * S.cam})`);
      ctx.fillStyle = gv; ctx.fillRect(0, 0, W, H);
    }
    if (S.flashGold > 0) { ctx.fillStyle = `rgba(255,236,170,${S.flashGold})`; ctx.fillRect(0, 0, W, H); }
    if (S.banner) {
      const b = S.banner, a = clamp(Math.min(b.t * 4, (2.6 - b.t) * 2), 0, 1), pop = 1 + Math.max(0, 0.25 - b.t) * 1.5;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, Math.max(175, H * 0.24)); ctx.scale(pop, pop);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitText(b.title, W * 0.9, clamp(W * 0.085, 30, 72));
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(b.title, 0, 0);
      ctx.fillStyle = '#ffcf3f'; ctx.fillText(b.title, 0, 0);
      const ss = fitText(b.sub, W * 0.9, clamp(W * 0.025, 14, 22), 700);
      ctx.lineWidth = 4; ctx.strokeText(b.sub, 0, ss * 2.6); ctx.fillStyle = '#fff'; ctx.fillText(b.sub, 0, ss * 2.6);
      ctx.restore();
    }

    // chase vignette
    const danger = S.mode === 'play' && S.stumble > 0 ? clamp((S.threat - 0.5) / 0.5, 0, 1) : 0;
    if (danger > 0) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(16,163,127,0)'); vg.addColorStop(1, `rgba(16,163,127,${0.45 * danger})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    if (S.flash > 0) { ctx.fillStyle = `rgba(255,40,40,${S.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }

    // turn hint
    if (S.mode === 'play' && c && c.z < 32 && c.z > -JUNC) {
      const on = Math.sin(S.t * 14) > -0.3;
      if (on) {
        const txt = c.dir === -1 ? '⟵ TURN LEFT' : c.dir === 1 ? 'TURN RIGHT ⟶' : '⟵ TURN ⟶';
        ctx.font = `900 ${clamp(W * 0.06, 26, 48)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(txt, W / 2, H * 0.22);
        ctx.fillStyle = '#ffcf3f'; ctx.fillText(txt, W / 2, H * 0.22);
      }
    }
    // popups
    for (const p of S.popups) {
      ctx.globalAlpha = clamp(1.3 - p.t, 0, 1);
      ctx.font = `900 ${clamp(Math.min(W, H) * 0.032, 15, 24)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- HUD & screens ----------
  const hud = { score: $('score'), apps: $('apps'), tests: $('tests'), powers: $('powers'), bar: $('skillbar'), fill: $('skillFill'), lbl: $('skillLbl') };
  let lastHud = '';
  function updateHud() {
    const pw = (S.magnet > 0 ? `☕ Magnet ${Math.ceil(S.magnet)}s|` : '') + (S.shield ? '🛡️ Shield|' : '');
    const C = S.chase;
    const frac = C ? (C.intro < 1 ? 1 : clamp(C.t / CHASE_TIME, 0, 1)) : S.skills / SKILLS_NEEDED;
    const key = `${S.score | 0}/${S.apps}/${S.tests}/${pw}/${frac.toFixed(3)}`;
    if (key === lastHud) return;
    lastHud = key;
    hud.fill.style.width = (frac * 100).toFixed(1) + '%';
    hud.bar.classList.toggle('chase', !!C);
    hud.lbl.textContent = C ? `🔥 WHIP THE AI! ${Math.max(0, C.t).toFixed(1)}s` : `🧠 AI skills ${S.skills}/${SKILLS_NEEDED}`;
    hud.score.textContent = S.score | 0; hud.apps.textContent = S.apps; hud.tests.textContent = S.tests;
    hud.powers.innerHTML = pw.split('|').filter(Boolean).map((x) => `<div>${x}</div>`).join('');
  }

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function start() {
    audio();
    newState('play');
    paused = false;
    say("Hi! I'm here to help... with your job.");
    S.quoteT = 6;
    show('title', false); show('over', false); show('paused', false); show('hud', true); show('skillbar', true);
  }

  function gameOver() {
    S.mode = 'over'; S.overAt = performance.now();
    const score = S.score | 0;
    const isBest = score > best;
    if (isBest) { best = score; saveBest(); }
    const titles = {
      caught: ['CAUGHT BY THE AI', 'The AI took your internship.', '"Thank you for applying. We went with a large language model."'],
      fall: ['FELL IN', 'You fell into Exam Week.', 'Should have jumped. Maybe the AI can retake it for you.'],
      wall: ['DEAD END', 'You missed the turn!', 'Turn left/right at the yellow arrows.'],
    }[S.cause];
    $('overKicker').textContent = titles[0]; $('overTitle').textContent = titles[1]; $('overSub').textContent = titles[2];
    $('rScore').textContent = score; $('rApps').textContent = S.apps; $('rTests').textContent = S.tests;
    $('rDist').textContent = Math.floor(S.dist);
    const comp = Object.entries(S.companies).sort((a, b) => b[1] - a[1]);
    $('rCompanies').innerHTML = comp.length
      ? comp.map(([n, c]) => `<span class="chip">${n} ×${c}</span>`).join('')
      : '<span class="chip">No applications sent… the AI applied for you.</span>';
    $('rWhips').textContent = S.whips ? `🪢 You whipped the AI ${S.whips} time${S.whips > 1 ? 's' : ''}!` : 'Fill the AI-skills bar to turn the tables next time.';
    $('rBest').textContent = isBest ? '🏆 New personal best!' : `Best: ${best}`;
    show('hud', false); show('skillbar', false); show('over', true);
  }

  function togglePause(force) {
    if (S.mode !== 'play') return;
    paused = force !== undefined ? force : !paused;
    show('paused', paused);
  }

  // ---------- Input ----------
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
    if (S.mode === 'title' || S.mode === 'over') {
      if ((k === ' ' || k === 'Enter') && !(S.mode === 'over' && performance.now() - S.overAt < 700)) start();
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); return; }
    if (paused) { if (k === ' ' || k === 'Enter') togglePause(false); return; }
    if (e.repeat) return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') act(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') act(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') slide();
  });

  let touch = null;
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY, done: false }; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touch || touch.done) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    touch.done = true;
    if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 1 : -1);
    else if (dy < 0) jump(); else slide();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { if (touch && !touch.done && S.chase) whip(); touch = null; });
  canvas.addEventListener('mousedown', () => { if (S.chase && !paused) whip(); });

  $('startBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  $('pauseBtn').addEventListener('click', () => togglePause());
  $('muteBtn').addEventListener('click', (e) => { muted = !muted; e.currentTarget.textContent = muted ? '🔇' : '🔊'; e.currentTarget.blur(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });

  // ---------- Boot ----------
  newState('title');
  if (best) $('bestTitle').textContent = `Your best: ${best}`;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) update(dt);
    draw();
    if (S.mode === 'play') updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test hook (used for automated checks only; harmless in production)
  window.__grad = { get S() { return S; }, get P() { return P; }, start, act, jump, slide, startChase };
})();
