import {SRC, RANGE, HELP, TERM, traceInsert, traceSearch, vis, q, esc} from './art.js?v=3';

const SCEN = {
  patricia: {
    words: 'romane romanus romulus rubens ruber rubicon rubicundus',
    queries: 'rubicon romane rom rubix zebra',
    hint: 'Hits every branch: empty root, lazy expansion of a leaf, path compression splits at different depths, and descent.',
    qhint: 'Finds a stored word, then fails four ways: a prefix of stored words ("rom"), a leaf with a different tail ("rubix"), a prefix mismatch ("zebra").',
  },
  grow: {
    words: 'cat cab car can cap',
    queries: 'cap cow ca',
    hint: 'Five keys share "ca". The fifth child does not fit in a Node4, so grow() bumps it to Node16 before addChild.',
    qhint: 'All five children now live in one Node16. "cow" leaves the compressed prefix, "ca" ends inside it.',
  },
  term: {
    words: 'a ab abc',
    queries: 'ab abcd b',
    hint: '"a" is a prefix of "ab". TERM gives each key its own edge (␀), and the third insert creates an inner node with an empty prefix.',
    qhint: '"ab" is stored although it is a prefix of "abc": TERM keeps it at its own leaf. "abcd" is not stored although "abc" is.',
  },
  dup: {
    words: 'tea ten tea',
    queries: 'tea ten te',
    hint: 'The second "tea" reaches a leaf whose stored key matches from depth onward, so insert returns without touching the tree.',
    qhint: 'The duplicate "tea" left the tree unchanged, so it holds two keys. "te" is only a prefix.',
  },
};

/* ---------- tree drawing ---------- */
const CWI = 8.6, CWL = 8.3;
function nodeW(n) {
  if (n.end) return Math.max(50, vis(n.content).length * CWL + 28);
  const t = n.content.length ? n.content.length + 2 : 1;
  return Math.max(96, t * CWI + 30);
}
function layout(root, kd0) {
  const G = 16, LV = 92, nodes = [], edges = [];
  (function m(n) { n._w = nodeW(n); n._h = n.end ? 34 : 52; let s = 0; n.children.forEach(([, ch], j) => { m(ch); s += ch._sw + (j ? G : 0); }); n._cs = s; n._sw = Math.max(n._w, s); })(root);
  (function pl(n, x0, y, kd) {
    n._x = x0 + n._sw / 2; n._y = y; n._kd = kd; nodes.push(n);
    let cx = x0 + (n._sw - n._cs) / 2;
    n.children.forEach(([c, ch]) => { pl(ch, cx, y + LV, kd + n.content.length + 1); edges.push({p: n, ch, c}); cx += ch._sw + G; });
  })(root, 0, 20, kd0);
  let H = 0; nodes.forEach(n => { H = Math.max(H, n._y + n._h); });
  return {nodes, edges, W: Math.ceil(root._sw) + 2, H: H + 6};
}
const termSpan = s => esc(s).replace(/␀/g, '<tspan class="term">␀</tspan>');
function svgTree(root, hl, kd0) {
  const L = layout(root, kd0);
  const hot = new Map(hl.edges.map(e => [e.from + '|' + e.c, e.kind]));
  let s = `<svg viewBox="-1 0 ${L.W} ${L.H}" width="${L.W}" height="${L.H}" data-w="${L.W}" data-h="${L.H}" role="img" aria-label="Tree with ${L.nodes.length} nodes">`;
  for (const e of L.edges) {
    const x1 = e.p._x, y1 = e.p._y + e.p._h, x2 = e.ch._x, y2 = e.ch._y, my = (y1 + y2) / 2;
    const k = hot.get(e.p.id + '|' + e.c);
    s += `<g class="e${k ? ' e-' + k : ''}"><path d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}"/><circle cx="${(x1 + x2) / 2}" cy="${my}" r="10.5"/><text x="${(x1 + x2) / 2}" y="${my + 4}" text-anchor="middle">${esc(vis(e.c))}</text></g>`;
  }
  for (const n of L.nodes) {
    const x = n._x - n._w / 2, y = n._y, w = n._w, h = n._h;
    const c = ['n', n.end ? 'lf' : 'in'];
    if (hl.path.has(n.id)) c.push('is-path');
    if (hl.cur === n.id) c.push('is-cur');
    if (hl.fresh.has(n.id)) c.push('is-fresh');
    if (hl.bad.has(n.id)) c.push('is-bad');
    s += `<g class="${c.join(' ')}" transform="translate(${x} ${y})"><rect class="box" width="${w}" height="${h}" rx="${n.end ? h / 2 : 6}"/><text class="nid" x="${n.end ? 12 : 2}" y="-6">#${n.id}</text>`;
    if (n.end) {
      const cut = Math.min(n._kd, n.content.length);
      const imp = vis(n.content.slice(0, cut)), rest = vis(n.content.slice(cut));
      s += `<text class="lk" x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle">${imp ? `<tspan class="imp">${termSpan(imp)}</tspan>` : ''}${termSpan(rest)}</text>`;
    } else {
      const k = n.children.length;
      s += `<text class="nt" x="9" y="15">Node${n.size}</text><text class="no" x="${w - 9}" y="15" text-anchor="end">${k}/${n.size}</text>`;
      s += `<text class="nc" x="${w / 2}" y="35" text-anchor="middle">${n.content.length ? termSpan('"' + vis(n.content) + '"') : '""'}</text>`;
      const sw = w - 18, sx = 9, sy = h - 9;
      if (n.size <= 16) {
        const g = n.size <= 4 ? 3 : 1.5, seg = (sw - g * (n.size - 1)) / n.size;
        for (let j = 0; j < n.size; j++) s += `<rect class="slot${j < k ? ' on' : ''}" x="${sx + j * (seg + g)}" y="${sy}" width="${seg}" height="4" rx="1"/>`;
      } else {
        s += `<rect class="slot" x="${sx}" y="${sy}" width="${sw}" height="4" rx="1"/><rect class="slot on" x="${sx}" y="${sy}" width="${Math.max(2, sw * k / n.size)}" height="4" rx="1"/>`;
      }
    }
    s += '</g>';
  }
  return s + '</svg>';
}

