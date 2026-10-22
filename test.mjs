import assert from 'node:assert/strict';
import {SRC, RANGE, HELP, SHIFT, traceInsert, traceSearch, traceRange} from './art.js';

// line numbers used by the tracers must point at the right Python lines
const L = (n, s) => assert.ok(SRC[n + SHIFT - 1].includes(s), `line ${n}+${SHIFT} should contain ${s}: ${SRC[n + SHIFT - 1]}`);
L(54, 'def _insert'); L(55, 'if node is None'); L(58, 'if self.isLeaf'); L(59, 'leafMatches'); L(68, 'checkPrefix'); L(69, 'p != len');
L(76, 'depth +='); L(82, 'isFull'); L(83, 'addChild(node, c, leaf)'); L(86, 'key = word'); L(87, '_insert(self.root');
L(89, 'def search'); L(90, 'key = word'); L(91, 'return self._search'); L(94, 'node is None'); L(95, 'isLeaf'); L(96, 'checkPrefix');
L(97, 'p != len'); L(98, 'depth +='); L(99, 'c = key'); L(100, 'findChild');
for (const [k, [a, b]] of Object.entries(HELP)) assert.ok(SRC[a - 1].trim().startsWith('def '), `${k} ${a}`);
assert.ok(HELP.addChild[1] - HELP.addChild[0] === 3 && HELP.replace[1] - HELP.replace[0] === 2);
assert.equal(SRC.length, RANGE.range[1]);

// search and range scans must agree with plain Set / sorted-array semantics, for random inputs
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const word = () => Array.from({length: 1 + Math.floor(rnd() * 5)}, () => 'abc'[Math.floor(rnd() * 3)]).join('');
for (let t = 0; t < 300; t++) {
  const words = Array.from({length: 1 + Math.floor(rnd() * 8)}, word);
  const {steps, root} = traceInsert(words);
  assert.ok(steps.length > 0);
  const qs = Array.from({length: 8}, word).concat(words);
  const {steps: ss} = traceSearch(root, qs);
  const got = ss.filter(s => s.done).map(s => s.found);
  assert.deepEqual(got, qs.map(w => words.includes(w)), words.join(' ') + ' | ' + qs.join(' '));

  const sorted = [...new Set(words)].sort();
  for (let r = 0; r < 6; r++) {
    const lo = word(), hi = word();
    const res = traceRange(root, lo, hi);
    assert.deepEqual(res.words, sorted.filter(w => w >= lo && w <= hi), `${words.join(' ')} | [${lo}, ${hi}]`);
    assert.deepEqual(res.steps.at(-1).it.out, res.words);
  }
}
console.log('ok');
