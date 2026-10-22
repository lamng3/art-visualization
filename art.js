/* ART engine: the Python source shown on the page, and a traced JS port of it.
   Every executed line of insert/_insert and search/_search records one snapshot (a "step"). */

export const PY = String.raw`from bisect import bisect_left, insort
TERM = "\0" # ends every key, so no key is a prefix of another
SIZES = (4, 16, 48, 256)

class TrieNode:
    def __init__(self, size: int = 4, content: str = "", end: bool = False, children: dict = None):
        self.size = size
        self.content = content
        self.children = {} if children is None else children
        self.keys = sorted(self.children) # edge bytes in order, for range scans
        self.end = end

class ART:
    def __init__(self):
        self.root = None

    def isLeaf(self, node: TrieNode) -> bool:
        """check if node is leaf"""
        return node.end

    def loadKey(self, leaf: TrieNode) -> str:
        """load content in leaf"""
        return leaf.content

    def leafMatches(self, leaf: TrieNode, key: str, depth: int) -> bool:
        """compare key from depth onward"""
        return self.loadKey(leaf)[depth:] == key[depth:]

    def checkPrefix(self, node: TrieNode, key: str, depth: int) -> int:
        """longest prefix match"""
        p = 0
        while p < len(node.content) and node.content[p] == key[depth + p]:
            p += 1
        return p

    def findChild(self, node: TrieNode, c: str) -> TrieNode:
        """get child node"""
        return node.children.get(c)

    def isFull(self, node: TrieNode) -> bool:
        """check if node is full"""
        return len(node.children) == node.size

    def grow(self, node: TrieNode) -> None:
        """grow node to next size"""
        node.size = SIZES[SIZES.index(node.size) + 1]

    def addChild(self, node: TrieNode, c: str, child: TrieNode) -> None:
        """add a child to node"""
        node.children[c] = child
        insort(node.keys, c)

    def replace(self, node: TrieNode, new: TrieNode) -> None:
        """node becomes new, in place, so its parent needs no update"""
        node.size, node.content, node.children, node.keys, node.end = new.size, new.content, new.children, new.keys, new.end

    def _insert(self, node: TrieNode, key: str, leaf: TrieNode, depth: int) -> None:
        if node is None: # empty tree
            self.root = leaf
            return
        if self.isLeaf(node):
            if self.leafMatches(node, key, depth): return # key already stored
            key2 = self.loadKey(node)
            i = depth
            while key[i] == key2[i]: i += 1 # key[depth:i] matches, key[i] and key2[i] differ
            new = TrieNode(4, key[depth:i]) # lazy expansion: matched part becomes the new parent
            self.addChild(new, key[i], leaf)
            self.addChild(new, key2[i], TrieNode(4, key2, True)) # a copy, node is about to be replaced
            self.replace(node, new)
            return
        p = self.checkPrefix(node, key, depth)
        if p != len(node.content): # path compression: split node.content at p
            new = TrieNode(4, node.content[:p]) # new parent takes content[:p]
            tail = TrieNode(node.size, node.content[p + 1:], node.end, node.children) # content[p] is now the edge char
            self.addChild(new, key[depth + p], leaf)
            self.addChild(new, node.content[p], tail)
            self.replace(node, new)
            return
        depth += len(node.content) # content fully matched
        c = key[depth]
        nextNode = self.findChild(node, c)
        if nextNode is not None:
            self._insert(nextNode, key, leaf, depth + 1)
        else:
            if self.isFull(node): self.grow(node)
            self.addChild(node, c, leaf)

    def insert(self, word: str) -> None:
        key = word + TERM
        self._insert(self.root, key, TrieNode(4, key, True), 0)

    def search(self, word: str) -> bool:
        key = word + TERM
        return self._search(self.root, key, 0)

    def _search(self, node: TrieNode, key: str, depth: int) -> bool:
        if node is None: return False # no child on this edge
        if self.isLeaf(node): return self.leafMatches(node, key, depth) # lazy expansion: verify the rest of the key
        p = self.checkPrefix(node, key, depth)
        if p != len(node.content): return False # path compression: the key leaves the compressed prefix
        depth += len(node.content) # content fully matched
        c = key[depth]
        return self._search(self.findChild(node, c), key, depth + 1)

class ARTIterator:
    """sorted iterator, starts at the first word >= word (> word if after)"""
    def __init__(self, art: ART, word: str, after: bool = False):
        self.stack = [] # path from root to leaf: [node, keys, next child index]
        self.leaf = self._seek(art.root, word + TERM + (TERM if after else ""))

    def _leftmost(self, node: TrieNode) -> TrieNode:
        """go down to the smallest leaf"""
        while not node.end:
            self.stack.append([node, node.keys, 1])
            node = node.children[node.keys[0]]
        return node

    def _next(self) -> TrieNode:
        """go up to an ancestor with an unvisited child, then down"""
        while self.stack:
            node, keys, i = self.stack.pop()
            if i < len(keys):
                self.stack.append([node, keys, i + 1]) # child i is visited
                return self._leftmost(node.children[keys[i]])
        return None

    def _seek(self, node: TrieNode, lo: str) -> TrieNode:
        """first leaf with key >= lo"""
        depth = 0
        while node is not None:
            if node.end:
                return node if node.content >= lo else self._next()
            part = lo[depth:depth + len(node.content)]
            if node.content != part: # whole subtree is on one side of lo
                return self._leftmost(node) if node.content > part else self._next()
            depth += len(node.content)
            c = lo[depth]
            j = bisect_left(node.keys, c) # first edge >= c
            if j < len(node.keys) and node.keys[j] == c:
                self.stack.append([node, node.keys, j + 1])
                node = node.children[c]
                depth += 1
            else:
                self.stack.append([node, node.keys, j]) # _next goes to child j, or up
                return self._next()
        return None

    def hasNext(self) -> bool:
        return self.leaf is not None

    def next(self) -> str:
        word = self.leaf.content[:-1] # drop TERM
        self.leaf = self._next()
        return word

class RangeIter:
    """sorted iterator over the words s with lo <= s <= hi"""
    def __init__(self, art: ART, lo: str, hi: str):
        self.low = ARTIterator(art, lo) # first word >= lo
        self.high = ARTIterator(art, hi, True) # first word > hi, the end

    def hasNext(self) -> bool:
        if not self.low.hasNext(): return False
        return not self.high.hasNext() or self.low.leaf.content < self.high.leaf.content

    def next(self) -> str:
        return self.low.next()

def rangeScan(art: ART, lo: str, hi: str) -> list: # driver, not part of the iterator
    it = RangeIter(art, lo, hi)
    out = []
    while it.hasNext():
        out.append(it.next())
    return out`;

export const SRC = PY.split('\n');
const lineOf = t => SRC.findIndex(l => l.includes(t)) + 1;
/* 1-based [first, last] lines of the method whose def starts at 0-based index i */
const blockAt = i => { let j = i + 1; while (j < SRC.length && SRC[j].startsWith('        ')) j++; return [i + 1, j]; };
const methodAt = (name, after = 0) => blockAt(SRC.findIndex((l, i) => i >= after && l.startsWith(`    def ${name}(`)));
/* the tracers below were written against the unshifted listing, where _insert starts at line 54 */
export const SHIFT = lineOf('def _insert(') - 54;
export const RANGE = {
  insert: [lineOf('def _insert('), lineOf('self._insert(self.root')],
  search: [lineOf('def search('), lineOf('return self._search(self.findChild')],
  range: [lineOf('class ARTIterator'), SRC.length],
};
export const HELP = {
  TrieNode: methodAt('__init__'),
  ...Object.fromEntries(['isLeaf', 'loadKey', 'leafMatches', 'checkPrefix', 'findChild', 'isFull', 'grow', 'addChild', 'replace'].map(n => [n, methodAt(n)])),
  itHasNext: methodAt('hasNext', SRC.findIndex(l => l.includes('class ARTIterator'))),
};
export const HELP_NAME = {TrieNode: 'TrieNode.__init__', itHasNext: 'ARTIterator.hasNext'};

