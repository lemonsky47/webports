/**
 * Bootstrap: load chunks.json, fetch WASM chunks if needed, then load renpy.js.
 * This defers renpy.js until Module.wasmBinary is set (when using chunked WASM).
 */
(function () {
    const CHUNK_SIZE = 20866662;  // 19.9 MB

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
        });
    }

    async function bootstrap() {
        try {
            const manifestRes = await fetch('chunks.json');
            if (manifestRes.ok) {
                window.chunksManifest = await manifestRes.json();
            }
        } catch (e) {
            console.log('No chunks.json, using single-file mode');
        }

        const manifest = window.chunksManifest;
        if (manifest && manifest.renpy) {
            const chunkCount = manifest.renpy;
            if (typeof Module !== 'undefined' && Module.print) {
                Module.print('');
                Module.print('Downloading engine...');
            }
            const progressFn = window.progress;
            if (typeof progressFn === 'function') {
                progressFn(0, chunkCount * CHUNK_SIZE);
            }
            const chunks = [];
            let totalDownloaded = 0;
            for (let i = 0; i < chunkCount; i++) {
                const url = 'renpy.chunk' + i;
                const r = await fetch(url);
                if (!r.ok) throw new Error('Failed to fetch ' + url + ': ' + r.status);
                const ab = await r.arrayBuffer();
                chunks.push(new Uint8Array(ab));
                totalDownloaded += ab.byteLength;
                if (typeof progressFn === 'function') {
                    progressFn(totalDownloaded, Math.max(totalDownloaded, chunkCount * CHUNK_SIZE));
                }
            }
            const total = chunks.reduce((s, c) => s + c.length, 0);
            const combined = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) {
                combined.set(c, offset);
                offset += c.length;
            }
            Module.wasmBinary = combined.buffer;
        }

        await loadScript('renpy.js');
    }

    bootstrap().catch(function (e) {
        console.error('Bootstrap failed:', e);
        if (typeof reportError === 'function') {
            reportError('Failed to load game: ' + e.message, e);
        } else {
            document.body.innerHTML = '<pre style="color:red">Failed to load: ' + e.message + '</pre>';
        }
    });
})();