/* ---------- key byte strip ---------- */
function keyStrip(kv) {
  const key = kv.key, r2 = kv.row2;
  const off = r2 ? (r2.offset || 0) : 0;
  const N = Math.max(key.length, r2 ? off + r2.s.length : 0);
  const ptr = [];
  if (kv.depth !== null && kv.depth !== undefined) ptr.push([kv.depth, 'depth']);
  if (kv.ptrs) for (const [i, l] of Object.entries(kv.ptrs)) ptr.push([+i, l]);
  const inM = i => kv.match && i >= kv.match[0] && i < kv.match[1];
  let h = `<div class="ks" style="grid-template-columns:4.6rem repeat(${N}, var(--cell))">`;
  h += `<span class="lab ix"></span>`;
  for (let i = 0; i < N; i++) h += `<span class="ix">${i}</span>`;
  h += `<span class="lab">key</span>`;
  for (let i = 0; i < N; i++) {
    if (i >= key.length) { h += `<span class="c none"></span>`; continue; }
    const ch = key[i], cl = ['c'];
    if (ch === TERM) cl.push('term');
    if (kv.pick === i) cl.push('pick');
    else if (kv.miss === i) cl.push('bad');
    else if (inM(i)) cl.push('ok');
    else if (kv.cmpFrom !== undefined && i >= kv.cmpFrom && r2) cl.push(r2.s[i] === ch ? 'ok' : 'bad');
    else if (kv.depth !== null && kv.depth !== undefined && i < kv.depth) cl.push('past');
    h += `<span class="${cl.join(' ')}">${esc(vis(ch))}</span>`;
  }
  if (r2) {
    h += `<span class="lab">${esc(r2.label)}</span>`;
    for (let i = 0; i < N; i++) {
      const j = i - off;
      if (j < 0 || j >= r2.s.length) { h += `<span class="c none"></span>`; continue; }
      const ch = r2.s[j], cl = ['c'];
      if (ch === TERM) cl.push('term');
      if (kv.pick2 === i) cl.push('pick');
      else if (kv.miss === i) cl.push('bad');
      else if (inM(i)) cl.push('ok');
      else if (kv.cmpFrom !== undefined && i >= kv.cmpFrom) cl.push(key[i] === ch ? 'ok' : 'bad');
      else if (kv.depth !== null && i < kv.depth) cl.push('past');
      h += `<span class="${cl.join(' ')}">${esc(vis(ch))}</span>`;
    }
  }
  /* one row per pointer, so labels of neighbouring indices never overlap */
  for (const [at, label] of ptr) {
    h += `<span class="lab pt"></span>`;
    for (let i = 0; i < N; i++) h += `<span class="pt">${i === at ? '▲ ' + esc(label) : ''}</span>`;
  }
  return h + '</div>';
}