export const TERM = '\0', SIZES = [4, 16, 48, 256];

/* ---------- small helpers ---------- */
let UID = 1;
class TN {
  constructor(size = 4, content = '', end = false, children = null) {
    this.id = UID++; this.size = size; this.content = content; this.end = end;
    this.children = children === null ? new Map() : children;
  }
}
export const vis = s => s.replace(/\0/g, '␀');
export const q = s => '"' + vis(s) + '"';
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const py = b => b ? 'True' : 'False';
const lab = n => n === null || n === undefined ? 'None' : `#${n.id} ${n.end ? 'leaf' : 'Node' + n.size} ${q(n.content)}`;
const ORDER = ['word', 'node', 'key', 'leaf', 'depth', 'p', 'i', 'key2', 'c', 'new', 'tail', 'nextNode'];

/* Children are listed in byte order so the layout is stable. That changes nothing about the logic. */
function clone(n) {
  if (!n) return null;
  const ch = [...n.children].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([c, x]) => [c, clone(x)]);
  return {id: n.id, size: n.size, content: n.content, end: n.end, children: ch};
}
function idsOf(t, set) { if (!t) return set; set.add(t.id); t.children.forEach(([, ch]) => idsOf(ch, set)); return set; }
function desc(n, set) { n.children.forEach(ch => { set.add(ch.id); desc(ch, set); }); return set; }
function leaves(t) { if (!t) return 0; if (t.end) return 1; return t.children.reduce((a, [, ch]) => a + leaves(ch), 0); }
function replace(node, nw) { node.size = nw.size; node.content = nw.content; node.children = nw.children; node.end = nw.end; }

