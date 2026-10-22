# art-viz

Step through `insert`, `search` and range scans (`ARTIterator` / `RangeIter`) in an Adaptive Radix Tree, one executed line at a time.
Live at https://lamng3.com/art-visualization/

The page shows the Python source with the current line highlighted and its result written inline,
the key bytes with the `depth` pointer, the tree (Node4/16/48/256, path compression, lazy expansion),
detached nodes, locals and the call stack. `art.js` holds the Python source and a traced JS port of it;
`app.js` draws it. No build step: open `index.html` through any static server.

```sh
python3 -m http.server   # then open http://localhost:8000
node test.mjs            # line numbers; search and range scan agree with a Set / sorted array on random inputs
```

Persistence and erase are next.
