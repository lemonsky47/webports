/**
 * godot-chunk-loader.js
 * Fetches, reassembles, decompresses, and serves chunked Godot game files.
 * Requires pako to be loaded on the page before this script runs.
 *
 * Caching: each downloaded chunk is stored individually in IndexedDB so the
 * browser's per-value size limit is never exceeded.
 */
(function (global) {
  "use strict";

  const DB_NAME    = "GodotChunkCache_OutholdExport";
  const STORE_NAME = "chunks";
  const NO_CACHE   = false;

  // ── IndexedDB helpers ──────────────────────────────────────────────────────

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  function dbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction([STORE_NAME], "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onerror  = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  }

  function dbPut(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction([STORE_NAME], "readwrite");
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onerror  = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  }

  // ── Chunk fetching ─────────────────────────────────────────────────────────

  async function getChunkNames(filename) {
    try {
      const res = await fetch("chunks_manifest.json");
      if (res.ok) {
        const manifest = await res.json();
        const names = (manifest.chunks || [])
          .map((c) => c.name)
          .filter((n) => n.startsWith(filename));
        if (names.length > 0) return names;
      }
    } catch (_) {}

    // Probe fallback
    const names = [];
    for (let i = 0; ; i++) {
      const name = `${filename}.part${String(i).padStart(3, "0")}`;
      const res  = await fetch(name, { method: "HEAD" });
      if (!res.ok) { if (i === 0) throw new Error(`No chunks found for ${filename}`); break; }
      names.push(name);
    }
    return names;
  }

  async function fetchChunks(filename, chunkNames, db, onStatus) {
    const chunks = [];
    for (let i = 0; i < chunkNames.length; i++) {
      const name   = chunkNames[i];
      const cacheKey = `${filename}::${name}`;

      onStatus(`Downloading ${name}…`, i, chunkNames.length);

      let buf = null;
      if (db) {
        try { buf = await dbGet(db, cacheKey); } catch (_) {}
      }

      if (buf) {
        onStatus(`Loaded ${name} from cache`, i + 1, chunkNames.length);
      } else {
        const res = await fetch(name);
        if (!res.ok) throw new Error(`Failed to fetch ${name}`);
        buf = await res.arrayBuffer();
        if (db) {
          try { await dbPut(db, cacheKey, buf); } catch (e) {
            console.warn(`[ChunkLoader] Could not cache ${name}:`, e);
          }
        }
      }
      chunks.push(buf);
    }
    return chunks;
  }

  // ── Reassemble + decompress ────────────────────────────────────────────────

  async function reassemble(chunks, filename, onStatus) {
    onStatus(`Reassembling ${filename}…`, 0, 1);
    const total    = chunks.reduce((n, c) => n + c.byteLength, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    onStatus(`Decompressing ${filename}…`, 0, 1);
    try {
      const decompressed = pako.inflate(combined, { to: "buffer", onData: function () {} });
      console.log(`[ChunkLoader] Decompressed ${filename}: ${decompressed.byteLength} bytes`);
      return decompressed.buffer;
    } catch (_) {
      console.log(`[ChunkLoader] ${filename} is not compressed — using raw data`);
      return combined.buffer;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async function checkAndUnpack(filename, onStatus) {
    // If the full file exists on the server, nothing to do
    try {
      const res = await fetch(filename, { method: "HEAD" });
      if (res.ok) {
        onStatus(`${filename} found on server — no unpacking needed.`, 1, 1);
        return null;
      }
    } catch (_) {}

    const db         = NO_CACHE ? null : await openDB();
    const chunkNames = await getChunkNames(filename);
    const chunks     = await fetchChunks(filename, chunkNames, db, onStatus);
    return await reassemble(chunks, filename, onStatus);
  }

  global.GodotChunkLoader = { checkAndUnpack };
})(window);