/* ---------- traced insert ---------- */
export function traceInsert(words) {
  UID = 1;
  const art = {root: null}, steps = [], frames = [];
  let fu = 0, word = '', wi = 0;

  function snap(line, o = {}) {
    const top = frames[frames.length - 1];
    const tree = clone(art.root);
    const inTree = idsOf(tree, new Set());
    const cand = [];
    for (const nm of ['leaf', 'new', 'copy', 'tail']) { const n = top.nodes[nm]; if (n && !inTree.has(n.id)) cand.push([nm, n]); }
    const under = new Set(); cand.forEach(([, n]) => desc(n, under));
    const scratch = cand.filter(([, n]) => !under.has(n.id)).map(([nm, n]) => ({name: nm, tree: clone(n)}));
    const v = Object.assign({}, top.v);
    for (const nm of ['node', 'leaf', 'new', 'tail', 'nextNode']) if (nm in top.nodes) v[nm] = lab(top.nodes[nm]);
    steps.push({
      op: 'insert', fn: top.fn, line: line + SHIFT, word, wi, tree, scratch, uid: top.uid,
      vars: ORDER.filter(k => k in v).map(k => [k, String(v[k])]),
      stack: frames.map(f => f.fn === 'insert' ? `insert(${q(f.word)})` : `_insert(node=${f.nodes.node ? '#' + f.nodes.node.id : 'None'}, depth=${f.v.depth})`).reverse(),
      cur: o.cur !== undefined ? o.cur : (top.nodes.node ? top.nodes.node.id : null),
      path: frames.filter(f => f.fn === '_insert' && f.nodes.node).map(f => f.nodes.node.id),
      fresh: o.fresh || [], bad: [], edges: o.edges || [],
      kv: Object.assign({key: top.key, depth: top.fn === 'insert' ? null : top.v.depth}, o.kv || {}),
      note: o.note || '', inline: o.inline || '', tag: o.tag || '', helper: o.helper || [], done: !!o.done,
      keys: leaves(tree),
    });
  }

  function ins(node, key, leaf, depth) {
    const f = {fn: '_insert', key, uid: ++fu, v: {key: q(key), depth}, nodes: {node, leaf}};
    frames.push(f);
    const S = snap;
    const ret = r => { frames.pop(); return r; };

    if (node === null) {
      S(55, {tag: 'Empty tree', inline: 'node is None → True', note: `There is no node here: the whole tree is empty. This branch only ever runs on the very first insert.`});
      art.root = leaf;
      S(56, {tag: 'Empty tree', inline: `root = #${leaf.id}`, fresh: [leaf.id], cur: null, note: `The leaf becomes the root. A single key needs no inner nodes: ART only builds them once two keys have to be told apart.`});
      S(57, {tag: 'Empty tree', inline: 'return', cur: null, note: `Done. The tree is one leaf holding the full key <code>${esc(q(key))}</code>.`});
      return ret({at: leaf.id});
    }
    S(55, {tag: 'Visit', inline: 'node is None → False', note: `<code>node</code> is ${esc(lab(node))}, so there is something to compare against at depth ${depth}.`});

    const isLeaf = node.end;
    S(58, {tag: isLeaf ? 'Leaf reached' : 'Inner node', inline: `isLeaf(node) → ${py(isLeaf)}`, helper: ['isLeaf'],
      note: isLeaf ? `#${node.id} is a leaf. Two keys now meet here: the one already stored and the new one. Either they are equal, or this leaf has to be expanded into an inner node.`
                   : `#${node.id} is an inner Node${node.size} with compressed prefix <code>${esc(q(node.content))}</code>. Next: check how much of that prefix the key matches.`});

    if (isLeaf) {
      const a = node.content, m = a.slice(depth) === key.slice(depth);
      const r2 = {label: 'stored', s: a};
      S(59, {tag: m ? 'Duplicate' : 'Lazy expansion', inline: `leafMatches → ${py(m)}${m ? ' → return' : ''}`, helper: ['leafMatches', 'loadKey'],
        kv: {row2: r2, cmpFrom: depth},
        note: m ? `The stored key equals the new key from depth ${depth} on. Bytes before depth already matched on the way down, so the key is already in the tree. Return with no change.`
                : `Only bytes from depth ${depth} onward are compared, since everything before depth matched on the way down. They differ, so the leaf must be expanded.`});
      if (m) return ret({dup: true, at: node.id});

      const key2 = a; f.v.key2 = q(key2);
      const r = {label: 'key2', s: key2};
      S(60, {tag: 'Lazy expansion', inline: `key2 = ${q(key2)}`, helper: ['loadKey'], kv: {row2: r},
        note: `Load the full key stored in the leaf. Leaves keep the whole key, which is what lets ART avoid materializing a node per byte (lazy expansion).`});
      let i = depth; f.v.i = i;
      S(61, {tag: 'Lazy expansion', inline: `i = ${i}`, kv: {row2: r, ptrs: {[i]: 'i'}},
        note: `Start the scan at depth ${depth}. Nothing before depth needs checking.`});
      while (key[i] === key2[i]) i++;
      f.v.i = i;
      const shared = key.slice(depth, i);
      S(62, {tag: 'Lazy expansion', inline: `i = ${i}   ${q(key[i])} ≠ ${q(key2[i])}`, kv: {row2: r, match: [depth, i], miss: i, ptrs: {[i]: 'i'}},
        note: shared.length ? `Advance i while both keys agree. They share <code>${esc(q(shared))}</code> and first differ at index ${i}: <code>${esc(q(key[i]))}</code> vs <code>${esc(q(key2[i]))}</code>.`
                            : `The keys differ immediately at index ${i}: <code>${esc(q(key[i]))}</code> vs <code>${esc(q(key2[i]))}</code>. The shared part is empty.`});
      const nw = new TN(4, key.slice(depth, i)); f.nodes.new = nw;
      S(63, {tag: 'Lazy expansion', inline: `new = Node4(${q(nw.content)})`, fresh: [nw.id], helper: ['TrieNode'], kv: {row2: r, match: [depth, i]},
        note: `Build one Node4 whose prefix is the shared part <code>${esc(q(nw.content))}</code>. A single inner node is enough to separate the two keys, however long the shared run is.`});
      nw.children.set(key[i], leaf);
      S(64, {tag: 'Lazy expansion', inline: `new[${q(key[i])}] = #${leaf.id}`, fresh: [leaf.id], edges: [{from: nw.id, c: key[i], kind: 'new'}], helper: ['addChild'], kv: {row2: r, pick: i},
        note: `The new leaf hangs under edge <code>${esc(q(key[i]))}</code>, the byte where the new key diverges.`});
      const cp = new TN(4, key2, true); f.nodes.copy = cp; nw.children.set(key2[i], cp);
      S(65, {tag: 'Lazy expansion', inline: `new[${q(key2[i])}] = #${cp.id}`, fresh: [cp.id], edges: [{from: nw.id, c: key2[i], kind: 'new'}], helper: ['TrieNode', 'addChild'], kv: {row2: r, pick2: i},
        note: `A copy of the old leaf (#${cp.id}) goes under <code>${esc(q(key2[i]))}</code>. It has to be a copy: the original object #${node.id} is about to be overwritten.`});
      replace(node, nw); delete f.nodes.new; delete f.nodes.copy;
      S(66, {tag: 'Lazy expansion', inline: `#${node.id} ← new`, fresh: [node.id], edges: [{from: node.id, c: key[i], kind: 'new'}, {from: node.id, c: key2[i], kind: 'new'}], helper: ['replace'],
        note: `<code>replace()</code> copies new's fields into #${node.id} in place. Whatever pointed at #${node.id} (the parent, or root) still points at it, so no parent fix-up is needed. The scratch <code>new</code> object is now dead.`});
      S(67, {tag: 'Lazy expansion', inline: 'return', note: `Done. A leaf turned into an inner node with two leaves under it.`});
      return ret({at: leaf.id});
    }

    const C = node.content; let p = 0;
    while (p < C.length && C[p] === key[depth + p]) p++;
    f.v.p = p;
    const r2 = {label: 'content', s: C, offset: depth};
    const missAt = p < C.length ? depth + p : null;
    S(68, {tag: 'Prefix check', inline: `p = ${p}`, helper: ['checkPrefix'], kv: {row2: r2, match: [depth, depth + p], miss: missAt, ptrs: {[depth + p]: 'depth+p'}},
      note: C.length ? `Line node.content <code>${esc(q(C))}</code> up against the key from depth ${depth}. ${p} of ${C.length} bytes match.`
                     : `This node's prefix is empty, so <code>checkPrefix</code> returns 0 straight away.`});
    const split = p !== C.length;
    S(69, {tag: split ? 'Path compression' : 'Prefix matched', inline: `${p} != ${C.length} → ${py(split)}`, kv: {row2: r2, match: [depth, depth + p], miss: missAt},
      note: split ? `The key leaves the compressed path in the middle of <code>${esc(q(C))}</code>. The node must be split at p = ${p}.`
                  : `The whole prefix matched, so there is no split. Skip past it and pick a child.`});
    if (split) {
      const nw = new TN(4, C.slice(0, p)); f.nodes.new = nw;
      S(70, {tag: 'Path compression', inline: `new = Node4(${q(nw.content)})`, fresh: [nw.id], helper: ['TrieNode'], kv: {row2: r2, match: [depth, depth + p]},
        note: `The new parent keeps the matched part, content[:${p}] = <code>${esc(q(nw.content))}</code>.`});
      const tail = new TN(node.size, C.slice(p + 1), node.end, node.children); f.nodes.tail = tail;
      S(71, {tag: 'Path compression', inline: `tail = Node${tail.size}(${q(tail.content)}, children=node.children)`, fresh: [tail.id], helper: ['TrieNode'], kv: {row2: r2, pick2: depth + p},
        note: `The old node's lower half becomes <code>tail</code> with content[${p + 1}:] = <code>${esc(q(tail.content))}</code>. content[${p}] = <code>${esc(q(C[p]))}</code> is stored nowhere: it turns into the edge label. tail reuses the same children dict and size.`});
      nw.children.set(key[depth + p], leaf);
      S(72, {tag: 'Path compression', inline: `new[${q(key[depth + p])}] = #${leaf.id}`, fresh: [leaf.id], edges: [{from: nw.id, c: key[depth + p], kind: 'new'}], helper: ['addChild'], kv: {row2: r2, pick: depth + p},
        note: `The new leaf goes under the key's diverging byte key[${depth + p}] = <code>${esc(q(key[depth + p]))}</code>.`});
      nw.children.set(C[p], tail);
      S(73, {tag: 'Path compression', inline: `new[${q(C[p])}] = #${tail.id}`, fresh: [tail.id], edges: [{from: nw.id, c: C[p], kind: 'new'}], helper: ['addChild'], kv: {row2: r2, pick2: depth + p},
        note: `The old subtree goes under the prefix's diverging byte <code>${esc(q(C[p]))}</code>.`});
      replace(node, nw); delete f.nodes.new;
      S(74, {tag: 'Path compression', inline: `#${node.id} ← new`, fresh: [node.id], edges: [{from: node.id, c: key[depth + p], kind: 'new'}, {from: node.id, c: C[p], kind: 'new'}], helper: ['replace'],
        note: `#${node.id} takes new's fields in place. The old subtree now sits one level deeper, under #${tail.id}.`});
      S(75, {tag: 'Path compression', inline: 'return', note: `Done. One compressed path became a fork.`});
      return ret({at: leaf.id});
    }

    const old = depth; depth += C.length; f.v.depth = depth;
    S(76, {tag: 'Descend', inline: `depth = ${depth}`,
      note: C.length ? `Prefix consumed: depth jumps ${old} → ${depth}, skipping ${C.length} byte${C.length > 1 ? 's' : ''} in one move. That is the payoff of path compression.`
                     : `Empty prefix, depth stays at ${depth}.`});
    const c = key[depth]; f.v.c = q(c);
    S(77, {tag: 'Descend', inline: `c = ${q(c)}`, kv: {pick: depth}, note: `The next key byte, key[${depth}] = <code>${esc(q(c))}</code>, selects the child.`});
    const nx = node.children.get(c) || null; f.nodes.nextNode = nx;
    const fol = nx ? [{from: node.id, c, kind: 'follow'}] : [];
    S(78, {tag: 'Descend', inline: `nextNode = ${nx ? '#' + nx.id : 'None'}`, helper: ['findChild'], edges: fol, kv: {pick: depth},
      note: nx ? `Edge <code>${esc(q(c))}</code> exists and leads to ${esc(lab(nx))}.` : `#${node.id} has no child under <code>${esc(q(c))}</code>.`});
    S(79, {tag: nx ? 'Descend' : 'Add child', inline: `nextNode is not None → ${py(!!nx)}`, edges: fol, kv: {pick: depth},
      note: nx ? `A child exists, so recurse into it.` : `No child, so the leaf goes straight into this node. No split is needed.`});
    if (nx) {
      S(80, {tag: 'Descend', inline: `_insert(#${nx.id}, depth=${depth + 1})`, edges: fol, kv: {pick: depth},
        note: `Recurse into #${nx.id} with depth ${depth + 1}. The +1 accounts for the edge byte <code>${esc(q(c))}</code>, which is consumed by following the edge.`});
      const r = ins(nx, key, leaf, depth + 1);
      return ret(r);
    }
    const k = node.children.size, full = k === node.size; let grew = null;
    if (full) { const o = node.size; node.size = SIZES[SIZES.indexOf(o) + 1]; grew = [o, node.size]; }
    S(82, {tag: grew ? 'Grow' : 'Add child', inline: grew ? `isFull → True · grow: Node${grew[0]} → Node${grew[1]}` : `isFull → False (${k}/${node.size})`,
      fresh: grew ? [node.id] : [], helper: grew ? ['isFull', 'grow'] : ['isFull'],
      note: grew ? `All ${k} slots of the Node${grew[0]} are taken. grow() moves it up to Node${grew[1]}. Real ART would allocate the bigger node layout and copy children over. Here only the size changes.`
                 : `${k} of ${node.size} slots used, so there is room. No growth.`});
    node.children.set(c, leaf);
    S(83, {tag: 'Add child', inline: `node[${q(c)}] = #${leaf.id}`, fresh: [leaf.id], edges: [{from: node.id, c, kind: 'new'}], helper: ['addChild'],
      note: `Attach the leaf under edge <code>${esc(q(c))}</code>. #${node.id} now holds ${k + 1} of ${node.size} children.`});
    return ret({at: leaf.id});
  }

  for (wi = 0; wi < words.length; wi++) {
    word = words[wi];
    const key = word + TERM;
    const f0 = {fn: 'insert', word, key, uid: ++fu, v: {word: q(word), key: q(key)}, nodes: {}};
    frames.length = 0; frames.push(f0);
    snap(86, {tag: 'Setup', inline: `key = ${q(key)}`, kv: {depth: null},
      note: `Append TERM (<code>\\0</code>, drawn as ␀) to <code>${esc(q(word))}</code>. With a terminator, no stored key can be a prefix of another, so every key ends at its own leaf.`});
    const leaf = new TN(4, key, true); f0.nodes.leaf = leaf;
    snap(87, {tag: 'Setup', fresh: [leaf.id], inline: `_insert(root, key, #${leaf.id}, 0)`, helper: ['TrieNode'], kv: {depth: 0},
      note: `Build the leaf #${leaf.id} holding the full key, then start the recursive insert at the root with depth = 0. The leaf is not linked anywhere yet.`});
    const res = ins(art.root, key, leaf, 0);
    frames.length = 1;
    const nextW = words[wi + 1];
    snap(87, {tag: res.dup ? 'Duplicate' : 'Done', done: true, cur: res.dup ? res.at : null, fresh: res.dup ? [] : [res.at], kv: {depth: null},
      inline: res.dup ? 'returned, tree unchanged' : 'returned',
      note: (res.dup ? `<code>${esc(q(word))}</code> was already stored at leaf #${res.at}, so the tree is unchanged.` : `<code>${esc(q(word))}</code> is in, at leaf #${res.at}.`) +
            (nextW !== undefined ? ` Next up: <code>insert(${esc(q(nextW))})</code>.` : ` That was the last word.`)});
  }
  return {steps, root: art.root};
}