/* ---------- Python highlighting ---------- */
const TOK = /(#.*$)|("(?:[^"\\]|\\.)*")|\b(self)\b|\b(def|class|return|if|else|while|and|not|is|None|True|False|in)\b|\b(\d+)\b|\b([A-Za-z_]\w*)(?=\()/g;
function hi(line) {
  let out = '', last = 0, m;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    out += esc(line.slice(last, m.index));
    const cls = m[1] ? 'cm' : m[2] ? 's' : m[3] ? 'sf' : m[4] ? 'k' : m[5] ? 'nm' : 'fn';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = TOK.lastIndex;
  }
  return out + esc(line.slice(last));
}

/* ---------- app ---------- */
const $ = id => document.getElementById(id);
const codeEl = $('code');
let lineEls = {};
let op = 'insert', STEPS = [], WORDS = [], starts = [], idx = 0, timer = null, speed = 1, prevLine = null;

function buildCode() {
  const [a, b] = RANGE[op];
  let h = '';
  for (let n = a; n <= b; n++) h += `<div class="cl" data-ln="${n}"><span class="g">${n}</span><span class="d"></span><span class="tx">${hi(SRC[n - 1] || '')}</span></div>`;
  codeEl.innerHTML = h;
  lineEls = {};
  codeEl.querySelectorAll('.cl').forEach(el => { lineEls[el.dataset.ln] = el; });
  prevLine = null;
  $('codeMeta').textContent = `lines ${a}-${b} · dot = ran during this ${op}`;
}

function load(words, queries) {
  stop();
  const ins = traceInsert(words);
  if (op === 'insert') { STEPS = ins.steps; WORDS = words; }
  else { STEPS = traceSearch(ins.root, queries).steps; WORDS = queries; }
  idx = 0;
  buildCode();
  starts = WORDS.map((_, i) => STEPS.findIndex(s => s.wi === i));
  const res = WORDS.map((_, i) => { const d = STEPS.filter(s => s.wi === i && s.done)[0]; return d ? d.found : undefined; });
  $('scrub').max = STEPS.length - 1;
  $('chips').innerHTML = `<span class="lbl">${op === 'insert' ? 'Inserts' : 'Searches'}</span>` +
    WORDS.map((w, i) => `<button class="chip" data-wi="${i}" type="button"><span class="n">${i + 1}</span>${esc(w)}${res[i] === undefined ? '' : `<span class="r ${res[i] ? 'y' : 'n'}">${res[i] ? '✓' : '✗'}</span>`}</button>`).join('');
  $('scratchPane').hidden = op === 'search';
  $('scratchPane').parentElement.classList.toggle('one', op === 'search');
  render();
}

const TAG = {'Lazy expansion': 't-fresh', 'Path compression': 't-accent', Grow: 't-cursor', Done: 't-fresh', 'Add child': 't-fresh', Descend: 't-cursor', Found: 't-fresh', 'Not found': 't-miss'};

