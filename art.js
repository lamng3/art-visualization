/* ART engine: the Python source shown on the page, and a traced JS port of it.
   Every executed line of insert/_insert and search/_search records one snapshot (a "step"). */

export const PY = String.raw`TERM = "\0" # ends every key, so no key is a prefix of another
SIZES = (4, 16, 48, 256)

class TrieNode:
    def __init__(self, size: int = 4, content: str = "", end: bool = False, children: dict = None):
        self.size = size
        self.content = content
        self.children = {} if children is None else children
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

    def replace(self, node: TrieNode, new: TrieNode) -> None:
        """node becomes new, in place, so its parent needs no update"""
        node.size, node.content, node.children, node.end = new.size, new.content, new.children, new.end

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
        return self._search(self.findChild(node, c), key, depth + 1)`;

export const SRC = PY.split('\n');
export const RANGE = {insert: [54, 87], search: [89, 100]};
export const HELP = {TrieNode: [5, 9], isLeaf: [15, 17], loadKey: [19, 21], leafMatches: [23, 25], checkPrefix: [27, 32], findChild: [34, 36], isFull: [38, 40], grow: [42, 44], addChild: [46, 48], replace: [50, 52]};

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
      op: 'insert', line, word, wi, tree, scratch, uid: top.uid,
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
      op: 'search', line, word, wi, tree, scratch: [], uid: top.uid,
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