/* ---------- traced search (read-only, runs on the tree that insert built) ---------- */
export function traceSearch(root, queries) {
  const steps = [], frames = [];
  let fu = 0, word = '', wi = 0;

  function snap(line, o = {}) {
    const top = frames[frames.length - 1];
    const tree = clone(root);
    const v = Object.assign({}, top.v);
    if (top.fn === '_search') v.node = lab(top.node);
    steps.push({
      op: 'search', fn: top.fn, line: line + SHIFT, word, wi, tree, scratch: [], uid: top.uid,
      vars: ORDER.filter(k => k in v).map(k => [k, String(v[k])]),
      stack: frames.map(f => f.fn === 'search' ? `search(${q(f.word)})` : `_search(node=${f.node ? '#' + f.node.id : 'None'}, depth=${f.v.depth})`).reverse(),
      cur: o.cur !== undefined ? o.cur : (top.node ? top.node.id : null),
      path: frames.filter(f => f.fn === '_search' && f.node).map(f => f.node.id),
      fresh: o.fresh || [], bad: o.bad || [], edges: o.edges || [],
      kv: Object.assign({key: top.key, depth: top.fn === 'search' ? null : top.v.depth}, o.kv || {}),
      note: o.note || '', inline: o.inline || '', tag: o.tag || '', helper: o.helper || [], done: !!o.done,
      keys: leaves(tree), found: o.found,
    });
  }

  /* from = id of the parent that had no matching edge, so a miss can point at it */
  function rec(node, key, depth, from) {
    const f = {fn: '_search', key, uid: ++fu, node, v: {key: q(key), depth}};
    frames.push(f);
    const S = snap;
    const ret = r => { frames.pop(); return r; };

    if (node === null) {
      S(94, {tag: 'Not found', cur: null, bad: from === null ? [] : [from], inline: 'node is None → True → return False',
        note: from === null ? `The tree is empty, so there is nothing to find. Return <code>False</code>.`
                            : `The parent has no edge for this byte, so there is no node to visit. No stored key continues this way. Return <code>False</code>.`});
      return ret({ok: false, at: from, why: 'noedge'});
    }
    S(94, {tag: 'Visit', inline: 'node is None → False', note: `<code>node</code> is ${esc(lab(node))}, at depth ${depth}.`});

    if (node.end) {
      const a = node.content, m = a.slice(depth) === key.slice(depth);
      let j = depth; while (j < key.length && key[j] === a[j]) j++;
      S(95, {tag: m ? 'Found' : 'Not found', inline: `isLeaf → True · leafMatches → ${py(m)} → return ${py(m)}`, helper: ['isLeaf', 'leafMatches', 'loadKey'],
        cur: node.id, fresh: m ? [node.id] : [], bad: m ? [] : [node.id],
        kv: {row2: {label: 'stored', s: a}, cmpFrom: depth},
        note: m ? `#${node.id} is a leaf. Lazy expansion means the path only checked the bytes that were needed to tell keys apart, so the leaf's stored key is compared from depth ${depth} on. Every byte agrees: the word is in the tree.`
                : `#${node.id} is a leaf. Lazy expansion means the path never checked the bytes it skipped, so the stored key is compared from depth ${depth} on. They differ at index ${j} (<code>${esc(q(a[j] ?? ''))}</code> vs <code>${esc(q(key[j] ?? ''))}</code>): the path led here, but this is a different word.`});
      return ret({ok: m, at: node.id, why: m ? 'match' : 'leaf'});
    }
    S(95, {tag: 'Inner node', inline: 'isLeaf → False', helper: ['isLeaf'],
      note: `#${node.id} is an inner Node${node.size} with compressed prefix <code>${esc(q(node.content))}</code>. Check how much of that prefix the key matches.`});

    const C = node.content; let p = 0;
    while (p < C.length && C[p] === key[depth + p]) p++;
    f.v.p = p;
    const r2 = {label: 'content', s: C, offset: depth};
    const missAt = p < C.length ? depth + p : null;
    S(96, {tag: 'Prefix check', inline: `p = ${p}`, helper: ['checkPrefix'], kv: {row2: r2, match: [depth, depth + p], miss: missAt, ptrs: {[depth + p]: 'depth+p'}},
      note: C.length ? `Line node.content <code>${esc(q(C))}</code> up against the key from depth ${depth}. ${p} of ${C.length} bytes match.`
                     : `This node's prefix is empty, so <code>checkPrefix</code> returns 0 straight away.`});
    if (p !== C.length) {
      const ended = key[depth + p] === TERM;
      S(97, {tag: 'Not found', inline: `${p} != ${C.length} → True → return False`, bad: [node.id], kv: {row2: r2, match: [depth, depth + p], miss: missAt},
        note: ended ? `The word ends (<code>␀</code>) in the middle of the compressed prefix <code>${esc(q(C))}</code>. It is only a prefix of stored words, not a stored word itself. Return <code>False</code>.`
                    : `The key leaves the compressed path at index ${depth + p}: it has <code>${esc(q(key[depth + p]))}</code> where the prefix has <code>${esc(q(C[p]))}</code>. No stored key can continue from here. Return <code>False</code>.`});
      return ret({ok: false, at: node.id, why: ended ? 'ended' : 'prefix'});
    }
    S(97, {tag: 'Prefix matched', inline: `${p} != ${C.length} → False`, kv: {row2: r2, match: [depth, depth + p]},
      note: `The whole prefix matched, so keep going.`});

    const old = depth; depth += C.length; f.v.depth = depth;
    S(98, {tag: 'Descend', inline: `depth = ${depth}`,
      note: C.length ? `Prefix consumed: depth jumps ${old} → ${depth}, skipping ${C.length} byte${C.length > 1 ? 's' : ''} in one move.` : `Empty prefix, depth stays at ${depth}.`});
    const c = key[depth]; f.v.c = q(c);
    S(99, {tag: 'Descend', inline: `c = ${q(c)}`, kv: {pick: depth}, note: `The next key byte, key[${depth}] = <code>${esc(q(c))}</code>, selects the child.`});
    const nx = node.children.get(c) || null;
    const fol = nx ? [{from: node.id, c, kind: 'follow'}] : [];
    S(100, {tag: 'Descend', inline: nx ? `findChild → #${nx.id} · _search(#${nx.id}, depth=${depth + 1})` : `findChild → None · _search(None, depth=${depth + 1})`,
      helper: ['findChild'], edges: fol, kv: {pick: depth},
      note: nx ? `Edge <code>${esc(q(c))}</code> exists and leads to ${esc(lab(nx))}. Recurse into it with depth ${depth + 1}: the +1 consumes the edge byte.`
               : `#${node.id} has no child under <code>${esc(q(c))}</code>. The recursive call receives <code>None</code>.`});
    return ret(rec(nx, key, depth + 1, node.id));
  }

  for (wi = 0; wi < queries.length; wi++) {
    word = queries[wi];
    const key = word + TERM;
    const f0 = {fn: 'search', word, key, uid: ++fu, node: null, v: {word: q(word), key: q(key)}};
    frames.length = 0; frames.push(f0);
    snap(90, {tag: 'Setup', cur: null, inline: `key = ${q(key)}`, kv: {depth: null},
      note: `Append TERM (<code>\\0</code>, drawn as ␀) to <code>${esc(q(word))}</code>, exactly as insert does. Without it, a search for a prefix such as <code>"ro"</code> could run out of key mid-path.`});
    snap(91, {tag: 'Setup', cur: null, inline: `_search(root, key, 0)`, kv: {depth: 0},
      note: `Start at the root with depth = 0. Search never modifies the tree: it only walks down and compares.`});
    const res = rec(root, key, 0, null);
    frames.length = 1;
    const why = {
      match: `<code>${esc(q(word))}</code> is stored, at leaf #${res.at}.`,
      leaf: `<code>${esc(q(word))}</code> is not stored. The path reached leaf #${res.at}, but its key is a different word.`,
      prefix: `<code>${esc(q(word))}</code> is not stored. It left the compressed path at node #${res.at}.`,
      ended: `<code>${esc(q(word))}</code> is not stored. It is only a prefix of other keys (node #${res.at}).`,
      noedge: res.at === null ? `<code>${esc(q(word))}</code> is not stored: the tree is empty.` : `<code>${esc(q(word))}</code> is not stored. Node #${res.at} has no edge for the next byte.`,
    }[res.why];
    const nextW = queries[wi + 1];
    snap(91, {tag: res.ok ? 'Found' : 'Not found', done: true, found: res.ok, cur: res.at, fresh: res.ok ? [res.at] : [], bad: res.ok ? [] : (res.at === null ? [] : [res.at]), kv: {depth: null},
      inline: `returned ${py(res.ok)}`,
      note: why + (nextW !== undefined ? ` Next up: <code>search(${esc(q(nextW))})</code>.` : ` That was the last query.`)});
  }
  return {steps};
}