function render() {
  const s = STEPS[idx];
  const hl = {cur: s.cur, fresh: new Set(s.fresh), bad: new Set(s.bad), path: new Set(s.path), edges: s.edges};
  const fnName = s.op === 'insert' ? (s.line >= 85 ? 'insert' : '_insert') : (s.line <= 91 ? 'search' : '_search');
  $('note').innerHTML = `<div class="note-h"><span class="ln">line ${s.line}</span>${s.tag ? `<span class="tag ${TAG[s.tag] || ''}">${esc(s.tag)}</span>` : ''}<span class="call">${fnName} · ${s.op}(${esc(q(s.word))})</span></div><p>${s.note}</p>`;

  if (prevLine && lineEls[prevLine]) { lineEls[prevLine].classList.remove('now'); const old = lineEls[prevLine].querySelector('.inl'); if (old) old.remove(); }
  const seen = new Set(); for (let j = idx; j >= 0 && STEPS[j].wi === s.wi; j--) seen.add(STEPS[j].line);
  for (const [ln, el] of Object.entries(lineEls)) el.classList.toggle('seen', seen.has(+ln));
  const el = lineEls[s.line];
  el.classList.add('now');
  if (s.inline) el.querySelector('.tx').insertAdjacentHTML('beforeend', `<span class="inl">${esc(s.inline)}</span>`);
  prevLine = s.line;
  const top = el.offsetTop;
  if (top < codeEl.scrollTop + 24 || top > codeEl.scrollTop + codeEl.clientHeight - 48) codeEl.scrollTop = Math.max(0, top - codeEl.clientHeight / 2);

  const help = $('helper');
  if (s.helper.length) {
    help.hidden = false;
    help.innerHTML = s.helper.map(name => {
      const [a, b] = HELP[name];
      let pre = '';
      for (let n = a; n <= b; n++) pre += `<span class="g">${n}</span>${hi(SRC[n - 1])}\n`;
      return `<div class="hb"><div class="hb-h">calls <b>${name === 'TrieNode' ? 'TrieNode.__init__' : name}</b> · lines ${a}-${b}</div><pre>${pre.replace(/\n$/, '')}</pre></div>`;
    }).join('');
  } else help.hidden = true;

  $('keyStrip').innerHTML = keyStrip(s.kv);
  $('keyMeta').textContent = s.kv.depth !== null && s.kv.depth !== undefined ? `depth = ${s.kv.depth} · grey = already consumed` : 'key = word + TERM';

  const tw = $('tree');
  if (s.tree) {
    tw.innerHTML = svgTree(s.tree, hl, 0);
    const svg = tw.querySelector('svg'), W = +svg.dataset.w, H = +svg.dataset.h, cw = tw.clientWidth - 24;
    if (W > cw) { const sc = Math.max(cw / W, 0.7); svg.setAttribute('width', W * sc); svg.setAttribute('height', H * sc); }
  } else tw.innerHTML = `<div class="emptyt">root = None</div>`;
  $('keyCount').textContent = `· ${s.keys} key${s.keys === 1 ? '' : 's'}`;

  const DESC = {leaf: 'new key, waiting to be linked', new: 'replacement parent, built off-tree', tail: "old node's lower half", copy: 'copy of the old leaf (no variable name)'};
  $('scratch').innerHTML = s.scratch.length
    ? s.scratch.map(x => `<figure class="scr"><figcaption><code>${x.name}</code>${DESC[x.name]}</figcaption><div class="sv">${svgTree(x.tree, hl, 0)}</div></figure>`).join('')
    : `<p class="empty">Nothing detached. Every node this frame holds is reachable from root.</p>`;

  const p = STEPS[idx - 1], pm = p && p.uid === s.uid ? Object.fromEntries(p.vars) : null;
  $('vars').innerHTML = s.vars.map(([k, v]) => `<tr class="${pm && pm[k] !== v ? 'chg' : ''}"><th>${k}</th><td>${esc(v)}</td></tr>`).join('');
  $('stack').innerHTML = s.stack.map((f, i) => `<li class="${i === 0 ? 'top' : ''}">${esc(f)}</li>`).join('');

  document.querySelectorAll('.chip').forEach(c => { const w = +c.dataset.wi; c.classList.toggle('on', w === s.wi); c.classList.toggle('past', w < s.wi); });
  $('scrub').value = idx;
  $('ctr').innerHTML = `step <b>${idx + 1}</b> / ${STEPS.length}`;
  $('prev').disabled = $('first').disabled = idx === 0;
  $('next').disabled = idx === STEPS.length - 1;
}