/* ---------- traced range scan: ARTIterator + RangeIter, on the tree that insert built ---------- */
const F = (marker, text) => {
  const a = SRC.findIndex(l => l.includes(marker));
  const b = SRC.findIndex((l, i) => i >= a && l.includes(text));
  if (a < 0 || b < 0) throw new Error(`source line not found: ${marker} / ${text}`);
  return b + 1;
};
const LN = {
  rsIt: F('def rangeScan', 'it = RangeIter'), rsOut: F('def rangeScan', 'out = []'), rsWhile: F('def rangeScan', 'while it.hasNext()'),
  rsApp: F('def rangeScan', 'out.append'), rsRet: F('def rangeScan', 'return out'),
  riLow: F('class RangeIter', 'self.low = ARTIterator'), riHigh: F('class RangeIter', 'self.high = ARTIterator'),
  riHn1: F('class RangeIter', 'if not self.low.hasNext()'), riHn2: F('class RangeIter', 'return not self.high.hasNext()'), riNext: F('class RangeIter', 'return self.low.next()'),
  itStack: F('class ARTIterator', 'self.stack = []'), itLeaf: F('class ARTIterator', 'self.leaf = self._seek'),
  inNext1: F('class ARTIterator', 'word = self.leaf.content[:-1]'), inNext2: F('class ARTIterator', 'self.leaf = self._next()'), inNext3: F('class ARTIterator', 'return word'),
  lmWhile: F('def _leftmost', 'while not node.end'), lmPush: F('def _leftmost', 'self.stack.append'), lmDown: F('def _leftmost', 'node = node.children'), lmRet: F('def _leftmost', 'return node'),
  nxWhile: F('def _next', 'while self.stack'), nxPop: F('def _next', 'self.stack.pop()'), nxIf: F('def _next', 'if i < len(keys)'), nxPush: F('def _next', 'self.stack.append'),
  nxRet: F('def _next', 'return self._leftmost'), nxNone: F('def _next', 'return None'),
  skDepth: F('def _seek', 'depth = 0'), skWhile: F('def _seek', 'while node is not None'), skEnd: F('def _seek', 'if node.end'), skLeafRet: F('def _seek', 'return node if node.content'),
  skPart: F('def _seek', 'part = lo['), skNe: F('def _seek', 'if node.content != part'), skSide: F('def _seek', 'return self._leftmost(node) if'),
  skDepthAdd: F('def _seek', 'depth += len(node.content)'), skC: F('def _seek', 'c = lo[depth]'), skJ: F('def _seek', 'j = bisect_left'), skIf: F('def _seek', 'if j < len(node.keys)'),
  skPush1: F('def _seek', 'self.stack.append([node, node.keys, j + 1])'), skDown: F('def _seek', 'node = node.children[c]'), skDepth1: F('def _seek', 'depth += 1'),
  skPush2: F('def _seek', 'self.stack.append([node, node.keys, j])'), skNext: F('def _seek', 'return self._next()'), skNone: F('def _seek', 'return None'),
};
const ORDER_R = ['word', 'after', 'lo', 'hi', 'low.leaf', 'high.leaf', 'node', 'depth', 'part', 'c', 'keys', 'j', 'i', 'out'];
const fk = keys => '[' + keys.map(k => q(k)).join(', ') + ']';
const bisectLeft = (a, x) => { let l = 0, h = a.length; while (l < h) { const m = (l + h) >> 1; if (a[m] < x) l = m + 1; else h = m; } return l; };
const leafList = (n, out = []) => { if (n.end) out.push(n); else n.children.forEach(ch => leafList(ch, out)); return out; };

export function traceRange(root, lo, hi) {
  const steps = [], frames = [];
  const low = {stack: [], leaf: null}, high = {stack: [], leaf: null}, out = [];
  let fu = 0, phase = 0, moves = 0, scanning = false, rangeOn = false, active = low, key = lo + TERM;
  const keysOf = n => [...n.children.keys()].sort();
  const loK = lo + TERM, hiK = hi + TERM + TERM;
  const inRange = root ? leafList(root).filter(l => l.content >= loK && l.content < hiK).map(l => l.id) : [];
  const treeC = () => clone(root);
  const snapIt = it => ({stack: it.stack.map(([n, k, i]) => ({id: n.id, i, n: k.length})), leaf: it.leaf ? {id: it.leaf.id, w: it.leaf.content} : null});
  const frame = (fn, v, label) => { const f = {fn, v, label, uid: ++fu, node: null}; frames.push(f); return f; };
  const leafTxt = l => l ? `#${l.id} ${q(l.content)}` : 'None';

  function S(line, o = {}) {
    const top = frames[frames.length - 1];
    const v = Object.assign({}, top.v);
    if (top.fn === 'RangeIter.hasNext' || top.fn === 'RangeIter.next' || top.fn === 'ARTIterator.next') { v['low.leaf'] = leafTxt(low.leaf); v['high.leaf'] = leafTxt(high.leaf); }
    if (top.fn === 'rangeScan') v.out = fk(out.map(x => x.w));
    const tree = treeC();
    steps.push({
      op: 'range', fn: top.fn, line, word: lo, wi: phase, tree, scratch: [], uid: top.uid,
      vars: ORDER_R.filter(k => k in v).map(k => [k, String(v[k])]),
      stack: frames.map(f => f.label()).reverse(),
      cur: o.cur !== undefined ? o.cur : (top.node ? top.node.id : null),
      path: (o.it || active).stack.map(e => e[0].id),
      fresh: o.fresh || [], bad: [], end: high.leaf && (rangeOn || phase === 1) ? [high.leaf.id] : [],
      range: rangeOn ? inRange : [], emitted: out.map(x => x.id), edges: o.edges || [],
      kv: Object.assign({key, depth: null}, o.kv || {}),
      note: o.note || '', inline: o.inline || '', tag: o.tag || '', helper: o.helper || [], done: !!o.done,
      keys: leaves(tree),
      it: {low: snapIt(low), high: snapIt(high), out: out.map(x => x.w), active: active === low ? 'low' : 'high'},
    });
  }

  function leftmost(node, it) {
    const f = frame('_leftmost', {node: lab(node)}, () => `_leftmost(node=#${f.node.id})`); f.node = node;
    while (true) {
      const inner = !node.end;
      S(LN.lmWhile, {tag: 'Leftmost', inline: `not node.end → ${py(inner)}`, kv: {},
        note: inner ? `#${node.id} is an inner node, so the smallest key is still further down.` : `#${node.id} is a leaf: the smallest key of this subtree.`});
      if (!inner) break;
      const keys = keysOf(node); it.stack.push([node, keys, 1]);
      S(LN.lmPush, {tag: 'Leftmost', inline: `push [#${node.id}, keys, 1]`,
        note: `Remember #${node.id} on the stack with next child index 1: its child 0 is about to be visited, so the scan resumes at child 1 later.`});
      const parent = node, k0 = keys[0];
      node = node.children.get(k0); f.node = node; f.v.node = lab(node); if (scanning) moves++;
      S(LN.lmDown, {tag: 'Leftmost', inline: `node = #${node.id}`, edges: [{from: parent.id, c: k0, kind: 'follow'}],
        note: `Always take the smallest edge, <code>${esc(q(k0))}</code>. Edge bytes are kept sorted in <code>node.keys</code>, so keys[0] leads to the smallest key.`});
    }
    S(LN.lmRet, {tag: 'Leftmost', inline: `return #${node.id}`, fresh: [node.id], note: `The leftmost leaf is ${esc(leafTxt(node))}.`});
    frames.pop(); return node;
  }

  function nextFn(it) {
    const f = frame('_next', {}, () => `_next(stack depth ${it.stack.length})`);
    while (true) {
      const has = it.stack.length > 0;
      S(LN.nxWhile, {tag: 'Climb', inline: `stack → ${py(has)}`, kv: {}, note: has ? `The stack still holds ancestors that may have an unvisited child.` : `The stack is empty: there are no ancestors left to try.`});
      if (!has) break;
      const [node, keys, i] = it.stack.pop(); if (scanning) moves++;
      f.node = node; f.v.node = lab(node); f.v.keys = fk(keys); f.v.i = i;
      S(LN.nxPop, {tag: 'Climb', inline: `pop → #${node.id}, i = ${i}`, note: `Climb one level: pop #${node.id}. Its next unvisited child index is ${i} of ${keys.length}.`});
      const more = i < keys.length;
      S(LN.nxIf, {tag: 'Climb', inline: `${i} < ${keys.length} → ${py(more)}`,
        note: more ? `Child ${i} (edge <code>${esc(q(keys[i]))}</code>) has not been visited, so the next key is below it.` : `All ${keys.length} children are done. Keep climbing.`});
      if (more) {
        it.stack.push([node, keys, i + 1]);
        S(LN.nxPush, {tag: 'Climb', inline: `push [#${node.id}, keys, ${i + 1}]`, note: `Put #${node.id} back with index ${i + 1}, because child ${i} is about to be visited.`});
        const child = node.children.get(keys[i]);
        S(LN.nxRet, {tag: 'Descend', inline: `_leftmost(#${child.id})`, edges: [{from: node.id, c: keys[i], kind: 'follow'}], note: `Dive into child ${i}, down to its smallest leaf.`});
        const r = leftmost(child, it); frames.pop(); return r;
      }
    }
    S(LN.nxNone, {tag: 'End', inline: 'return None', cur: null, note: `Nothing is larger. The iterator is exhausted, so its leaf becomes <code>None</code>.`});
    frames.pop(); return null;
  }

  function seek(nodeArg, loStr, it) {
    const f = frame('_seek', {lo: q(loStr), node: lab(nodeArg)}, () => `_seek(node=${f.node ? '#' + f.node.id : 'None'}, depth=${f.v.depth})`);
    let node = nodeArg, depth = 0; f.node = node; f.v.depth = 0;
    S(LN.skDepth, {tag: 'Seek', inline: 'depth = 0', kv: {depth: 0}, note: `Start at the root. <code>lo</code> is ${esc(q(loStr))}; we want the first leaf whose key is ≥ lo.`});
    while (true) {
      f.node = node; f.v.node = lab(node);
      S(LN.skWhile, {tag: 'Seek', inline: `node is not None → ${py(node !== null)}`, kv: {depth},
        note: node ? `Visit ${esc(lab(node))}.` : `There is no tree to search.`});
      if (node === null) break;
      if (node.end) {
        S(LN.skEnd, {tag: 'Leaf', inline: 'node.end → True', kv: {depth}, note: `#${node.id} is a leaf. It stores its full key, so compare the whole key with lo.`});
        const ok = node.content >= loStr;
        S(LN.skLeafRet, {tag: 'Leaf', inline: `${q(node.content)} >= ${q(loStr)} → ${py(ok)}${ok ? ' → return node' : ' → _next()'}`, kv: {depth, row2: {label: 'leaf', s: node.content}, cmpFrom: 0},
          fresh: ok ? [node.id] : [],
          note: ok ? `The leaf's key is ≥ lo, so it is the first qualifying leaf. Every key to its left was smaller.`
                   : `The leaf's key is smaller than lo, so it does not qualify. The answer is the next leaf to the right: call <code>_next()</code>.`});
        if (ok) { frames.pop(); return node; }
        const r = nextFn(it); frames.pop(); return r;
      }
      S(LN.skEnd, {tag: 'Seek', inline: 'node.end → False', kv: {depth}, note: `#${node.id} is an inner Node${node.size} with prefix <code>${esc(q(node.content))}</code>.`});
      const C = node.content, part = loStr.slice(depth, depth + C.length); f.v.part = q(part);
      let p = 0; while (p < C.length && p < part.length && C[p] === part[p]) p++;
      S(LN.skPart, {tag: 'Seek', inline: `part = ${q(part)}`, kv: {depth, row2: {label: 'content', s: C, offset: depth}, match: [depth, depth + p], miss: p < C.length ? depth + p : null},
        note: `Cut the slice of lo that lines up with this node's prefix: lo[${depth}:${depth + C.length}] = <code>${esc(q(part))}</code>.`});
      const ne = C !== part;
      S(LN.skNe, {tag: ne ? 'Mismatch' : 'Seek', inline: `content != part → ${py(ne)}`, kv: {depth, row2: {label: 'content', s: C, offset: depth}, match: [depth, depth + p], miss: p < C.length ? depth + p : null},
        note: ne ? `The prefix differs from lo. The prefix is stored in the node, so no leaf has to be loaded: every key below this node lies on the same side of lo.`
                 : `The prefix equals lo's slice, so lo may still be inside this subtree. Keep descending.`});
      if (ne) {
        const gt = C > part;
        S(LN.skSide, {tag: 'Mismatch', inline: `${q(C)} > ${q(part)} → ${py(gt)} → ${gt ? '_leftmost(node)' : '_next()'}`, kv: {depth, row2: {label: 'content', s: C, offset: depth}, match: [depth, depth + p], miss: p < C.length ? depth + p : null},
          note: gt ? `The whole subtree is greater than lo, so its smallest leaf is the answer: <code>_leftmost(node)</code>.`
                   : `The whole subtree is smaller than lo, so nothing in it qualifies. <code>_next()</code> moves on to the right of this subtree.`});
        const r = gt ? leftmost(node, it) : nextFn(it); frames.pop(); return r;
      }
      depth += C.length; f.v.depth = depth;
      S(LN.skDepthAdd, {tag: 'Descend', inline: `depth = ${depth}`, kv: {depth}, note: C.length ? `Skip the ${C.length}-byte prefix in one move.` : `Empty prefix: depth stays at ${depth}.`});
      const c = loStr[depth]; f.v.c = q(c);
      S(LN.skC, {tag: 'Descend', inline: `c = ${q(c)}`, kv: {depth, pick: depth}, note: `The next byte of lo is <code>${esc(q(c))}</code>.`});
      const keys = keysOf(node), j = bisectLeft(keys, c); f.v.keys = fk(keys); f.v.j = j;
      S(LN.skJ, {tag: 'Descend', inline: `j = ${j}`, kv: {depth, pick: depth},
        note: `<code>bisect_left</code> is a binary search over this node's sorted edge bytes ${esc(fk(keys))} for the first edge ≥ <code>${esc(q(c))}</code>. It returns index ${j}. This is the only binary search in the scan, and it is over at most ${node.size} edges.`});
      const hit = j < keys.length && keys[j] === c;
      S(LN.skIf, {tag: 'Descend', inline: `${j} < ${keys.length} and keys[${j}] == ${q(c)} → ${py(hit)}`, kv: {depth, pick: depth},
        note: hit ? `The exact edge exists: lo continues inside child ${j}.` : j < keys.length ? `No edge equals <code>${esc(q(c))}</code>. Edge <code>${esc(q(keys[j]))}</code> (index ${j}) is the next larger one.` : `Every edge is smaller than <code>${esc(q(c))}</code>, so nothing here qualifies.`});
      if (hit) {
        it.stack.push([node, keys, j + 1]);
        S(LN.skPush1, {tag: 'Descend', inline: `push [#${node.id}, keys, ${j + 1}]`, kv: {depth, pick: depth},
          note: `Remember the way back. Once child ${j} is finished, the scan continues at child ${j + 1} of #${node.id}.`});
        const parent = node; node = node.children.get(c); f.node = node; f.v.node = lab(node);
        S(LN.skDown, {tag: 'Descend', inline: `node = #${node.id}`, kv: {depth, pick: depth}, edges: [{from: parent.id, c, kind: 'follow'}], note: `Follow edge <code>${esc(q(c))}</code> to ${esc(lab(node))}.`});
        depth += 1; f.v.depth = depth;
        S(LN.skDepth1, {tag: 'Descend', inline: `depth = ${depth}`, kv: {depth}, note: `The edge byte is consumed, so depth moves up by 1.`});
      } else {
        it.stack.push([node, keys, j]);
        S(LN.skPush2, {tag: 'Descend', inline: `push [#${node.id}, keys, ${j}]`, kv: {depth, pick: depth},
          note: `Push the node with index ${j}: <code>_next</code> will go to child ${j} (the first edge larger than lo's byte), or climb if there is none.`});
        S(LN.skNext, {tag: 'Climb', inline: 'return self._next()', kv: {depth, pick: depth}, note: `Hand over to <code>_next()</code>.`});
        const r = nextFn(it); frames.pop(); return r;
      }
    }
    S(LN.skNone, {tag: 'End', inline: 'return None', note: `The tree is empty, so there is nothing to return.`});
    frames.pop(); return null;
  }

  function makeIter(which, word, after) {
    const it = which === 'low' ? low : high;
    const f = frame('ARTIterator.__init__', {word: q(word), after: py(after)}, () => `ARTIterator.__init__(word=${q(word)}, after=${py(after)})`);
    active = it; key = word + TERM + (after ? TERM : '');
    S(LN.itStack, {tag: 'Setup', inline: 'stack = []', kv: {},
      note: `An empty stack. Entries are <code>[node, keys, next child index]</code>; together they remember the path from the root to the current leaf, which is all the iterator needs to move right.`});
    S(LN.itLeaf, {tag: 'Seek', inline: `_seek(root, ${q(key)})`, kv: {},
      note: after ? `The target is <code>${esc(q(key))}</code>: the word, TERM, and a second TERM. Every stored key is a word followed by one TERM, so no key can equal this one, and the first leaf ≥ it is the first word strictly greater than ${esc(q(word))}.`
                  : `The target is <code>${esc(q(key))}</code>: the word plus TERM. The first leaf ≥ it is the first word ≥ ${esc(q(word))}.`});
    it.leaf = seek(root, key, it);
    S(LN.itLeaf, {tag: 'Seek', inline: `leaf = ${leafTxt(it.leaf)}`, kv: {}, fresh: it.leaf ? [it.leaf.id] : [], cur: it.leaf ? it.leaf.id : null,
      note: it.leaf ? `The seek found ${esc(leafTxt(it.leaf))}.` : `The seek found nothing: no key is that large.`});
    frames.pop();
  }

  /* ----- driver ----- */
  const rs = frame('rangeScan', {lo: q(lo), hi: q(hi)}, () => `rangeScan(${q(lo)}, ${q(hi)})`);
  S(LN.rsIt, {tag: 'Setup', inline: `it = RangeIter(art, ${q(lo)}, ${q(hi)})`, kv: {},
    note: `A range scan <code>[${esc(q(lo))}, ${esc(q(hi))}]</code> is two seeks and a walk. Seek the first word ≥ lo, seek the first word > hi (the end), then walk leaf to leaf until the two meet.`});
  const ri = frame('RangeIter.__init__', {lo: q(lo), hi: q(hi)}, () => `RangeIter.__init__(lo=${q(lo)}, hi=${q(hi)})`);
  S(LN.riLow, {tag: 'Setup', inline: `ARTIterator(art, ${q(lo)})`, kv: {}, note: `Build the start iterator: it seeks the first word ≥ <code>${esc(q(lo))}</code>.`});
  makeIter('low', lo, false);
  S(LN.riLow, {tag: 'Range start', inline: `low.leaf = ${leafTxt(low.leaf)}`, kv: {}, fresh: low.leaf ? [low.leaf.id] : [], cur: low.leaf ? low.leaf.id : null,
    note: low.leaf ? `The scan will start at ${esc(leafTxt(low.leaf))}. Its stack holds the path from the root, so the walk can continue to the right.` : `There is no word ≥ lo, so the range is empty.`});
  phase = 1;
  S(LN.riHigh, {tag: 'Setup', inline: `ARTIterator(art, ${q(hi)}, True)`, kv: {}, note: `Build the end iterator the same way, with <code>after=True</code>: it seeks the first word strictly greater than <code>${esc(q(hi))}</code>.`});
  makeIter('high', hi, true);
  rangeOn = true;
  S(LN.riHigh, {tag: 'Range end', inline: `high.leaf = ${leafTxt(high.leaf)}`, kv: {},
    note: (high.leaf ? `The end is ${esc(leafTxt(high.leaf))}, the first word past hi (dashed orange).` : `No word is greater than hi, so the scan will run to the last word.`) +
          ` Leaves shaded green are the answer: ${inRange.length} word${inRange.length === 1 ? '' : 's'}. The scan has not found them yet; it only knows where to start and stop.`});
  frames.pop();
  phase = 2; scanning = true; active = low;
  S(LN.rsOut, {tag: 'Scan', inline: 'out = []', kv: {}, note: `Now walk. Each step takes <code>low.leaf</code>, then moves <code>low</code> to the next leaf with <code>_next()</code>.`});
  while (true) {
    S(LN.rsWhile, {tag: 'Scan', inline: 'it.hasNext()', kv: {}, note: `Ask the iterator whether another word is in range.`});
    const hn = frame('RangeIter.hasNext', {}, () => 'RangeIter.hasNext()');
    const lowHas = low.leaf !== null;
    S(LN.riHn1, {tag: 'Compare', inline: `low.hasNext() → ${py(lowHas)}${lowHas ? '' : ' → return False'}`, helper: ['itHasNext'], kv: {},
      note: lowHas ? `<code>low.leaf</code> is ${esc(leafTxt(low.leaf))}, so the tree has not run out.` : `<code>low</code> ran off the end of the tree. Return <code>False</code>.`});
    let ok = false;
    if (lowHas) {
      const highHas = high.leaf !== null;
      const a = low.leaf.content, b = highHas ? high.leaf.content : '';
      let k = 0; while (highHas && k < a.length && k < b.length && a[k] === b[k]) k++;
      const lt = highHas ? a < b : true; ok = !highHas || lt;
      S(LN.riHn2, {tag: 'Compare', helper: ['itHasNext'], kv: highHas ? {key: a, keyLabel: 'low.leaf', row2: {label: 'high.leaf', s: b}, match: [0, k], miss: k < Math.min(a.length, b.length) ? k : null} : {},
        inline: highHas ? `high.hasNext() → True · ${q(a)} < ${q(b)} → ${py(lt)}` : 'high.hasNext() → False → return True',
        note: highHas ? `The end is a leaf, so compare the two full keys. They agree up to index ${k}; ${lt ? `<code>${esc(q(a))}</code> sorts first, so low has not reached the end yet.` : `<code>low</code> has reached the end leaf, so the scan is finished.`}`
                      : `There is no end leaf, so every remaining leaf is in range.`});
    }
    frames.pop();
    if (!ok) { S(LN.rsWhile, {tag: 'Scan', inline: 'it.hasNext() → False', kv: {}, note: `hasNext returned <code>False</code>: leave the loop.`}); break; }
    S(LN.rsApp, {tag: 'Scan', inline: 'out.append(it.next())', kv: {}, note: `hasNext said yes. Take the word, then move on.`});
    frame('RangeIter.next', {}, () => 'RangeIter.next()');
    S(LN.riNext, {tag: 'Scan', inline: 'return self.low.next()', kv: {}, note: `The range iterator just forwards to the start iterator.`});
    const it = frame('ARTIterator.next', {}, () => 'ARTIterator.next()');
    const leaf = low.leaf, word = leaf.content.slice(0, -1); it.v.word = q(word);
    S(LN.inNext1, {tag: 'Emit', inline: `word = ${q(word)}`, kv: {}, note: `Read the word from the current leaf and drop the trailing TERM.`});
    S(LN.inNext2, {tag: 'Climb', inline: '_next()', kv: {}, note: `Before returning, move <code>low</code> to the next leaf. This is where a B+ tree would follow a sibling pointer. ART has none, so it climbs and descends.`});
    const before = moves;
    low.leaf = nextFn(low);
    S(LN.inNext2, {tag: 'Climb', inline: `leaf = ${leafTxt(low.leaf)}`, kv: {}, fresh: low.leaf ? [low.leaf.id] : [], cur: low.leaf ? low.leaf.id : null,
      note: `That took ${moves - before} node move${moves - before === 1 ? '' : 's'} (stack pops and descents). The next leaf is ${esc(leafTxt(low.leaf))}.`});
    S(LN.inNext3, {tag: 'Emit', inline: `return ${q(word)}`, kv: {}, note: `Return the word.`});
    frames.pop(); frames.pop();
    out.push({id: leaf.id, w: word});
    S(LN.rsApp, {tag: 'Emit', inline: `out = ${fk(out.map(x => x.w))}`, kv: {}, cur: leaf.id, note: `<code>${esc(q(word))}</code> is appended. ${out.length} word${out.length === 1 ? '' : 's'} so far.`});
  }
  S(LN.rsRet, {tag: 'Done', done: true, kv: {}, cur: null, inline: `return ${fk(out.map(x => x.w))}`,
    note: `${out.length ? `The scan returned ${out.length} word${out.length === 1 ? '' : 's'} in sorted order.` : 'The range is empty.'} Walking cost ${moves} node move${moves === 1 ? '' : 's'} (stack pops and descents) after the two seeks. A B+ tree would hop one sibling pointer per leaf; ART traverses instead, but its nodes are small and sorted.`});
  return {steps, words: out.map(x => x.w)};
}