function go(i) { idx = Math.max(0, Math.min(STEPS.length - 1, i)); render(); }
function stop() { if (timer) clearInterval(timer); timer = null; $('play').textContent = 'Play'; }
function play() {
  if (timer) { stop(); return; }
  if (idx >= STEPS.length - 1) go(0);
  $('play').textContent = 'Pause';
  timer = setInterval(() => { if (idx >= STEPS.length - 1) { stop(); return; } go(idx + 1); }, 1150 / speed);
}

$('next').onclick = () => { stop(); go(idx + 1); };
$('prev').onclick = () => { stop(); go(idx - 1); };
$('first').onclick = () => { stop(); go(0); };
$('play').onclick = play;
$('scrub').oninput = e => { stop(); go(+e.target.value); };
$('speed').onchange = e => { speed = +e.target.value; if (timer) { stop(); play(); } };
$('chips').onclick = e => { const b = e.target.closest('.chip'); if (b) { stop(); go(starts[+b.dataset.wi]); } };
document.addEventListener('keydown', e => {
  if (e.target.closest('input:not([type=range]),select,textarea')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stop(); go(idx + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); go(idx - 1); }
  else if (e.key === 'Home') { stop(); go(0); }
  else if (e.key === 'End') { stop(); go(STEPS.length - 1); }
  else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); play(); }
});

/* ---------- form ---------- */
const parse = txt => txt.split(/[\s,]+/).map(w => w.replace(/[^\x21-\x7e]/g, '')).filter(Boolean);
function setHint() {
  const sc = SCEN[$('preset').value];
  $('hint').textContent = sc ? (op === 'insert' ? sc.hint : sc.qhint)
    : op === 'insert' ? 'Your own words. Up to 10, each up to 14 characters. Repeat a word to see the duplicate path.'
                      : 'Words are inserted first (silently), then each query is searched step by step.';
}
function setScenario(k) {
  $('preset').value = k;
  if (SCEN[k]) { $('words').value = SCEN[k].words; $('queries').value = SCEN[k].queries; }
  setHint();
}
function setOp(o) {
  op = o;
  $('opInsert').setAttribute('aria-pressed', o === 'insert');
  $('opSearch').setAttribute('aria-pressed', o === 'search');
  $('fldQ').hidden = o === 'insert';
  $('words').previousElementSibling.textContent = o === 'insert' ? 'Words, in insert order' : 'Words in the tree';
  setHint();
}
function run() {
  const w = parse($('words').value), qs = parse($('queries').value), err = $('err');
  const bad = msg => { err.hidden = false; err.textContent = msg; };
  if (!w.length) return bad('Enter at least one word.');
  if (w.length > 10 || w.some(x => x.length > 14)) return bad('Keep it to 10 words of at most 14 characters so the tree stays readable.');
  if (op === 'search' && !qs.length) return bad('Enter at least one word to search for.');
  if (qs.length > 10 || qs.some(x => x.length > 14)) return bad('Keep it to 10 queries of at most 14 characters.');
  err.hidden = true;
  load(w, qs);
}
$('opInsert').onclick = () => { setOp('insert'); run(); };
$('opSearch').onclick = () => { setOp('search'); run(); };
$('preset').onchange = e => { setScenario(e.target.value); if (e.target.value !== 'custom') run(); };
const custom = () => { if ($('preset').value !== 'custom') { $('preset').value = 'custom'; setHint(); } };
$('words').oninput = custom;
$('queries').oninput = custom;
$('runForm').onsubmit = e => { e.preventDefault(); run(); };
window.addEventListener('resize', () => { if (STEPS.length) render(); });

setScenario('patricia');
setOp('insert');
run();
