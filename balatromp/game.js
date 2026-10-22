var Module;

// DEBUG MODE FLAG
const DEBUG_MODE = false;
let a = () => {
  DEBUG_MODE ? console.log('Debug mode enabled!') : null;
};
a();

// silly funny progress bar
function asciiProgressBar(current, total, length = 30) {
  if (total === 0) {
    return '[Error: total is zero]';
  }
  const proportion = current / total;
  const filledLength = Math.round(length * proportion);
  const bar = '#'.repeat(filledLength) + '-'.repeat(length - filledLength);
  const percent = (proportion * 100).toFixed(1);
  return `[${bar}] ${percent}%`;
}

if (typeof Module === 'undefined')
  Module = eval(
    '(function() { try { return Module || {} } catch(e) { return {} } })()',
  );

if (!Module.expectedDataFileDownloads) {
  Module.expectedDataFileDownloads = 0;
  // Module.finishedDataFileDownloads = 0;
}
Module.expectedDataFileDownloads++;
(function() {
  var loadPackage = function(metadata) {
    var PACKAGE_PATH;
    if (typeof window === 'object') {
      PACKAGE_PATH = window['encodeURIComponent'](
        window.location.pathname
        .toString()
        .substring(0, window.location.pathname.toString().lastIndexOf('/')) +
        '/',
      );
    } else if (typeof location !== 'undefined') {
      // worker
      PACKAGE_PATH = encodeURIComponent(
        location.pathname
        .toString()
        .substring(0, location.pathname.toString().lastIndexOf('/')) + '/',
      );
    } else {
      throw 'using preloaded data can only be done on a web page or in a web worker';
    }
    var PACKAGE_NAME = 'game.data';
    var REMOTE_PACKAGE_BASE = 'game.data';
    if (
      typeof Module['locateFilePackage'] === 'function' &&
      !Module['locateFile']
    ) {
      Module['locateFile'] = Module['locateFilePackage'];
      Module.printErr(
        'warning: you defined Module.locateFilePackage, that has been renamed to Module.locateFile (using your locateFilePackage for now)',
      );
    }

    // Always load from local chunked data files
    var CHUNK_SIZE = 19000000;
    var TOTAL_CHUNKS = 6; // game.data.000 through game.data.005
    var REMOTE_PACKAGE_SIZE = metadata.remote_package_size;
    var PACKAGE_UUID = metadata.package_uuid;

    var MAX_CHUNK_RETRIES = 3;

    function chunkLength(i, packageSize) {
      return Math.min(CHUNK_SIZE, packageSize - CHUNK_SIZE * i);
    }

    // Downloads every chunk straight into one preallocated buffer, so the package is only held in memory once
    // (low-memory devices such as Chromebooks could not afford chunks + combined copy + heap copy + IDB copy).
    function fetchRemotePackage(packageName, packageSize, callback, errback) {
      if (!Module.dataFileDownloads) Module.dataFileDownloads = {};

      var combined;
      try {
        combined = new Uint8Array(packageSize);
      } catch (e) {
        return errback(new Error('Not enough memory to hold game data (' + packageSize + ' bytes): ' + e));
      }
      var chunksLoaded = 0;
      var failed = false;
      var chunkProgress = new Array(TOTAL_CHUNKS).fill(0);

      function updateProgress() {
        var loaded = 0;
        for (var i = 0; i < TOTAL_CHUNKS; i++) loaded += chunkProgress[i];
        Module.dataFileDownloads['game.data'] = { loaded: loaded, total: packageSize };
        if (Module['setStatus'])
          Module['setStatus'](
            `Downloading data... ${asciiProgressBar(loaded, packageSize, 50)} (${loaded}B/${packageSize}B)`,
          );
      }

      function fail(error) {
        if (failed) return;
        failed = true;
        errback(error);
      }

      function loadChunk(chunkIndex, attempt) {
        // The uuid query makes sure the browser HTTP cache never serves a chunk from an older build
        var chunkName = './data/game.data.' + String(chunkIndex).padStart(3, '0') + '?v=' + PACKAGE_UUID;
        var expected = chunkLength(chunkIndex, packageSize);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', chunkName, true);
        xhr.responseType = 'arraybuffer';

        function retryOrFail(reason) {
          if (failed) return;
          chunkProgress[chunkIndex] = 0;
          if (attempt < MAX_CHUNK_RETRIES) {
            console.warn('Retrying ' + chunkName + ' (' + reason + ')');
            setTimeout(function() { loadChunk(chunkIndex, attempt + 1); }, 1000 * attempt);
          } else {
            fail(new Error('Failed to download ' + chunkName + ': ' + reason));
          }
        }

        xhr.onprogress = function(event) {
          if (event.loaded) {
            chunkProgress[chunkIndex] = event.loaded;
            updateProgress();
          }
        };
        xhr.onerror = function() { retryOrFail('network error'); };
        xhr.ontimeout = function() { retryOrFail('timed out'); };
        xhr.onload = function() {
          if (failed) return;
          var ok = xhr.status == 200 || xhr.status == 304 || xhr.status == 206 || (xhr.status == 0 && xhr.response);
          if (!ok) return retryOrFail('HTTP ' + xhr.status + ' ' + xhr.statusText);
          if (xhr.response.byteLength !== expected)
            return retryOrFail('expected ' + expected + ' bytes, got ' + xhr.response.byteLength);
          combined.set(new Uint8Array(xhr.response), CHUNK_SIZE * chunkIndex);
          chunkProgress[chunkIndex] = expected;
          chunksLoaded++;
          updateProgress();
          if (chunksLoaded === TOTAL_CHUNKS) callback(combined);
        };
        xhr.send(null);
      }

      if (CHUNK_SIZE * (TOTAL_CHUNKS - 1) >= packageSize || CHUNK_SIZE * TOTAL_CHUNKS < packageSize)
        return errback(new Error('game.js chunk layout does not match package size ' + packageSize));
      for (var c = 0; c < TOTAL_CHUNKS; c++) loadChunk(c, 1);
    }

    function handleError(error) {
      console.error('package error:', error);
      if (Module['setStatus']) Module['setStatus']('Failed to load game data: ' + error + ' (try the reset button in the corner)');
    }

    function runWithFS() {
      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
      var files = metadata.files;
      var createdDirs = {};

      for (var i = 0; i < files.length; ++i) {
          var path = files[i].filename;

          var parts = path.split('/');
          parts.pop();
          var dirStr = parts.filter(Boolean).join('/');

          if (dirStr !== '' && !createdDirs[dirStr]) {
              Module['FS_createPath']('/', dirStr, true, true);
              createdDirs[dirStr] = true;
          }
      }

      function DataRequest(start, end, crunched, audio) {
        this.start = start;
        this.end = end;
        this.crunched = crunched;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          this.requests[name] = this;
          Module['addRunDependency']('fp ' + this.name);
        },
        send: function() {},
        onload: function() {
          var byteArray = this.byteArray.subarray(this.start, this.end);

          this.finish(byteArray);
        },
        finish: function(byteArray) {
          var that = this;

          Module['FS_createDataFile'](
            this.name,
            null,
            byteArray,
            true,
            true,
            true,
          ); // canOwn: the file is a view into the package buffer, which is never modified
          Module['removeRunDependency']('fp ' + that.name);

          this.requests[this.name] = null;
        },
      };

      var files = metadata.files;
      for (i = 0; i < files.length; ++i) {
        new DataRequest(
          files[i].start,
          files[i].end,
          files[i].crunched,
          files[i].audio,
        ).open('GET', files[i].filename);
      }

      var indexedDB =
        window.indexedDB ||
        window.mozIndexedDB ||
        window.webkitIndexedDB ||
        window.msIndexedDB;
      var IDB_RO = 'readonly';
      var IDB_RW = 'readwrite';
      var DB_NAME = 'EM_PRELOAD_CACHE';
      var DB_VERSION = 2; // v2 stores the package as separate chunks; upgrading drops the old single-blob cache
      var METADATA_STORE_NAME = 'METADATA';
      var PACKAGE_STORE_NAME = 'PACKAGES';

      // IndexedDB can hang without ever firing success/error (blocked upgrades, restricted profiles),
      // so every cache step is raced against a timeout and only the first outcome counts.
      function once(callback, errback, label, timeoutMs) {
        var done = false;
        var timer = setTimeout(function() {
          if (done) return;
          done = true;
          errback(new Error('IndexedDB ' + label + ' timed out'));
        }, timeoutMs);
        function wrap(fn) {
          return function(value) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            fn(value);
          };
        }
        return { ok: wrap(callback), fail: wrap(errback) };
      }

      function openDatabase(callback, errback) {
        var cb = once(callback, errback, 'open', 10000);
        try {
          var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
          return cb.fail(e);
        }
        openRequest.onupgradeneeded = function(event) {
          var db = event.target.result;

          if (db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
            db.deleteObjectStore(PACKAGE_STORE_NAME);
          }
          db.createObjectStore(PACKAGE_STORE_NAME);

          if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
            db.deleteObjectStore(METADATA_STORE_NAME);
          }
          db.createObjectStore(METADATA_STORE_NAME);
        };
        openRequest.onsuccess = function(event) {
          var db = event.target.result;
          // Let other tabs (or the reset button) delete/upgrade the database instead of being blocked by us
          db.onversionchange = function() { db.close(); };
          cb.ok(db);
        };
        openRequest.onerror = function(event) {
          cb.fail(openRequest.error || event);
        };
        openRequest.onblocked = function() {
          cb.fail(new Error('IndexedDB open blocked by another tab'));
        };
      }

      /* Loads the cached package if it exists, is complete and matches this build; otherwise calls callback(null) */
      function fetchCachedPackage(db, packageName, callback, errback) {
        var cb = once(callback, errback, 'read', 60000); // reading ~140MB can be slow on weak devices
        try {
          var transaction = db.transaction([METADATA_STORE_NAME, PACKAGE_STORE_NAME], IDB_RO);
        } catch (e) {
          return cb.fail(e);
        }
        transaction.onabort = function() { cb.fail(transaction.error || new Error('cache read aborted')); };

        var metaRequest = transaction.objectStore(METADATA_STORE_NAME).get('metadata/' + packageName);
        metaRequest.onerror = function() { cb.fail(metaRequest.error); };
        metaRequest.onsuccess = function() {
          var meta = metaRequest.result;
          if (!meta || meta.uuid !== PACKAGE_UUID || meta.chunks !== TOTAL_CHUNKS) return cb.ok(null);

          var packages = transaction.objectStore(PACKAGE_STORE_NAME);
          var combined;
          try {
            combined = new Uint8Array(REMOTE_PACKAGE_SIZE);
          } catch (e) {
            return cb.fail(e);
          }
          var remaining = TOTAL_CHUNKS;
          var missing = false;
          for (var c = 0; c < TOTAL_CHUNKS; c++) {
            (function(chunkIndex) {
              var getRequest = packages.get('package/' + packageName + '/' + chunkIndex);
              getRequest.onerror = function() { cb.fail(getRequest.error); };
              getRequest.onsuccess = function() {
                var value = getRequest.result;
                if (value instanceof ArrayBuffer) value = new Uint8Array(value);
                if (!value || value.byteLength !== chunkLength(chunkIndex, REMOTE_PACKAGE_SIZE)) {
                  missing = true;
                } else {
                  combined.set(value, CHUNK_SIZE * chunkIndex);
                }
                if (--remaining === 0) cb.ok(missing ? null : combined);
              };
            })(c);
          }
        };
      }

      /* Writes the package one chunk per transaction (small writes are far more reliable than one huge one), metadata last */
      function cacheRemotePackage(db, packageName, byteArray) {
        function writeChunk(chunkIndex) {
          if (chunkIndex === TOTAL_CHUNKS) {
            var metaTx = db.transaction([METADATA_STORE_NAME], IDB_RW);
            metaTx.objectStore(METADATA_STORE_NAME).put({ uuid: PACKAGE_UUID, chunks: TOTAL_CHUNKS }, 'metadata/' + packageName);
            metaTx.oncomplete = function() { console.info('cached ' + PACKAGE_NAME + ' in IndexedDB'); };
            metaTx.onabort = function() { console.warn('could not cache ' + PACKAGE_NAME + ':', metaTx.error); };
            return;
          }
          var start = CHUNK_SIZE * chunkIndex;
          var tx = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
          // slice() copies just this chunk; cloning a subarray would serialize the whole package buffer
          tx.objectStore(PACKAGE_STORE_NAME).put(
            byteArray.slice(start, start + chunkLength(chunkIndex, REMOTE_PACKAGE_SIZE)),
            'package/' + packageName + '/' + chunkIndex,
          );
          tx.oncomplete = function() { writeChunk(chunkIndex + 1); };
          tx.onabort = function() { console.warn('could not cache ' + PACKAGE_NAME + ' (chunk ' + chunkIndex + '):', tx.error); };
        }

        try {
          // Invalidate first so a half-written cache is never mistaken for a complete one
          var clearTx = db.transaction([METADATA_STORE_NAME], IDB_RW);
          clearTx.objectStore(METADATA_STORE_NAME).delete('metadata/' + packageName);
          clearTx.oncomplete = function() { writeChunk(0); };
          clearTx.onabort = function() { console.warn('could not cache ' + PACKAGE_NAME + ':', clearTx.error); };
        } catch (e) {
          console.warn('could not cache ' + PACKAGE_NAME + ':', e);
        }
      }

      var packageProcessed = false;
      function processPackageData(byteArray) {
        if (packageProcessed) return;
        packageProcessed = true;
        try {
          installPackage(byteArray);
        } catch (e) {
          handleError(e);
        }
      }

      function installPackage(byteArray) {
        Module.finishedDataFileDownloads++;
        assert(byteArray instanceof Uint8Array, 'bad input to processPackageData');
        assert(byteArray.length === REMOTE_PACKAGE_SIZE, 'Loading data file failed: wrong size');

        // Files are views into this JS buffer rather than a copy in the wasm heap (emscripten's --no-heap-copy).
        // Besides saving ~140MB of heap, heap views would be detached (files read back empty) whenever the heap grows.
        DataRequest.prototype.byteArray = byteArray;

        var files = metadata.files;
        for (i = 0; i < files.length; ++i) {
          DataRequest.prototype.requests[files[i].filename].onload();
        }
        Module['removeRunDependency']('datafile_game.data');
      }
      Module['addRunDependency']('datafile_game.data');

      if (!Module.preloadResults) Module.preloadResults = {};

      function loadRemote(db) {
        console.info('loading ' + PACKAGE_NAME + ' from remote');
        fetchRemotePackage(
          PACKAGE_NAME,
          REMOTE_PACKAGE_SIZE,
          function(byteArray) {
            processPackageData(byteArray);
            // Cache in the background; the game does not wait for (or depend on) this succeeding
            if (db && !DEBUG_MODE) cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, byteArray);
          },
          handleError,
        );
      }

      function preloadFallback(error) {
        console.error(error);
        console.error('falling back to default preload behavior');
        loadRemote(null);
      }

      openDatabase(function(db) {
        if (DEBUG_MODE) return loadRemote(db); // disabled cached stuff when in debug mode
        fetchCachedPackage(
          db,
          PACKAGE_PATH + PACKAGE_NAME,
          function(byteArray) {
            Module.preloadResults[PACKAGE_NAME] = { fromCache: !!byteArray };
            if (!byteArray) return loadRemote(db);
            console.info('loading ' + PACKAGE_NAME + ' from cache');
            processPackageData(byteArray);
          },
          function(error) {
            console.error(error);
            loadRemote(db);
          },
        );
      }, preloadFallback);

      if (Module['setStatus']) Module['setStatus']('Downloading...');
    }
    if (Module['calledRun']) {
      runWithFS();
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module['preRun'].push(runWithFS); // FS is not initialized yet, wait for it
    }
  };
  // ignore placeholder (and error) its needed so that it doesnt crash after updating the lua code (gets replaced by setup_loadPackage.py in build.sh)
  loadPackage({
    "package_uuid": "5555b386-07b4-4982-8aee-929677e113d0",
    "remote_package_size": 111313256,
    "files": [
        {
            "filename": "/back.lua",
            "crunched": 0,
            "start": 0,
            "end": 12555,
            "audio": false
        },
        {
            "filename": "/balatro_main.lua",
            "crunched": 0,
            "start": 12555,
            "end": 24030,
            "audio": false
        },
        {
            "filename": "/bit.lua",
            "crunched": 0,
            "start": 24030,
            "end": 25552,
            "audio": false
        },
        {
            "filename": "/blind.lua",
            "crunched": 0,
            "start": 25552,
            "end": 53086,
            "audio": false
        },
        {
            "filename": "/card_character.lua",
            "crunched": 0,
            "start": 53086,
            "end": 58444,
            "audio": false
        },
        {
            "filename": "/card.lua",
            "crunched": 0,
            "start": 58444,
            "end": 300995,
            "audio": false
        },
        {
            "filename": "/cardarea.lua",
            "crunched": 0,
            "start": 300995,
            "end": 333077,
            "audio": false
        },
        {
            "filename": "/challenges.lua",
            "crunched": 0,
            "start": 333077,
            "end": 357009,
            "audio": false
        },
        {
            "filename": "/conf.lua",
            "crunched": 0,
            "start": 357009,
            "end": 357219,
            "audio": false
        },
        {
            "filename": "/engine/animatedsprite.lua",
            "crunched": 0,
            "start": 357219,
            "end": 360491,
            "audio": false
        },
        {
            "filename": "/engine/controller.lua",
            "crunched": 0,
            "start": 360491,
            "end": 421145,
            "audio": false
        },
        {
            "filename": "/engine/event.lua",
            "crunched": 0,
            "start": 421145,
            "end": 428179,
            "audio": false
        },
        {
            "filename": "/engine/http_manager.lua",
            "crunched": 0,
            "start": 428179,
            "end": 428849,
            "audio": false
        },
        {
            "filename": "/engine/moveable.lua",
            "crunched": 0,
            "start": 428849,
            "end": 449380,
            "audio": false
        },
        {
            "filename": "/engine/node.lua",
            "crunched": 0,
            "start": 449380,
            "end": 465097,
            "audio": false
        },
        {
            "filename": "/engine/object.lua",
            "crunched": 0,
            "start": 465097,
            "end": 465763,
            "audio": false
        },
        {
            "filename": "/engine/particles.lua",
            "crunched": 0,
            "start": 465763,
            "end": 472358,
            "audio": false
        },
        {
            "filename": "/engine/profile.lua",
            "crunched": 0,
            "start": 472358,
            "end": 476931,
            "audio": false
        },
        {
            "filename": "/engine/save_manager.lua",
            "crunched": 0,
            "start": 476931,
            "end": 480725,
            "audio": false
        },
        {
            "filename": "/engine/sound_manager.lua",
            "crunched": 0,
            "start": 480725,
            "end": 487514,
            "audio": false
        },
        {
            "filename": "/engine/sprite.lua",
            "crunched": 0,
            "start": 487514,
            "end": 495480,
            "audio": false
        },
        {
            "filename": "/engine/string_packer.lua",
            "crunched": 0,
            "start": 495480,
            "end": 498260,
            "audio": false
        },
        {
            "filename": "/engine/text.lua",
            "crunched": 0,
            "start": 498260,
            "end": 513216,
            "audio": false
        },
        {
            "filename": "/engine/ui.lua",
            "crunched": 0,
            "start": 513216,
            "end": 558513,
            "audio": false
        },
        {
            "filename": "/functions/button_callbacks.lua",
            "crunched": 0,
            "start": 558513,
            "end": 675916,
            "audio": false
        },
        {
            "filename": "/functions/common_events.lua",
            "crunched": 0,
            "start": 675916,
            "end": 806574,
            "audio": false
        },
        {
            "filename": "/functions/misc_functions.lua",
            "crunched": 0,
            "start": 806574,
            "end": 879850,
            "audio": false
        },
        {
            "filename": "/functions/state_events.lua",
            "crunched": 0,
            "start": 879850,
            "end": 955812,
            "audio": false
        },
        {
            "filename": "/functions/test_functions.lua",
            "crunched": 0,
            "start": 955812,
            "end": 963961,
            "audio": false
        },
        {
            "filename": "/functions/UI_definitions.lua",
            "crunched": 0,
            "start": 963961,
            "end": 1313784,
            "audio": false
        },
        {
            "filename": "/game.lua",
            "crunched": 0,
            "start": 1313784,
            "end": 1550773,
            "audio": false
        },
        {
            "filename": "/globals.lua",
            "crunched": 0,
            "start": 1550773,
            "end": 1566982,
            "audio": false
        },
        {
            "filename": "/json.lua",
            "crunched": 0,
            "start": 1566982,
            "end": 1576619,
            "audio": false
        },
        {
            "filename": "/localization/de.lua",
            "crunched": 0,
            "start": 1576619,
            "end": 1731300,
            "audio": false
        },
        {
            "filename": "/localization/en-us.lua",
            "crunched": 0,
            "start": 1731300,
            "end": 1877986,
            "audio": false
        },
        {
            "filename": "/localization/es_419.lua",
            "crunched": 0,
            "start": 1877986,
            "end": 2031548,
            "audio": false
        },
        {
            "filename": "/localization/es_ES.lua",
            "crunched": 0,
            "start": 2031548,
            "end": 2185218,
            "audio": false
        },
        {
            "filename": "/localization/fr.lua",
            "crunched": 0,
            "start": 2185218,
            "end": 2342768,
            "audio": false
        },
        {
            "filename": "/localization/id.lua",
            "crunched": 0,
            "start": 2342768,
            "end": 2494425,
            "audio": false
        },
        {
            "filename": "/localization/it.lua",
            "crunched": 0,
            "start": 2494425,
            "end": 2646291,
            "audio": false
        },
        {
            "filename": "/localization/ja.lua",
            "crunched": 0,
            "start": 2646291,
            "end": 2814688,
            "audio": false
        },
        {
            "filename": "/localization/ko.lua",
            "crunched": 0,
            "start": 2814688,
            "end": 2974761,
            "audio": false
        },
        {
            "filename": "/localization/nl.lua",
            "crunched": 0,
            "start": 2974761,
            "end": 3127532,
            "audio": false
        },
        {
            "filename": "/localization/pl.lua",
            "crunched": 0,
            "start": 3127532,
            "end": 3282418,
            "audio": false
        },
        {
            "filename": "/localization/pt_BR.lua",
            "crunched": 0,
            "start": 3282418,
            "end": 3435800,
            "audio": false
        },
        {
            "filename": "/localization/ru.lua",
            "crunched": 0,
            "start": 3435800,
            "end": 3617671,
            "audio": false
        },
        {
            "filename": "/localization/zh_CN.lua",
            "crunched": 0,
            "start": 3617671,
            "end": 3765078,
            "audio": false
        },
        {
            "filename": "/localization/zh_TW.lua",
            "crunched": 0,
            "start": 3765078,
            "end": 3912120,
            "audio": false
        },
        {
            "filename": "/lovely_patches.lua",
            "crunched": 0,
            "start": 3912120,
            "end": 5556973,
            "audio": false
        },
        {
            "filename": "/lovely.lua",
            "crunched": 0,
            "start": 5556973,
            "end": 5589152,
            "audio": false
        },
        {
            "filename": "/main.lua",
            "crunched": 0,
            "start": 5589152,
            "end": 5589225,
            "audio": false
        },
        {
            "filename": "/manifest.json",
            "crunched": 0,
            "start": 5589225,
            "end": 5683578,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/1x/icon.png",
            "crunched": 0,
            "start": 5683578,
            "end": 5684424,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/2x/icon.png",
            "crunched": 0,
            "start": 5684424,
            "end": 5685457,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/e.ogg",
            "crunched": 0,
            "start": 5685457,
            "end": 5783411,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/ee.ogg",
            "crunched": 0,
            "start": 5783411,
            "end": 5929807,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/eee.ogg",
            "crunched": 0,
            "start": 5929807,
            "end": 6124657,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/e.ogg",
            "crunched": 0,
            "start": 6124657,
            "end": 6166406,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/ee.ogg",
            "crunched": 0,
            "start": 6166406,
            "end": 6252707,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/eee.ogg",
            "crunched": 0,
            "start": 6252707,
            "end": 6419578,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/x.ogg",
            "crunched": 0,
            "start": 6419578,
            "end": 6444606,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/e.ogg",
            "crunched": 0,
            "start": 6444606,
            "end": 6488014,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/ee.ogg",
            "crunched": 0,
            "start": 6488014,
            "end": 6531532,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/eee.ogg",
            "crunched": 0,
            "start": 6531532,
            "end": 6597753,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/constants.lua",
            "crunched": 0,
            "start": 6597753,
            "end": 6598576,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations.lua",
            "crunched": 0,
            "start": 6598576,
            "end": 6598731,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/arraynotation.lua",
            "crunched": 0,
            "start": 6598731,
            "end": 6600011,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/Balatro.lua",
            "crunched": 0,
            "start": 6600011,
            "end": 6603272,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/notation.lua",
            "crunched": 0,
            "start": 6603272,
            "end": 6604341,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/omeganum.lua",
            "crunched": 0,
            "start": 6604341,
            "end": 6644752,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/icon.png",
            "crunched": 0,
            "start": 6644752,
            "end": 6647096,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/LICENSE",
            "crunched": 0,
            "start": 6647096,
            "end": 6682245,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely.toml",
            "crunched": 0,
            "start": 6682245,
            "end": 6684421,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/anims.toml",
            "crunched": 0,
            "start": 6684421,
            "end": 6686051,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/card.toml",
            "crunched": 0,
            "start": 6686051,
            "end": 6687119,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/fixes.toml",
            "crunched": 0,
            "start": 6687119,
            "end": 6695101,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/gradients.toml",
            "crunched": 0,
            "start": 6695101,
            "end": 6695469,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/noanims.toml",
            "crunched": 0,
            "start": 6695469,
            "end": 6699201,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/numfmt.toml",
            "crunched": 0,
            "start": 6699201,
            "end": 6701990,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/save.toml",
            "crunched": 0,
            "start": 6701990,
            "end": 6704531,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/scoring.toml",
            "crunched": 0,
            "start": 6704531,
            "end": 6708216,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/talisman-detection-after.toml",
            "crunched": 0,
            "start": 6708216,
            "end": 6709088,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/talisman-detection.toml",
            "crunched": 0,
            "start": 6709088,
            "end": 6709368,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/typefix.toml",
            "crunched": 0,
            "start": 6709368,
            "end": 6711709,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/valid.toml",
            "crunched": 0,
            "start": 6711709,
            "end": 6711904,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/valid.txt",
            "crunched": 0,
            "start": 6711904,
            "end": 6711930,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/manifest.json",
            "crunched": 0,
            "start": 6711930,
            "end": 6712186,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/README.md",
            "crunched": 0,
            "start": 6712186,
            "end": 6714065,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/smods.json",
            "crunched": 0,
            "start": 6714065,
            "end": 6714522,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/smods.lua",
            "crunched": 0,
            "start": 6714522,
            "end": 6718256,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman.lua",
            "crunched": 0,
            "start": 6718256,
            "end": 6719196,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf.lua",
            "crunched": 0,
            "start": 6719196,
            "end": 6726038,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/globals.lua",
            "crunched": 0,
            "start": 6726038,
            "end": 6726704,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/math.lua",
            "crunched": 0,
            "start": 6726704,
            "end": 6728492,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/sanitizer.lua",
            "crunched": 0,
            "start": 6728492,
            "end": 6730807,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/configinit.lua",
            "crunched": 0,
            "start": 6730807,
            "end": 6733580,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/configtab.lua",
            "crunched": 0,
            "start": 6733580,
            "end": 6741952,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/coroutine.lua",
            "crunched": 0,
            "start": 6741952,
            "end": 6750703,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/debug.lua",
            "crunched": 0,
            "start": 6750703,
            "end": 6751255,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/effects.lua",
            "crunched": 0,
            "start": 6751255,
            "end": 6761273,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/globals.lua",
            "crunched": 0,
            "start": 6761273,
            "end": 6762801,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/gradients.lua",
            "crunched": 0,
            "start": 6762801,
            "end": 6765179,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization.lua",
            "crunched": 0,
            "start": 6765179,
            "end": 6766012,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/en-us.lua",
            "crunched": 0,
            "start": 6766012,
            "end": 6768545,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/vi.lua",
            "crunched": 0,
            "start": 6768545,
            "end": 6771405,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/zh_CN.lua",
            "crunched": 0,
            "start": 6771405,
            "end": 6774008,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/noanims.lua",
            "crunched": 0,
            "start": 6774008,
            "end": 6777765,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/sanitizer.lua",
            "crunched": 0,
            "start": 6777765,
            "end": 6779941,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/gradients.lua",
            "crunched": 0,
            "start": 6779941,
            "end": 6780506,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/ind_effect.lua",
            "crunched": 0,
            "start": 6780506,
            "end": 6782656,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/scoring_calc.lua",
            "crunched": 0,
            "start": 6782656,
            "end": 6784280,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/test.lua",
            "crunched": 0,
            "start": 6784280,
            "end": 6785520,
            "audio": false
        },
        {
            "filename": "/Mods/Aurinko/Aurinko.lua",
            "crunched": 0,
            "start": 6785520,
            "end": 6811485,
            "audio": false
        },
        {
            "filename": "/Mods/Aurinko/LICENSE",
            "crunched": 0,
            "start": 6811485,
            "end": 6847308,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/assets/1x/modicon.png",
            "crunched": 0,
            "start": 6847308,
            "end": 6847769,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/assets/1x/settings.png",
            "crunched": 0,
            "start": 6847769,
            "end": 6848295,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/assets/2x/modicon.png",
            "crunched": 0,
            "start": 6848295,
            "end": 6848769,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/assets/2x/settings.png",
            "crunched": 0,
            "start": 6848769,
            "end": 6849111,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/cartomancer.lua",
            "crunched": 0,
            "start": 6849111,
            "end": 6851653,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/config.lua",
            "crunched": 0,
            "start": 6851653,
            "end": 6853562,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/blinds_info.lua",
            "crunched": 0,
            "start": 6853562,
            "end": 6862367,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/flames.lua",
            "crunched": 0,
            "start": 6862367,
            "end": 6864081,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/hand.lua",
            "crunched": 0,
            "start": 6864081,
            "end": 6865795,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/jokers.lua",
            "crunched": 0,
            "start": 6865795,
            "end": 6874909,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/optimizations.lua",
            "crunched": 0,
            "start": 6874909,
            "end": 6875518,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/view-deck-steamodded.lua",
            "crunched": 0,
            "start": 6875518,
            "end": 6876544,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/core/view-deck.lua",
            "crunched": 0,
            "start": 6876544,
            "end": 6884765,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/git-assets/blinds-info.jpg",
            "crunched": 0,
            "start": 6884765,
            "end": 7249490,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/git-assets/deck-pile.jpg",
            "crunched": 0,
            "start": 7249490,
            "end": 7358732,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/git-assets/stackable-cards.jpg",
            "crunched": 0,
            "start": 7358732,
            "end": 8438873,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/git-assets/zoom-jokers.jpg",
            "crunched": 0,
            "start": 8438873,
            "end": 8947286,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/atlas.lua",
            "crunched": 0,
            "start": 8947286,
            "end": 8948441,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/config.lua",
            "crunched": 0,
            "start": 8948441,
            "end": 8951325,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/init.lua",
            "crunched": 0,
            "start": 8951325,
            "end": 8956295,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/keybinds.lua",
            "crunched": 0,
            "start": 8956295,
            "end": 8960450,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/localization.lua",
            "crunched": 0,
            "start": 8960450,
            "end": 8962128,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/internal/ui.lua",
            "crunched": 0,
            "start": 8962128,
            "end": 8991738,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/libs/nativefs.lua",
            "crunched": 0,
            "start": 8991738,
            "end": 9006559,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/LICENSE",
            "crunched": 0,
            "start": 9006559,
            "end": 9041707,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/localization/en-us.lua",
            "crunched": 0,
            "start": 9041707,
            "end": 9044921,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/localization/es_ES.lua",
            "crunched": 0,
            "start": 9044921,
            "end": 9047674,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/localization/ja.lua",
            "crunched": 0,
            "start": 9047674,
            "end": 9051489,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/localization/vi.lua",
            "crunched": 0,
            "start": 9051489,
            "end": 9054943,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/localization/zh_CN.lua",
            "crunched": 0,
            "start": 9054943,
            "end": 9058310,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely.toml",
            "crunched": 0,
            "start": 9058310,
            "end": 9058708,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/blinds-info.toml",
            "crunched": 0,
            "start": 9058708,
            "end": 9060108,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/dynamic-ante-display.disabled",
            "crunched": 0,
            "start": 9060108,
            "end": 9061964,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/dynamic-hand-align.toml",
            "crunched": 0,
            "start": 9061964,
            "end": 9062621,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/fixed-flames.toml",
            "crunched": 0,
            "start": 9062621,
            "end": 9063969,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/fixes.toml",
            "crunched": 0,
            "start": 9063969,
            "end": 9064561,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/hand-sorting.toml",
            "crunched": 0,
            "start": 9064561,
            "end": 9065504,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/hidden-jokers.toml",
            "crunched": 0,
            "start": 9065504,
            "end": 9066042,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/keybinds.toml",
            "crunched": 0,
            "start": 9066042,
            "end": 9066493,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/limit-deck-size.toml",
            "crunched": 0,
            "start": 9066493,
            "end": 9070251,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/saturn-compat.toml",
            "crunched": 0,
            "start": 9070251,
            "end": 9070631,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/stackable-deck-steamodded-0.9.8.toml",
            "crunched": 0,
            "start": 9070631,
            "end": 9070951,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/stackable-deck-steamodded.toml",
            "crunched": 0,
            "start": 9070951,
            "end": 9076488,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/stackable-deck-vanilla.toml",
            "crunched": 0,
            "start": 9076488,
            "end": 9080784,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/tags.toml",
            "crunched": 0,
            "start": 9080784,
            "end": 9081063,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/vanilla-ui.toml",
            "crunched": 0,
            "start": 9081063,
            "end": 9083818,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/lovely/zoom-jokers.toml",
            "crunched": 0,
            "start": 9083818,
            "end": 9085880,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/mod.lua",
            "crunched": 0,
            "start": 9085880,
            "end": 9086502,
            "audio": false
        },
        {
            "filename": "/Mods/Cartomancer/README.md",
            "crunched": 0,
            "start": 9086502,
            "end": 9088206,
            "audio": false
        },
        {
            "filename": "/Mods/config/Multiplayer.jkr",
            "crunched": 0,
            "start": 9088206,
            "end": 9088621,
            "audio": false
        },
        {
            "filename": "/Mods/config/Steamodded.jkr",
            "crunched": 0,
            "start": 9088621,
            "end": 9088806,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/.gitattributes",
            "crunched": 0,
            "start": 9088806,
            "end": 9088872,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/.gitignore",
            "crunched": 0,
            "start": 9088872,
            "end": 9088995,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasdeck.png",
            "crunched": 0,
            "start": 9088995,
            "end": 9280646,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlaseditiondeck.png",
            "crunched": 0,
            "start": 9280646,
            "end": 9336631,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasepic.png",
            "crunched": 0,
            "start": 9336631,
            "end": 9450368,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasexotic.png",
            "crunched": 0,
            "start": 9450368,
            "end": 9643013,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasnotjokers.png",
            "crunched": 0,
            "start": 9643013,
            "end": 9818529,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasone.png",
            "crunched": 0,
            "start": 9818529,
            "end": 9951116,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasSleeves.png",
            "crunched": 0,
            "start": 9951116,
            "end": 9989207,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasspooky.png",
            "crunched": 0,
            "start": 9989207,
            "end": 10060831,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasthree.png",
            "crunched": 0,
            "start": 10060831,
            "end": 10300343,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlastwo.png",
            "crunched": 0,
            "start": 10300343,
            "end": 10448866,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasvoucher.png",
            "crunched": 0,
            "start": 10448866,
            "end": 10577793,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/b_cry_glowing.png",
            "crunched": 0,
            "start": 10577793,
            "end": 10620836,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_cry_two.png",
            "crunched": 0,
            "start": 10620836,
            "end": 10628096,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_cry.png",
            "crunched": 0,
            "start": 10628096,
            "end": 10657740,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_nostalgia.png",
            "crunched": 0,
            "start": 10657740,
            "end": 10684851,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_achievements.png",
            "crunched": 0,
            "start": 10684851,
            "end": 10691793,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_gameset.png",
            "crunched": 0,
            "start": 10691793,
            "end": 10693538,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_icon.png",
            "crunched": 0,
            "start": 10693538,
            "end": 10694114,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_misc.png",
            "crunched": 0,
            "start": 10694114,
            "end": 10720398,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/goofy.png",
            "crunched": 0,
            "start": 10720398,
            "end": 10725832,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/hands.png",
            "crunched": 0,
            "start": 10725832,
            "end": 10726244,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/intercept_sprite.aseprite",
            "crunched": 0,
            "start": 10726244,
            "end": 10729491,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/j_cry_jimball.png",
            "crunched": 0,
            "start": 10729491,
            "end": 10776139,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/jolly.png",
            "crunched": 0,
            "start": 10776139,
            "end": 11190033,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/old.png",
            "crunched": 0,
            "start": 11190033,
            "end": 11255815,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/pack_cry.png",
            "crunched": 0,
            "start": 11255815,
            "end": 11291165,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/placeholders.png",
            "crunched": 0,
            "start": 11291165,
            "end": 11304898,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/resize.py",
            "crunched": 0,
            "start": 11304898,
            "end": 11305717,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/shinyc.png",
            "crunched": 0,
            "start": 11305717,
            "end": 11316551,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/shinyv.png",
            "crunched": 0,
            "start": 11316551,
            "end": 11325242,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/sleeve_cry_glowing.png",
            "crunched": 0,
            "start": 11325242,
            "end": 11353783,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/stake_cry.png",
            "crunched": 0,
            "start": 11353783,
            "end": 11369870,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/sticker_cry.png",
            "crunched": 0,
            "start": 11369870,
            "end": 11374525,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/tag_cry.png",
            "crunched": 0,
            "start": 11374525,
            "end": 11389803,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasdeck.png",
            "crunched": 0,
            "start": 11389803,
            "end": 11708540,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlaseditiondeck.png",
            "crunched": 0,
            "start": 11708540,
            "end": 11789801,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasepic.png",
            "crunched": 0,
            "start": 11789801,
            "end": 11932803,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasexotic.png",
            "crunched": 0,
            "start": 11932803,
            "end": 12170140,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasnotjokers.png",
            "crunched": 0,
            "start": 12170140,
            "end": 12391156,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasone.png",
            "crunched": 0,
            "start": 12391156,
            "end": 12553214,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasSleeves.png",
            "crunched": 0,
            "start": 12553214,
            "end": 12613782,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasspooky.png",
            "crunched": 0,
            "start": 12613782,
            "end": 12700460,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasthree.png",
            "crunched": 0,
            "start": 12700460,
            "end": 12992150,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlastwo.png",
            "crunched": 0,
            "start": 12992150,
            "end": 13178122,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasvoucher.png",
            "crunched": 0,
            "start": 13178122,
            "end": 13395634,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/b_cry_glowing.png",
            "crunched": 0,
            "start": 13395634,
            "end": 13442693,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_cry_two.png",
            "crunched": 0,
            "start": 13442693,
            "end": 13455001,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_cry.png",
            "crunched": 0,
            "start": 13455001,
            "end": 13527230,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_nostalgia.png",
            "crunched": 0,
            "start": 13527230,
            "end": 13593721,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_achievements.png",
            "crunched": 0,
            "start": 13593721,
            "end": 13608673,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_gameset.png",
            "crunched": 0,
            "start": 13608673,
            "end": 13610891,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_icon.png",
            "crunched": 0,
            "start": 13610891,
            "end": 13611594,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_misc.png",
            "crunched": 0,
            "start": 13611594,
            "end": 13659823,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/goofy.png",
            "crunched": 0,
            "start": 13659823,
            "end": 13685932,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/hands.png",
            "crunched": 0,
            "start": 13685932,
            "end": 13686387,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/intercept_sprite.aseprite",
            "crunched": 0,
            "start": 13686387,
            "end": 13690936,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/j_cry_jimball.png",
            "crunched": 0,
            "start": 13690936,
            "end": 13750513,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/jolly.png",
            "crunched": 0,
            "start": 13750513,
            "end": 14510446,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/old.png",
            "crunched": 0,
            "start": 14510446,
            "end": 14636394,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/pack_cry.png",
            "crunched": 0,
            "start": 14636394,
            "end": 14682960,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/placeholders.png",
            "crunched": 0,
            "start": 14682960,
            "end": 14699804,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/resize.py",
            "crunched": 0,
            "start": 14699804,
            "end": 14700637,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/shinyc.png",
            "crunched": 0,
            "start": 14700637,
            "end": 14716702,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/shinyv.png",
            "crunched": 0,
            "start": 14716702,
            "end": 14731768,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/sleeve_cry_glowing.png",
            "crunched": 0,
            "start": 14731768,
            "end": 14771672,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/stake_cry.png",
            "crunched": 0,
            "start": 14771672,
            "end": 14792360,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/sticker_cry.png",
            "crunched": 0,
            "start": 14792360,
            "end": 14799950,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/tag_cry.png",
            "crunched": 0,
            "start": 14799950,
            "end": 14824000,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/astral.fs",
            "crunched": 0,
            "start": 14824000,
            "end": 14833370,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/blur.fs",
            "crunched": 0,
            "start": 14833370,
            "end": 14840055,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glass.fs",
            "crunched": 0,
            "start": 14840055,
            "end": 14844564,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glitched_b.fs",
            "crunched": 0,
            "start": 14844564,
            "end": 14853706,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glitched.fs",
            "crunched": 0,
            "start": 14853706,
            "end": 14859110,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/gold.fs",
            "crunched": 0,
            "start": 14859110,
            "end": 14863752,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/m.fs",
            "crunched": 0,
            "start": 14863752,
            "end": 14868866,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/mosaic.fs",
            "crunched": 0,
            "start": 14868866,
            "end": 14874596,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/noisy.fs",
            "crunched": 0,
            "start": 14874596,
            "end": 14878531,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/oversat.fs",
            "crunched": 0,
            "start": 14878531,
            "end": 14885986,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/ultrafoil.fs",
            "crunched": 0,
            "start": 14885986,
            "end": 14892642,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/demitrigger.ogg",
            "crunched": 0,
            "start": 14892642,
            "end": 14916804,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_blur.ogg",
            "crunched": 0,
            "start": 14916804,
            "end": 14923309,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_double_sided.ogg",
            "crunched": 0,
            "start": 14923309,
            "end": 15054714,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_fragile.ogg",
            "crunched": 0,
            "start": 15054714,
            "end": 15065636,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_glitched.ogg",
            "crunched": 0,
            "start": 15065636,
            "end": 15084090,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_golden.ogg",
            "crunched": 0,
            "start": 15084090,
            "end": 15110430,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_jolly.ogg",
            "crunched": 0,
            "start": 15110430,
            "end": 15120879,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_mosaic.ogg",
            "crunched": 0,
            "start": 15120879,
            "end": 15182967,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_noisy.ogg",
            "crunched": 0,
            "start": 15182967,
            "end": 15202708,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_oversaturated.ogg",
            "crunched": 0,
            "start": 15202708,
            "end": 15282809,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/forcetrigger.ogg",
            "crunched": 0,
            "start": 15282809,
            "end": 15302973,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow1.ogg",
            "crunched": 0,
            "start": 15302973,
            "end": 15312477,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow2.ogg",
            "crunched": 0,
            "start": 15312477,
            "end": 15321642,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow3.ogg",
            "crunched": 0,
            "start": 15321642,
            "end": 15330666,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow4.ogg",
            "crunched": 0,
            "start": 15330666,
            "end": 15339925,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_big.ogg",
            "crunched": 0,
            "start": 15339925,
            "end": 17704175,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_code.ogg",
            "crunched": 0,
            "start": 17704175,
            "end": 20154374,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_exotic.ogg",
            "crunched": 0,
            "start": 20154374,
            "end": 22339624,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_jimball.ogg",
            "crunched": 0,
            "start": 22339624,
            "end": 23532755,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_madness.ogg",
            "crunched": 0,
            "start": 23532755,
            "end": 25617154,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_mainline.ogg",
            "crunched": 0,
            "start": 25617154,
            "end": 27754593,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_modest.ogg",
            "crunched": 0,
            "start": 27754593,
            "end": 29854063,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/speed.py",
            "crunched": 0,
            "start": 29854063,
            "end": 29854770,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/studiofromhelsinki.ogg",
            "crunched": 0,
            "start": 29854770,
            "end": 29881865,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/whapoosh.ogg",
            "crunched": 0,
            "start": 29881865,
            "end": 29893340,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/config.lua",
            "crunched": 0,
            "start": 29893340,
            "end": 29894008,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/Cryptid.json",
            "crunched": 0,
            "start": 29894008,
            "end": 29894535,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/Cryptid.lua",
            "crunched": 0,
            "start": 29894535,
            "end": 29911200,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/achievement.lua",
            "crunched": 0,
            "start": 29911200,
            "end": 29923835,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/blind.lua",
            "crunched": 0,
            "start": 29923835,
            "end": 29967096,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/challenge.lua",
            "crunched": 0,
            "start": 29967096,
            "end": 29978227,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/code.lua",
            "crunched": 0,
            "start": 29978227,
            "end": 30135461,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/deck.lua",
            "crunched": 0,
            "start": 30135461,
            "end": 30167290,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/enhanced.lua",
            "crunched": 0,
            "start": 30167290,
            "end": 30182665,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/epic.lua",
            "crunched": 0,
            "start": 30182665,
            "end": 30249294,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/exotic.lua",
            "crunched": 0,
            "start": 30249294,
            "end": 30293991,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/joker_display.lua",
            "crunched": 0,
            "start": 30293991,
            "end": 30355594,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/m.lua",
            "crunched": 0,
            "start": 30355594,
            "end": 30404869,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/misc_joker.lua",
            "crunched": 0,
            "start": 30404869,
            "end": 30657321,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/misc.lua",
            "crunched": 0,
            "start": 30657321,
            "end": 30721164,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/planet.lua",
            "crunched": 0,
            "start": 30721164,
            "end": 30770900,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/pointer.lua",
            "crunched": 0,
            "start": 30770900,
            "end": 30825193,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/sleeve.lua",
            "crunched": 0,
            "start": 30825193,
            "end": 30873833,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/spectral.lua",
            "crunched": 0,
            "start": 30873833,
            "end": 30910780,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/spooky.lua",
            "crunched": 0,
            "start": 30910780,
            "end": 30969872,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/stake.lua",
            "crunched": 0,
            "start": 30969872,
            "end": 30984455,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/tag.lua",
            "crunched": 0,
            "start": 30984455,
            "end": 31024175,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/test.lua",
            "crunched": 0,
            "start": 31024175,
            "end": 31030337,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/voucher.lua",
            "crunched": 0,
            "start": 31030337,
            "end": 31065836,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/ascended.lua",
            "crunched": 0,
            "start": 31065836,
            "end": 31077103,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/attributes.lua",
            "crunched": 0,
            "start": 31077103,
            "end": 31077898,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/calculate.lua",
            "crunched": 0,
            "start": 31077898,
            "end": 31083442,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/content.lua",
            "crunched": 0,
            "start": 31083442,
            "end": 31102029,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/cross-mod.lua",
            "crunched": 0,
            "start": 31102029,
            "end": 31107572,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/d20.lua",
            "crunched": 0,
            "start": 31107572,
            "end": 31107947,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/event.lua",
            "crunched": 0,
            "start": 31107947,
            "end": 31109095,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/forcetrigger.lua",
            "crunched": 0,
            "start": 31109095,
            "end": 31149043,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/gameset.lua",
            "crunched": 0,
            "start": 31149043,
            "end": 31203428,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/https.lua",
            "crunched": 0,
            "start": 31203428,
            "end": 31204437,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/misc.lua",
            "crunched": 0,
            "start": 31204437,
            "end": 31244532,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/misprintize.lua",
            "crunched": 0,
            "start": 31244532,
            "end": 31262492,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/modifiers.lua",
            "crunched": 0,
            "start": 31262492,
            "end": 31290172,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/notifications.lua",
            "crunched": 0,
            "start": 31290172,
            "end": 31295353,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/overrides.lua",
            "crunched": 0,
            "start": 31295353,
            "end": 31364374,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/pointerlib.lua",
            "crunched": 0,
            "start": 31364374,
            "end": 31369680,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/ui.lua",
            "crunched": 0,
            "start": 31369680,
            "end": 31382031,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/LICENSE",
            "crunched": 0,
            "start": 31382031,
            "end": 31417180,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/de.lua",
            "crunched": 0,
            "start": 31417180,
            "end": 31576878,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/en-us.lua",
            "crunched": 0,
            "start": 31576878,
            "end": 31731529,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/es_419.lua",
            "crunched": 0,
            "start": 31731529,
            "end": 31845065,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/es_ES.lua",
            "crunched": 0,
            "start": 31845065,
            "end": 31989267,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/fr.lua",
            "crunched": 0,
            "start": 31989267,
            "end": 32151900,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/id.lua",
            "crunched": 0,
            "start": 32151900,
            "end": 32242647,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ja.lua",
            "crunched": 0,
            "start": 32242647,
            "end": 32415366,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ko.lua",
            "crunched": 0,
            "start": 32415366,
            "end": 32576796,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/nl.lua",
            "crunched": 0,
            "start": 32576796,
            "end": 32666788,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/pl.lua",
            "crunched": 0,
            "start": 32666788,
            "end": 32784042,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/pt_BR.lua",
            "crunched": 0,
            "start": 32784042,
            "end": 32923995,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ru.lua",
            "crunched": 0,
            "start": 32923995,
            "end": 33097550,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/tools/find_missing_adv.py",
            "crunched": 0,
            "start": 33097550,
            "end": 33098930,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/tools/find_missing.py",
            "crunched": 0,
            "start": 33098930,
            "end": 33099614,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/vi.lua",
            "crunched": 0,
            "start": 33099614,
            "end": 33241184,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/zh_CN.lua",
            "crunched": 0,
            "start": 33241184,
            "end": 33396631,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/zh_TW.lua",
            "crunched": 0,
            "start": 33396631,
            "end": 33487344,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/abstracted.toml",
            "crunched": 0,
            "start": 33487344,
            "end": 33492101,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/achievement.toml",
            "crunched": 0,
            "start": 33492101,
            "end": 33493566,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Ascended.toml",
            "crunched": 0,
            "start": 33493566,
            "end": 33499738,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/blind.toml",
            "crunched": 0,
            "start": 33499738,
            "end": 33507384,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/cat.toml",
            "crunched": 0,
            "start": 33507384,
            "end": 33516336,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/ccd.toml",
            "crunched": 0,
            "start": 33516336,
            "end": 33521558,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/challenges.toml",
            "crunched": 0,
            "start": 33521558,
            "end": 33522330,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/code.toml",
            "crunched": 0,
            "start": 33522330,
            "end": 33543011,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/conveyor.toml",
            "crunched": 0,
            "start": 33543011,
            "end": 33544190,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/equilibrium.toml",
            "crunched": 0,
            "start": 33544190,
            "end": 33544900,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_gameset.toml",
            "crunched": 0,
            "start": 33544900,
            "end": 33552429,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_https.toml",
            "crunched": 0,
            "start": 33552429,
            "end": 33552750,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_misc.toml",
            "crunched": 0,
            "start": 33552750,
            "end": 33560455,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_modifiers.toml",
            "crunched": 0,
            "start": 33560455,
            "end": 33563495,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_ui.toml",
            "crunched": 0,
            "start": 33563495,
            "end": 33567948,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/misc.toml",
            "crunched": 0,
            "start": 33567948,
            "end": 33587942,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/misprint.toml",
            "crunched": 0,
            "start": 33587942,
            "end": 33606930,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/none.toml",
            "crunched": 0,
            "start": 33606930,
            "end": 33617096,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/planet.toml",
            "crunched": 0,
            "start": 33617096,
            "end": 33618312,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Probability.toml",
            "crunched": 0,
            "start": 33618312,
            "end": 33620018,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/seal.toml",
            "crunched": 0,
            "start": 33620018,
            "end": 33620487,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/spooky.toml",
            "crunched": 0,
            "start": 33620487,
            "end": 33622169,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/stake.toml",
            "crunched": 0,
            "start": 33622169,
            "end": 33636401,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/sticker.toml",
            "crunched": 0,
            "start": 33636401,
            "end": 33640761,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/very_fair.toml",
            "crunched": 0,
            "start": 33640761,
            "end": 33642940,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Voucher.toml",
            "crunched": 0,
            "start": 33642940,
            "end": 33649645,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/README.md",
            "crunched": 0,
            "start": 33649645,
            "end": 33653201,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/assets/1x/galdur_icon.png",
            "crunched": 0,
            "start": 33653201,
            "end": 33654217,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/assets/1x/locked_stake.png",
            "crunched": 0,
            "start": 33654217,
            "end": 33655470,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/assets/2x/galdur_icon.png",
            "crunched": 0,
            "start": 33655470,
            "end": 33656610,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/assets/2x/locked_stake.png",
            "crunched": 0,
            "start": 33656610,
            "end": 33658095,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/assets/2x/stickers.png",
            "crunched": 0,
            "start": 33658095,
            "end": 33664833,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/config.lua",
            "crunched": 0,
            "start": 33664833,
            "end": 33664989,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/galdur.lua",
            "crunched": 0,
            "start": 33664989,
            "end": 33721603,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/localization/default.lua",
            "crunched": 0,
            "start": 33721603,
            "end": 33723625,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/localization/pt_BR.lua",
            "crunched": 0,
            "start": 33723625,
            "end": 33725756,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/localization/zh_CN.lua",
            "crunched": 0,
            "start": 33725756,
            "end": 33727674,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/lovely.toml",
            "crunched": 0,
            "start": 33727674,
            "end": 33731406,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/manifest.json",
            "crunched": 0,
            "start": 33731406,
            "end": 33731813,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/README.md",
            "crunched": 0,
            "start": 33731813,
            "end": 33733288,
            "audio": false
        },
        {
            "filename": "/Mods/Galdur/utils/EremelUtility.lua",
            "crunched": 0,
            "start": 33733288,
            "end": 33740714,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/.gitignore",
            "crunched": 0,
            "start": 33740714,
            "end": 33740736,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/assets/1x/icon.png",
            "crunched": 0,
            "start": 33740736,
            "end": 33741250,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/assets/2x/icon.png",
            "crunched": 0,
            "start": 33741250,
            "end": 33741861,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/index.lua",
            "crunched": 0,
            "start": 33741861,
            "end": 33747252,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/loc_txt/en-us.lua",
            "crunched": 0,
            "start": 33747252,
            "end": 33774658,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/loc_txt/es_419.lua",
            "crunched": 0,
            "start": 33774658,
            "end": 33805158,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/loc_txt/es_ES.lua",
            "crunched": 0,
            "start": 33805158,
            "end": 33835862,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/loc_txt/ru.lua",
            "crunched": 0,
            "start": 33835862,
            "end": 33870504,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/loc_txt/zh_CN.lua",
            "crunched": 0,
            "start": 33870504,
            "end": 33896772,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controller.toml",
            "crunched": 0,
            "start": 33896772,
            "end": 33900302,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_animation_skip.toml",
            "crunched": 0,
            "start": 33900302,
            "end": 33904971,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_deselect_hand.toml",
            "crunched": 0,
            "start": 33904971,
            "end": 33905313,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_insta_booster_skip.toml",
            "crunched": 0,
            "start": 33905313,
            "end": 33905643,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_insta_cash_out.toml",
            "crunched": 0,
            "start": 33905643,
            "end": 33906503,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_misc.toml",
            "crunched": 0,
            "start": 33906503,
            "end": 33907346,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_regular_keybinds.toml",
            "crunched": 0,
            "start": 33907346,
            "end": 33907995,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_scoring_hold.toml",
            "crunched": 0,
            "start": 33907995,
            "end": 33908332,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_show_deck_preview.toml",
            "crunched": 0,
            "start": 33908332,
            "end": 33908624,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/controls_speed_multiplier.toml",
            "crunched": 0,
            "start": 33908624,
            "end": 33909422,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/init.toml",
            "crunched": 0,
            "start": 33909422,
            "end": 33913488,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/localization.toml",
            "crunched": 0,
            "start": 33913488,
            "end": 33914156,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/lovely/ui.toml",
            "crunched": 0,
            "start": 33914156,
            "end": 33916440,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/metadata.json",
            "crunched": 0,
            "start": 33916440,
            "end": 33916739,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/config.lua",
            "crunched": 0,
            "start": 33916739,
            "end": 33928383,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controller.lua",
            "crunched": 0,
            "start": 33928383,
            "end": 33962764,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/animation_skip.lua",
            "crunched": 0,
            "start": 33962764,
            "end": 33974989,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/dangerous_actions.lua",
            "crunched": 0,
            "start": 33974989,
            "end": 33984768,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/deselect_hand.lua",
            "crunched": 0,
            "start": 33984768,
            "end": 33985663,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/insta_actions.lua",
            "crunched": 0,
            "start": 33985663,
            "end": 33996424,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/insta_booster_skip.lua",
            "crunched": 0,
            "start": 33996424,
            "end": 33997959,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/insta_cash_out.lua",
            "crunched": 0,
            "start": 33997959,
            "end": 33999064,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/insta_highlight_entire_f_hand.lua",
            "crunched": 0,
            "start": 33999064,
            "end": 34000005,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/insta_highlight.lua",
            "crunched": 0,
            "start": 34000005,
            "end": 34001628,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/misc.lua",
            "crunched": 0,
            "start": 34001628,
            "end": 34007605,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/move_highlight.lua",
            "crunched": 0,
            "start": 34007605,
            "end": 34010184,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/nopeus_interaction.lua",
            "crunched": 0,
            "start": 34010184,
            "end": 34013914,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/not_just_yet_interaction.lua",
            "crunched": 0,
            "start": 34013914,
            "end": 34014990,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/presets_switch.lua",
            "crunched": 0,
            "start": 34014990,
            "end": 34019125,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/regular_keybinds.lua",
            "crunched": 0,
            "start": 34019125,
            "end": 34030124,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/scoring_hold.lua",
            "crunched": 0,
            "start": 34030124,
            "end": 34032139,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/show_deck_preview.lua",
            "crunched": 0,
            "start": 34032139,
            "end": 34032680,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/controls/speed_multiplier.lua",
            "crunched": 0,
            "start": 34032680,
            "end": 34037481,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/fake_events.lua",
            "crunched": 0,
            "start": 34037481,
            "end": 34039545,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/presets.lua",
            "crunched": 0,
            "start": 34039545,
            "end": 34044044,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/config_dictionary.lua",
            "crunched": 0,
            "start": 34044044,
            "end": 34098309,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/config_tabs.lua",
            "crunched": 0,
            "start": 34098309,
            "end": 34126779,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/config.lua",
            "crunched": 0,
            "start": 34126779,
            "end": 34129593,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/functions.lua",
            "crunched": 0,
            "start": 34129593,
            "end": 34137085,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/index.lua",
            "crunched": 0,
            "start": 34137085,
            "end": 34138729,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/parts.lua",
            "crunched": 0,
            "start": 34138729,
            "end": 34156940,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/ui/state_panel.lua",
            "crunched": 0,
            "start": 34156940,
            "end": 34161894,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/modules/utils.lua",
            "crunched": 0,
            "start": 34161894,
            "end": 34166405,
            "audio": false
        },
        {
            "filename": "/Mods/HandyBalatro/steamodded.lua",
            "crunched": 0,
            "start": 34166405,
            "end": 34168205,
            "audio": false
        },
        {
            "filename": "/Mods/JenLib/JenLib.lua",
            "crunched": 0,
            "start": 34168205,
            "end": 34199690,
            "audio": false
        },
        {
            "filename": "/Mods/JenLib/LICENSE",
            "crunched": 0,
            "start": 34199690,
            "end": 34235513,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/blacklist.txt",
            "crunched": 0,
            "start": 34235513,
            "end": 34235522,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/.env.example",
            "crunched": 0,
            "start": 34235522,
            "end": 34235754,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/.gitignore",
            "crunched": 0,
            "start": 34235754,
            "end": 34235872,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/agents.md",
            "crunched": 0,
            "start": 34235872,
            "end": 34256419,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 34256419,
            "end": 34260667,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/alt_stickers.png",
            "crunched": 0,
            "start": 34260667,
            "end": 34262221,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/b_heidelberg.png",
            "crunched": 0,
            "start": 34262221,
            "end": 34263428,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/blind_col.png",
            "crunched": 0,
            "start": 34263428,
            "end": 34368764,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 34368764,
            "end": 34394009,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/c_asteroid.png",
            "crunched": 0,
            "start": 34394009,
            "end": 34401061,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/c_ouija_2.png",
            "crunched": 0,
            "start": 34401061,
            "end": 34402460,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/deck_stickers.png",
            "crunched": 0,
            "start": 34402460,
            "end": 34429086,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/decks.png",
            "crunched": 0,
            "start": 34429086,
            "end": 34456085,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 34456085,
            "end": 34654383,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 34654383,
            "end": 34759760,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 34759760,
            "end": 34770628,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 34770628,
            "end": 34777662,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 34777662,
            "end": 34787876,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 34787876,
            "end": 34796569,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 34796569,
            "end": 34799491,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 34799491,
            "end": 34810228,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_copycat.png",
            "crunched": 0,
            "start": 34810228,
            "end": 34816949,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_defensive_joker.png",
            "crunched": 0,
            "start": 34816949,
            "end": 34818917,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 34818917,
            "end": 34819733,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 34819733,
            "end": 34826152,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 34826152,
            "end": 34838137,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 34838137,
            "end": 34840858,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 34840858,
            "end": 34846025,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 34846025,
            "end": 34854562,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 34854562,
            "end": 34858175,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 34858175,
            "end": 34868124,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 34868124,
            "end": 34880625,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_magnet.png",
            "crunched": 0,
            "start": 34880625,
            "end": 34885420,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 34885420,
            "end": 34894548,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 34894548,
            "end": 34899036,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_order_sandbox.png",
            "crunched": 0,
            "start": 34899036,
            "end": 34907647,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_pacifist.png",
            "crunched": 0,
            "start": 34907647,
            "end": 34909632,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_penny_pincher.png",
            "crunched": 0,
            "start": 34909632,
            "end": 34911927,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 34911927,
            "end": 34922067,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_pizza.png",
            "crunched": 0,
            "start": 34922067,
            "end": 34925465,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 34925465,
            "end": 34927209,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 34927209,
            "end": 34933973,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 34933973,
            "end": 34941126,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_skip_off.png",
            "crunched": 0,
            "start": 34941126,
            "end": 34942922,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_speedrun.png",
            "crunched": 0,
            "start": 34942922,
            "end": 34943537,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_square_sandbox.png",
            "crunched": 0,
            "start": 34943537,
            "end": 34947769,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 34947769,
            "end": 34953811,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_taxes.png",
            "crunched": 0,
            "start": 34953811,
            "end": 34960852,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 34960852,
            "end": 34970637,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 34970637,
            "end": 34977741,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/modicon.png",
            "crunched": 0,
            "start": 34977741,
            "end": 34978211,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/player_blind_row.png",
            "crunched": 0,
            "start": 34978211,
            "end": 34979781,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/release_jokers.png",
            "crunched": 0,
            "start": 34979781,
            "end": 35569079,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/stakes-chips.png",
            "crunched": 0,
            "start": 35569079,
            "end": 35571109,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/standard_giga.png",
            "crunched": 0,
            "start": 35571109,
            "end": 35575093,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/sticker_balanced.png",
            "crunched": 0,
            "start": 35575093,
            "end": 35579586,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/sticker_nemesis.png",
            "crunched": 0,
            "start": 35579586,
            "end": 35580148,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/stickers.png",
            "crunched": 0,
            "start": 35580148,
            "end": 35584532,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/1x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 35584532,
            "end": 35586325,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 35586325,
            "end": 35608355,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/alt_stickers.png",
            "crunched": 0,
            "start": 35608355,
            "end": 35611823,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/b_heidelberg.png",
            "crunched": 0,
            "start": 35611823,
            "end": 35614326,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/blind_col.png",
            "crunched": 0,
            "start": 35614326,
            "end": 35806587,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 35806587,
            "end": 35814299,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/c_asteroid.png",
            "crunched": 0,
            "start": 35814299,
            "end": 35822517,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/c_ouija_2.png",
            "crunched": 0,
            "start": 35822517,
            "end": 35825456,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/deck_stickers.png",
            "crunched": 0,
            "start": 35825456,
            "end": 35866865,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/decks.png",
            "crunched": 0,
            "start": 35866865,
            "end": 35917664,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 35917664,
            "end": 36178922,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 36178922,
            "end": 36236722,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 36236722,
            "end": 36263844,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 36263844,
            "end": 36277186,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 36277186,
            "end": 36302284,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 36302284,
            "end": 36325240,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 36325240,
            "end": 36328442,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 36328442,
            "end": 36353929,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_copycat.png",
            "crunched": 0,
            "start": 36353929,
            "end": 36361458,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_defensive_joker.png",
            "crunched": 0,
            "start": 36361458,
            "end": 36363860,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 36363860,
            "end": 36365514,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 36365514,
            "end": 36380579,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 36380579,
            "end": 36410404,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 36410404,
            "end": 36420859,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 36420859,
            "end": 36431621,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 36431621,
            "end": 36450875,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 36450875,
            "end": 36454860,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 36454860,
            "end": 36478122,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 36478122,
            "end": 36519339,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_magnet.png",
            "crunched": 0,
            "start": 36519339,
            "end": 36525511,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 36525511,
            "end": 36547477,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 36547477,
            "end": 36569614,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_order_sandbox.png",
            "crunched": 0,
            "start": 36569614,
            "end": 36589986,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_pacifist.png",
            "crunched": 0,
            "start": 36589986,
            "end": 36592487,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_penny_pincher.png",
            "crunched": 0,
            "start": 36592487,
            "end": 36595288,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 36595288,
            "end": 36620647,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_pizza.png",
            "crunched": 0,
            "start": 36620647,
            "end": 36624654,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 36624654,
            "end": 36630093,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 36630093,
            "end": 36645000,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 36645000,
            "end": 36661082,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_skip_off.png",
            "crunched": 0,
            "start": 36661082,
            "end": 36663258,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_speedrun.png",
            "crunched": 0,
            "start": 36663258,
            "end": 36664542,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_square_sandbox.png",
            "crunched": 0,
            "start": 36664542,
            "end": 36673895,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 36673895,
            "end": 36687104,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_taxes.png",
            "crunched": 0,
            "start": 36687104,
            "end": 36691197,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 36691197,
            "end": 36714686,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 36714686,
            "end": 36731994,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/modicon.png",
            "crunched": 0,
            "start": 36731994,
            "end": 36732697,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/player_blind_row.png",
            "crunched": 0,
            "start": 36732697,
            "end": 36736975,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/release_jokers.png",
            "crunched": 0,
            "start": 36736975,
            "end": 37601885,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/stakes-chips.png",
            "crunched": 0,
            "start": 37601885,
            "end": 37610660,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/standard_giga.png",
            "crunched": 0,
            "start": 37610660,
            "end": 37619098,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/sticker_balanced.png",
            "crunched": 0,
            "start": 37619098,
            "end": 37620117,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/sticker_nemesis.png",
            "crunched": 0,
            "start": 37620117,
            "end": 37621009,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/assets/2x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 37621009,
            "end": 37621712,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/CHANGELOG.md",
            "crunched": 0,
            "start": 37621712,
            "end": 37623834,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/_compatibility.lua",
            "crunched": 0,
            "start": 37623834,
            "end": 37625829,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/AntePreview.lua",
            "crunched": 0,
            "start": 37625829,
            "end": 37626220,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/CodexArcanum.lua",
            "crunched": 0,
            "start": 37626220,
            "end": 37626446,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Cryptid.lua",
            "crunched": 0,
            "start": 37626446,
            "end": 37628347,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Distro.lua",
            "crunched": 0,
            "start": 37628347,
            "end": 37631083,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/ExtraCredit.lua",
            "crunched": 0,
            "start": 37631083,
            "end": 37631282,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Handy.lua",
            "crunched": 0,
            "start": 37631282,
            "end": 37636424,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/HotPotato.lua",
            "crunched": 0,
            "start": 37636424,
            "end": 37640237,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Jen.lua",
            "crunched": 0,
            "start": 37640237,
            "end": 37640508,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/JokerDisplay.lua",
            "crunched": 0,
            "start": 37640508,
            "end": 37649370,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Ortalab.lua",
            "crunched": 0,
            "start": 37649370,
            "end": 37649674,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Pokermon.lua",
            "crunched": 0,
            "start": 37649674,
            "end": 37649921,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/CorePreview.lua",
            "crunched": 0,
            "start": 37649921,
            "end": 37659291,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/EngineSimulate.lua",
            "crunched": 0,
            "start": 37659291,
            "end": 37675849,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/InitPreview.lua",
            "crunched": 0,
            "start": 37675849,
            "end": 37680082,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/InitSimulate.lua",
            "crunched": 0,
            "start": 37680082,
            "end": 37681094,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/InterfacePreview.lua",
            "crunched": 0,
            "start": 37681094,
            "end": 37686040,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/Jokers/_Vanilla.lua",
            "crunched": 0,
            "start": 37686040,
            "end": 37721889,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/Jokers/Multiplayer.lua",
            "crunched": 0,
            "start": 37721889,
            "end": 37724267,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/UtilsPreview.lua",
            "crunched": 0,
            "start": 37724267,
            "end": 37725135,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Preview/UtilsSimulate.lua",
            "crunched": 0,
            "start": 37725135,
            "end": 37732362,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/StrangePencil.lua",
            "crunched": 0,
            "start": 37732362,
            "end": 37732989,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/Talisman.lua",
            "crunched": 0,
            "start": 37732989,
            "end": 37733037,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/TheOrder.lua",
            "crunched": 0,
            "start": 37733037,
            "end": 37757283,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/TooManyJokers.lua",
            "crunched": 0,
            "start": 37757283,
            "end": 37757691,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/compatibility/UpgradeMod.lua",
            "crunched": 0,
            "start": 37757691,
            "end": 37758552,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/config.lua",
            "crunched": 0,
            "start": 37758552,
            "end": 37758916,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/CONTRIBUTING.md",
            "crunched": 0,
            "start": 37758916,
            "end": 37763149,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/core.lua",
            "crunched": 0,
            "start": 37763149,
            "end": 37772448,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/gamemodes/_gamemodes.lua",
            "crunched": 0,
            "start": 37772448,
            "end": 37773354,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/gamemodes/attrition.lua",
            "crunched": 0,
            "start": 37773354,
            "end": 37777638,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/gamemodes/showdown.lua",
            "crunched": 0,
            "start": 37777638,
            "end": 37781847,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/gamemodes/survival.lua",
            "crunched": 0,
            "start": 37781847,
            "end": 37784608,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/_layers.lua",
            "crunched": 0,
            "start": 37784608,
            "end": 37793650,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/ban_mutators.lua",
            "crunched": 0,
            "start": 37793650,
            "end": 37794301,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/classic.lua",
            "crunched": 0,
            "start": 37794301,
            "end": 37794400,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/economy_mutators.lua",
            "crunched": 0,
            "start": 37794400,
            "end": 37795468,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/eeeee.lua",
            "crunched": 0,
            "start": 37795468,
            "end": 37796344,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/esoteric_mutators.lua",
            "crunched": 0,
            "start": 37796344,
            "end": 37796743,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/experimental.lua",
            "crunched": 0,
            "start": 37796743,
            "end": 37798754,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/glass_cannon.lua",
            "crunched": 0,
            "start": 37798754,
            "end": 37799542,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/glass_variants.lua",
            "crunched": 0,
            "start": 37799542,
            "end": 37799752,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/mutator_stubs.lua",
            "crunched": 0,
            "start": 37799752,
            "end": 37800006,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/no_anim_timer.lua",
            "crunched": 0,
            "start": 37800006,
            "end": 37800144,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/no_red_seals.lua",
            "crunched": 0,
            "start": 37800144,
            "end": 37801090,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/polymorph_spam.lua",
            "crunched": 0,
            "start": 37801090,
            "end": 37805269,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/pressure_timer.lua",
            "crunched": 0,
            "start": 37805269,
            "end": 37805801,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/pvp_timer.lua",
            "crunched": 0,
            "start": 37805801,
            "end": 37805905,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/ranked.lua",
            "crunched": 0,
            "start": 37805905,
            "end": 37806166,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/release.lua",
            "crunched": 0,
            "start": 37806166,
            "end": 37806257,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/sandbox.lua",
            "crunched": 0,
            "start": 37806257,
            "end": 37814995,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/score_instability.lua",
            "crunched": 0,
            "start": 37814995,
            "end": 37817042,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/shared_pockets.lua",
            "crunched": 0,
            "start": 37817042,
            "end": 37819685,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/shop_mutators.lua",
            "crunched": 0,
            "start": 37819685,
            "end": 37819770,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/smallworld.lua",
            "crunched": 0,
            "start": 37819770,
            "end": 37824877,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/speedlatro_timer.lua",
            "crunched": 0,
            "start": 37824877,
            "end": 37830109,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/standard.lua",
            "crunched": 0,
            "start": 37830109,
            "end": 37830665,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/layers/wraith_rework.lua",
            "crunched": 0,
            "start": 37830665,
            "end": 37830859,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/_init.lua",
            "crunched": 0,
            "start": 37830859,
            "end": 37830873,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/_table_utils.lua",
            "crunched": 0,
            "start": 37830873,
            "end": 37832447,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/blind_utils.lua",
            "crunched": 0,
            "start": 37832447,
            "end": 37833071,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/card_utils.lua",
            "crunched": 0,
            "start": 37833071,
            "end": 37839855,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/crypto.lua",
            "crunched": 0,
            "start": 37839855,
            "end": 37842023,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/debug_utils.lua",
            "crunched": 0,
            "start": 37842023,
            "end": 37842771,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/ghost_replay.lua",
            "crunched": 0,
            "start": 37842771,
            "end": 37854988,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/insane_int.lua",
            "crunched": 0,
            "start": 37854988,
            "end": 37859167,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/joker_stats.lua",
            "crunched": 0,
            "start": 37859167,
            "end": 37860438,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/log_parser.lua",
            "crunched": 0,
            "start": 37860438,
            "end": 37873681,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/matchmaking.lua",
            "crunched": 0,
            "start": 37873681,
            "end": 37882779,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/practice_mode.lua",
            "crunched": 0,
            "start": 37882779,
            "end": 37884869,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/replay_log.lua",
            "crunched": 0,
            "start": 37884869,
            "end": 37894394,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/ruleset_utils.lua",
            "crunched": 0,
            "start": 37894394,
            "end": 37896536,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/serialization.lua",
            "crunched": 0,
            "start": 37896536,
            "end": 37899335,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/settings_utils.lua",
            "crunched": 0,
            "start": 37899335,
            "end": 37899335,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/string_utils.lua",
            "crunched": 0,
            "start": 37899335,
            "end": 37900119,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lib/ui.lua",
            "crunched": 0,
            "start": 37900119,
            "end": 37903173,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/LICENSE.md",
            "crunched": 0,
            "start": 37903173,
            "end": 37938322,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/de.lua",
            "crunched": 0,
            "start": 37938322,
            "end": 37947340,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/en-us.lua",
            "crunched": 0,
            "start": 37947340,
            "end": 37998449,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/es_419.lua",
            "crunched": 0,
            "start": 37998449,
            "end": 38034603,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/es_ES.lua",
            "crunched": 0,
            "start": 38034603,
            "end": 38047387,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/fr.lua",
            "crunched": 0,
            "start": 38047387,
            "end": 38061136,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/it.lua",
            "crunched": 0,
            "start": 38061136,
            "end": 38088929,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/ja.lua",
            "crunched": 0,
            "start": 38088929,
            "end": 38123185,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/ko.lua",
            "crunched": 0,
            "start": 38123185,
            "end": 38156591,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/mi.lua",
            "crunched": 0,
            "start": 38156591,
            "end": 38166719,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/nl.lua",
            "crunched": 0,
            "start": 38166719,
            "end": 38180319,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/pl.lua",
            "crunched": 0,
            "start": 38180319,
            "end": 38193218,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/pt_BR.lua",
            "crunched": 0,
            "start": 38193218,
            "end": 38208202,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/ru.lua",
            "crunched": 0,
            "start": 38208202,
            "end": 38277238,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/stylua.toml",
            "crunched": 0,
            "start": 38277238,
            "end": 38277372,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/vi.lua",
            "crunched": 0,
            "start": 38277372,
            "end": 38323015,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/zh_CN.lua",
            "crunched": 0,
            "start": 38323015,
            "end": 38340406,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/localization/zh_TW.lua",
            "crunched": 0,
            "start": 38340406,
            "end": 38343328,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/cards.toml",
            "crunched": 0,
            "start": 38343328,
            "end": 38345915,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/ce.toml",
            "crunched": 0,
            "start": 38345915,
            "end": 38346882,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/challenges.toml",
            "crunched": 0,
            "start": 38346882,
            "end": 38347716,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/compatibility.toml",
            "crunched": 0,
            "start": 38347716,
            "end": 38348327,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/deck_select.toml",
            "crunched": 0,
            "start": 38348327,
            "end": 38351153,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/decks.toml",
            "crunched": 0,
            "start": 38351153,
            "end": 38352110,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/double_emplace.toml",
            "crunched": 0,
            "start": 38352110,
            "end": 38353382,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/end_round.toml",
            "crunched": 0,
            "start": 38353382,
            "end": 38358732,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/game.toml",
            "crunched": 0,
            "start": 38358732,
            "end": 38364307,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/hud.toml",
            "crunched": 0,
            "start": 38364307,
            "end": 38367475,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/misc.toml",
            "crunched": 0,
            "start": 38367475,
            "end": 38374011,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/pause.toml",
            "crunched": 0,
            "start": 38374011,
            "end": 38375761,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/practice.toml",
            "crunched": 0,
            "start": 38375761,
            "end": 38378761,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/preview.toml",
            "crunched": 0,
            "start": 38378761,
            "end": 38379690,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/rework-center.toml",
            "crunched": 0,
            "start": 38379690,
            "end": 38381035,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/shared_area.toml",
            "crunched": 0,
            "start": 38381035,
            "end": 38381885,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/stakes.toml",
            "crunched": 0,
            "start": 38381885,
            "end": 38384211,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/TheOrder.toml",
            "crunched": 0,
            "start": 38384211,
            "end": 38392126,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/timer.toml",
            "crunched": 0,
            "start": 38392126,
            "end": 38392636,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/lovely/view_deck.toml",
            "crunched": 0,
            "start": 38392636,
            "end": 38393553,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/Multiplayer.json",
            "crunched": 0,
            "start": 38393553,
            "end": 38394183,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/networking/action_handlers.lua",
            "crunched": 0,
            "start": 38394183,
            "end": 38441064,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/networking/socket.lua",
            "crunched": 0,
            "start": 38441064,
            "end": 38447564,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/blinds/nemesis.lua",
            "crunched": 0,
            "start": 38447564,
            "end": 38448317,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/boosters/standard_giga.lua",
            "crunched": 0,
            "start": 38448317,
            "end": 38449502,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/all_must_go.lua",
            "crunched": 0,
            "start": 38449502,
            "end": 38449690,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/bacon.lua",
            "crunched": 0,
            "start": 38449690,
            "end": 38450832,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/balancing_act.lua",
            "crunched": 0,
            "start": 38450832,
            "end": 38451339,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/chore_list.lua",
            "crunched": 0,
            "start": 38451339,
            "end": 38452124,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/divination.lua",
            "crunched": 0,
            "start": 38452124,
            "end": 38452270,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/eeeee.lua",
            "crunched": 0,
            "start": 38452270,
            "end": 38452496,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/high_hand.lua",
            "crunched": 0,
            "start": 38452496,
            "end": 38452795,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/in_the_red.lua",
            "crunched": 0,
            "start": 38452795,
            "end": 38453189,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/legendaries.lua",
            "crunched": 0,
            "start": 38453189,
            "end": 38453804,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/lets_go_gambling.lua",
            "crunched": 0,
            "start": 38453804,
            "end": 38454805,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/misprint_deck.lua",
            "crunched": 0,
            "start": 38454805,
            "end": 38455042,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/oops_all_jokers.lua",
            "crunched": 0,
            "start": 38455042,
            "end": 38456244,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/planet_tycoon.lua",
            "crunched": 0,
            "start": 38456244,
            "end": 38456645,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/polymorph_spam.lua",
            "crunched": 0,
            "start": 38456645,
            "end": 38457318,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/psychosis.lua",
            "crunched": 0,
            "start": 38457318,
            "end": 38457462,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/salvaged_sibyl.lua",
            "crunched": 0,
            "start": 38457462,
            "end": 38459542,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/scratch.lua",
            "crunched": 0,
            "start": 38459542,
            "end": 38459809,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/shared_pockets.lua",
            "crunched": 0,
            "start": 38459809,
            "end": 38460183,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/skip_off.lua",
            "crunched": 0,
            "start": 38460183,
            "end": 38460372,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/speed.lua",
            "crunched": 0,
            "start": 38460372,
            "end": 38460611,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/twin_towers.lua",
            "crunched": 0,
            "start": 38460611,
            "end": 38460797,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/challenges/vantablack.lua",
            "crunched": 0,
            "start": 38460797,
            "end": 38461165,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/consumables/asteroid.lua",
            "crunched": 0,
            "start": 38461165,
            "end": 38462615,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/consumables/judgement.lua",
            "crunched": 0,
            "start": 38462615,
            "end": 38465081,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/consumables/ouija.lua",
            "crunched": 0,
            "start": 38465081,
            "end": 38467600,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/consumables/sandbox/ectoplasm.lua",
            "crunched": 0,
            "start": 38467600,
            "end": 38469294,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/consumables/wraith.lua",
            "crunched": 0,
            "start": 38469294,
            "end": 38470200,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/_decks.lua",
            "crunched": 0,
            "start": 38470200,
            "end": 38471230,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/00_violet.lua",
            "crunched": 0,
            "start": 38471230,
            "end": 38472061,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/01_indigo.lua",
            "crunched": 0,
            "start": 38472061,
            "end": 38475116,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/02_orange.lua",
            "crunched": 0,
            "start": 38475116,
            "end": 38476387,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/09_white.lua",
            "crunched": 0,
            "start": 38476387,
            "end": 38477373,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/AA_oracle.lua",
            "crunched": 0,
            "start": 38477373,
            "end": 38478170,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/BB_gradient.lua",
            "crunched": 0,
            "start": 38478170,
            "end": 38483708,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/CC_heidelberg.lua",
            "crunched": 0,
            "start": 38483708,
            "end": 38484428,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/EC_echo_deck.lua",
            "crunched": 0,
            "start": 38484428,
            "end": 38485777,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/decks/ZZ_cocktail.lua",
            "crunched": 0,
            "start": 38485777,
            "end": 38505141,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/editions/phantom.lua",
            "crunched": 0,
            "start": 38505141,
            "end": 38506288,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/enhancements/mp_glass.lua",
            "crunched": 0,
            "start": 38506288,
            "end": 38506495,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/conjoined_joker.lua",
            "crunched": 0,
            "start": 38506495,
            "end": 38508298,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/defensive_joker.lua",
            "crunched": 0,
            "start": 38508298,
            "end": 38509695,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/experimental/baron_uncommon.lua",
            "crunched": 0,
            "start": 38509695,
            "end": 38510422,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/experimental/idol_rare.lua",
            "crunched": 0,
            "start": 38510422,
            "end": 38511356,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/experimental/mime_rare.lua",
            "crunched": 0,
            "start": 38511356,
            "end": 38511844,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/experimental/todo_list.lua",
            "crunched": 0,
            "start": 38511844,
            "end": 38513457,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/lets_go_gambling.lua",
            "crunched": 0,
            "start": 38513457,
            "end": 38515742,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/pacifist.lua",
            "crunched": 0,
            "start": 38515742,
            "end": 38516554,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/penny_pincher.lua",
            "crunched": 0,
            "start": 38516554,
            "end": 38517680,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/pizza.lua",
            "crunched": 0,
            "start": 38517680,
            "end": 38519382,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/baseball.lua",
            "crunched": 0,
            "start": 38519382,
            "end": 38520234,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/bloodstone.lua",
            "crunched": 0,
            "start": 38520234,
            "end": 38521341,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/castle.lua",
            "crunched": 0,
            "start": 38521341,
            "end": 38522816,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/cloud_9.lua",
            "crunched": 0,
            "start": 38522816,
            "end": 38524528,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/constellation.lua",
            "crunched": 0,
            "start": 38524528,
            "end": 38526143,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/error.lua",
            "crunched": 0,
            "start": 38526143,
            "end": 38530871,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/_ec_atlas.lua",
            "crunched": 0,
            "start": 38530871,
            "end": 38531234,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/_ec_utils.lua",
            "crunched": 0,
            "start": 38531234,
            "end": 38534566,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/alloy.lua",
            "crunched": 0,
            "start": 38534566,
            "end": 38535466,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/ambrosia.lua",
            "crunched": 0,
            "start": 38535466,
            "end": 38537694,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/bobby.lua",
            "crunched": 0,
            "start": 38537694,
            "end": 38539449,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/candynecklace.lua",
            "crunched": 0,
            "start": 38539449,
            "end": 38541256,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/chainlightning.lua",
            "crunched": 0,
            "start": 38541256,
            "end": 38542740,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/clowncar.lua",
            "crunched": 0,
            "start": 38542740,
            "end": 38543738,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/clowncollege.lua",
            "crunched": 0,
            "start": 38543738,
            "end": 38545423,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/couponsheet.lua",
            "crunched": 0,
            "start": 38545423,
            "end": 38547146,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/doublerainbow.lua",
            "crunched": 0,
            "start": 38547146,
            "end": 38548473,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/espresso.lua",
            "crunched": 0,
            "start": 38548473,
            "end": 38551033,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/farmer.lua",
            "crunched": 0,
            "start": 38551033,
            "end": 38552171,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/forklift.lua",
            "crunched": 0,
            "start": 38552171,
            "end": 38553330,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/gofish.lua",
            "crunched": 0,
            "start": 38553330,
            "end": 38554991,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/hoarder.lua",
            "crunched": 0,
            "start": 38554991,
            "end": 38555579,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/jokalisa.lua",
            "crunched": 0,
            "start": 38555579,
            "end": 38557317,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/jokeroftheyear.lua",
            "crunched": 0,
            "start": 38557317,
            "end": 38558150,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/lucky7.lua",
            "crunched": 0,
            "start": 38558150,
            "end": 38559684,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/montehaul.lua",
            "crunched": 0,
            "start": 38559684,
            "end": 38561816,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/pocketaces.lua",
            "crunched": 0,
            "start": 38561816,
            "end": 38563036,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/pyromancer.lua",
            "crunched": 0,
            "start": 38563036,
            "end": 38563996,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/shipoftheseus.lua",
            "crunched": 0,
            "start": 38563996,
            "end": 38566213,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/starfruit.lua",
            "crunched": 0,
            "start": 38566213,
            "end": 38568604,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/trafficlight.lua",
            "crunched": 0,
            "start": 38568604,
            "end": 38570376,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/tuxedo.lua",
            "crunched": 0,
            "start": 38570376,
            "end": 38571782,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/warlock.lua",
            "crunched": 0,
            "start": 38571782,
            "end": 38574257,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/extra-credit/werewolf.lua",
            "crunched": 0,
            "start": 38574257,
            "end": 38575595,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/faceless.lua",
            "crunched": 0,
            "start": 38575595,
            "end": 38577002,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/golden_ticket.lua",
            "crunched": 0,
            "start": 38577002,
            "end": 38578362,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/hit_the_road.lua",
            "crunched": 0,
            "start": 38578362,
            "end": 38579532,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/idol.lua",
            "crunched": 0,
            "start": 38579532,
            "end": 38585939,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/juggler.lua",
            "crunched": 0,
            "start": 38585939,
            "end": 38587760,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/loyalty_card.lua",
            "crunched": 0,
            "start": 38587760,
            "end": 38589955,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/lucky_cat.lua",
            "crunched": 0,
            "start": 38589955,
            "end": 38591281,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/magnet_sandbox.lua",
            "crunched": 0,
            "start": 38591281,
            "end": 38594197,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/mail.lua",
            "crunched": 0,
            "start": 38594197,
            "end": 38595756,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/misprint.lua",
            "crunched": 0,
            "start": 38595756,
            "end": 38596910,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/order.lua",
            "crunched": 0,
            "start": 38596910,
            "end": 38598269,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/photograph.lua",
            "crunched": 0,
            "start": 38598269,
            "end": 38599278,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/ride_the_bus.lua",
            "crunched": 0,
            "start": 38599278,
            "end": 38601159,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/runner.lua",
            "crunched": 0,
            "start": 38601159,
            "end": 38602243,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/satellite.lua",
            "crunched": 0,
            "start": 38602243,
            "end": 38603774,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/square.lua",
            "crunched": 0,
            "start": 38603774,
            "end": 38604898,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/steel_joker.lua",
            "crunched": 0,
            "start": 38604898,
            "end": 38605749,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/throwback.lua",
            "crunched": 0,
            "start": 38605749,
            "end": 38608061,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/sandbox/vampire.lua",
            "crunched": 0,
            "start": 38608061,
            "end": 38610253,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/skip_off.lua",
            "crunched": 0,
            "start": 38610253,
            "end": 38612124,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/speedrun.lua",
            "crunched": 0,
            "start": 38612124,
            "end": 38613848,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/bloodstone.lua",
            "crunched": 0,
            "start": 38613848,
            "end": 38615963,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/hanging_chad.lua",
            "crunched": 0,
            "start": 38615963,
            "end": 38616808,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/ice_cream.lua",
            "crunched": 0,
            "start": 38616808,
            "end": 38617928,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/seltzer.lua",
            "crunched": 0,
            "start": 38617928,
            "end": 38620145,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/ticket.lua",
            "crunched": 0,
            "start": 38620145,
            "end": 38622032,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/standard/turtle_bean.lua",
            "crunched": 0,
            "start": 38622032,
            "end": 38623336,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/jokers/taxes.lua",
            "crunched": 0,
            "start": 38623336,
            "end": 38624926,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/seals/mp_gold_seal.lua",
            "crunched": 0,
            "start": 38624926,
            "end": 38625225,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/00_planet.lua",
            "crunched": 0,
            "start": 38625225,
            "end": 38625906,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/01_spectral.lua",
            "crunched": 0,
            "start": 38625906,
            "end": 38626315,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/02_spectralplus.lua",
            "crunched": 0,
            "start": 38626315,
            "end": 38626681,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/1_plastic.lua",
            "crunched": 0,
            "start": 38626681,
            "end": 38629423,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/2_pebble.lua",
            "crunched": 0,
            "start": 38629423,
            "end": 38629857,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/3_ferrite.lua",
            "crunched": 0,
            "start": 38629857,
            "end": 38630280,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/4_pyrite.lua",
            "crunched": 0,
            "start": 38630280,
            "end": 38631270,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/5_jade.lua",
            "crunched": 0,
            "start": 38631270,
            "end": 38631698,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/6_crystal.lua",
            "crunched": 0,
            "start": 38631698,
            "end": 38632114,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/7_antimatter.lua",
            "crunched": 0,
            "start": 38632114,
            "end": 38632540,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stakes/atlas.lua",
            "crunched": 0,
            "start": 38632540,
            "end": 38632721,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/_stickers.lua",
            "crunched": 0,
            "start": 38632721,
            "end": 38635380,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/1_persistent.lua",
            "crunched": 0,
            "start": 38635380,
            "end": 38640058,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/2_unreliable.lua",
            "crunched": 0,
            "start": 38640058,
            "end": 38640540,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/3_draining.lua",
            "crunched": 0,
            "start": 38640540,
            "end": 38640913,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/balanced.lua",
            "crunched": 0,
            "start": 38640913,
            "end": 38641396,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/extra_credit.lua",
            "crunched": 0,
            "start": 38641396,
            "end": 38641610,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/stickers/nemesis.lua",
            "crunched": 0,
            "start": 38641610,
            "end": 38641883,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/tags/gambling_sandbox.lua",
            "crunched": 0,
            "start": 38641883,
            "end": 38643685,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/tags/investment_sandbox.lua",
            "crunched": 0,
            "start": 38643685,
            "end": 38644789,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/objects/tags/juggle_sandbox.lua",
            "crunched": 0,
            "start": 38644789,
            "end": 38645425,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/overrides/disable_restart.lua",
            "crunched": 0,
            "start": 38645425,
            "end": 38645595,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/overrides/game.lua",
            "crunched": 0,
            "start": 38645595,
            "end": 38651691,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/overrides/hide_content.lua",
            "crunched": 0,
            "start": 38651691,
            "end": 38653913,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/overrides/mod_badges.lua",
            "crunched": 0,
            "start": 38653913,
            "end": 38656849,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/README.md",
            "crunched": 0,
            "start": 38656849,
            "end": 38660194,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/replays/.gitkeep",
            "crunched": 0,
            "start": 38660194,
            "end": 38660194,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/_rulesets.lua",
            "crunched": 0,
            "start": 38660194,
            "end": 38671729,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/badlatro.lua",
            "crunched": 0,
            "start": 38671729,
            "end": 38672932,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/blitz.lua",
            "crunched": 0,
            "start": 38672932,
            "end": 38672999,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/chaos.lua",
            "crunched": 0,
            "start": 38672999,
            "end": 38673115,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/experimental/experimental_legacy.lua",
            "crunched": 0,
            "start": 38673115,
            "end": 38673760,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/experimental/experimental.lua",
            "crunched": 0,
            "start": 38673760,
            "end": 38674032,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/legacy_ranked.lua",
            "crunched": 0,
            "start": 38674032,
            "end": 38674160,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/majorleague.lua",
            "crunched": 0,
            "start": 38674160,
            "end": 38675020,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/minorleague.lua",
            "crunched": 0,
            "start": 38675020,
            "end": 38675633,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/ranked.lua",
            "crunched": 0,
            "start": 38675633,
            "end": 38675777,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/release.lua",
            "crunched": 0,
            "start": 38675777,
            "end": 38697558,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/sandbox.lua",
            "crunched": 0,
            "start": 38697558,
            "end": 38697831,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/smallworld.lua",
            "crunched": 0,
            "start": 38697831,
            "end": 38697917,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/speedlatro.lua",
            "crunched": 0,
            "start": 38697917,
            "end": 38698053,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/traditional.lua",
            "crunched": 0,
            "start": 38698053,
            "end": 38698285,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/vanilla.lua",
            "crunched": 0,
            "start": 38698285,
            "end": 38698644,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/rulesets/wsob.lua",
            "crunched": 0,
            "start": 38698644,
            "end": 38699416,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/scripts/release.sh",
            "crunched": 0,
            "start": 38699416,
            "end": 38705289,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/stylua.toml",
            "crunched": 0,
            "start": 38705289,
            "end": 38705642,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/readme.md",
            "crunched": 0,
            "start": 38705642,
            "end": 38708864,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/ruleset_shape.snapshot.lua",
            "crunched": 0,
            "start": 38708864,
            "end": 38726656,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/test_rlog_checksum.lua",
            "crunched": 0,
            "start": 38726656,
            "end": 38728968,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/test_rlog_roundtrip.lua",
            "crunched": 0,
            "start": 38728968,
            "end": 38734278,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/test_rlog_stream.lua",
            "crunched": 0,
            "start": 38734278,
            "end": 38737703,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/test_ruleset_shape.lua",
            "crunched": 0,
            "start": 38737703,
            "end": 38748700,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/tests/test_serialization_guard.lua",
            "crunched": 0,
            "start": 38748700,
            "end": 38751673,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/_common/background_grouping.lua",
            "crunched": 0,
            "start": 38751673,
            "end": 38752248,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/_common/disableable_button.lua",
            "crunched": 0,
            "start": 38752248,
            "end": 38753125,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/_common/disableable_option_cycle.lua",
            "crunched": 0,
            "start": 38753125,
            "end": 38753468,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/_common/disableable_toggle.lua",
            "crunched": 0,
            "start": 38753468,
            "end": 38754130,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/_common/spacer.lua",
            "crunched": 0,
            "start": 38754130,
            "end": 38754403,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/blind_chip_sprite.lua",
            "crunched": 0,
            "start": 38754403,
            "end": 38755071,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/blind_choice.lua",
            "crunched": 0,
            "start": 38755071,
            "end": 38769479,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/blind_hud.lua",
            "crunched": 0,
            "start": 38769479,
            "end": 38779970,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/confirmation.lua",
            "crunched": 0,
            "start": 38779970,
            "end": 38780890,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/enemy_location.lua",
            "crunched": 0,
            "start": 38780890,
            "end": 38787681,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/functions.lua",
            "crunched": 0,
            "start": 38787681,
            "end": 38802444,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/game_end.lua",
            "crunched": 0,
            "start": 38802444,
            "end": 38820340,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/game_state.lua",
            "crunched": 0,
            "start": 38820340,
            "end": 38840112,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/lobby_info.lua",
            "crunched": 0,
            "start": 38840112,
            "end": 38847937,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/round.lua",
            "crunched": 0,
            "start": 38847937,
            "end": 38851026,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/ruleset_info_menu.lua",
            "crunched": 0,
            "start": 38851026,
            "end": 38855224,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/game/timer.lua",
            "crunched": 0,
            "start": 38855224,
            "end": 38875157,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/_lobby_options/advanced_tab.lua",
            "crunched": 0,
            "start": 38875157,
            "end": 38879809,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/_lobby_options/gameplay_tab.lua",
            "crunched": 0,
            "start": 38879809,
            "end": 38880449,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/_lobby_options/main_options.lua",
            "crunched": 0,
            "start": 38880449,
            "end": 38884305,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/_lobby_options/modifiers_tab.lua",
            "crunched": 0,
            "start": 38884305,
            "end": 38887376,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/_lobby_options/options_tab.lua",
            "crunched": 0,
            "start": 38887376,
            "end": 38889989,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/deck_stake_button.lua",
            "crunched": 0,
            "start": 38889989,
            "end": 38891156,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/leave_button.lua",
            "crunched": 0,
            "start": 38891156,
            "end": 38891459,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/lobby_code_buttons.lua",
            "crunched": 0,
            "start": 38891459,
            "end": 38892052,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/lobby.lua",
            "crunched": 0,
            "start": 38892052,
            "end": 38908890,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/players_display.lua",
            "crunched": 0,
            "start": 38908890,
            "end": 38910170,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/start_ready_button.lua",
            "crunched": 0,
            "start": 38910170,
            "end": 38914596,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/lobby/version_mismatch_warning.lua",
            "crunched": 0,
            "start": 38914596,
            "end": 38918166,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/dev_warning.lua",
            "crunched": 0,
            "start": 38918166,
            "end": 38920406,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/main_menu.lua",
            "crunched": 0,
            "start": 38920406,
            "end": 38923091,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/_modifiers_overlay.lua",
            "crunched": 0,
            "start": 38923091,
            "end": 38925291,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/_mutators_wall.lua",
            "crunched": 0,
            "start": 38925291,
            "end": 38940449,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/_practice_options_overlay.lua",
            "crunched": 0,
            "start": 38940449,
            "end": 38942659,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/custom_ruleset_editor.lua",
            "crunched": 0,
            "start": 38942659,
            "end": 38951998,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/gamemode_selection.lua",
            "crunched": 0,
            "start": 38951998,
            "end": 38956817,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/ghost_replay_picker.lua",
            "crunched": 0,
            "start": 38956817,
            "end": 38976343,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/join_lobby_button.lua",
            "crunched": 0,
            "start": 38976343,
            "end": 38977181,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/play_button_callbacks.lua",
            "crunched": 0,
            "start": 38977181,
            "end": 38981457,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/play_button.lua",
            "crunched": 0,
            "start": 38981457,
            "end": 38983392,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/ruleset_selection.lua",
            "crunched": 0,
            "start": 38983392,
            "end": 39003866,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/play_button/weekly_interrupt.lua",
            "crunched": 0,
            "start": 39003866,
            "end": 39004838,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/title_card.lua",
            "crunched": 0,
            "start": 39004838,
            "end": 39008827,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/main_menu/version_display.lua",
            "crunched": 0,
            "start": 39008827,
            "end": 39009381,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/shortcuts_menu.lua",
            "crunched": 0,
            "start": 39009381,
            "end": 39014984,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/smods_menu/config_tab.lua",
            "crunched": 0,
            "start": 39014984,
            "end": 39018560,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/smods_menu/credits_tab.lua",
            "crunched": 0,
            "start": 39018560,
            "end": 39020031,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/smods_menu/customization_tab.lua",
            "crunched": 0,
            "start": 39020031,
            "end": 39024725,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/smods_menu/smods_menu.lua",
            "crunched": 0,
            "start": 39024725,
            "end": 39026166,
            "audio": false
        },
        {
            "filename": "/Mods/Multiplayer/ui/utils.lua",
            "crunched": 0,
            "start": 39026166,
            "end": 39029520,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/assets/1x/icon.png",
            "crunched": 0,
            "start": 39029520,
            "end": 39030930,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/assets/2x/icon.png",
            "crunched": 0,
            "start": 39030930,
            "end": 39032537,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/config.lua",
            "crunched": 0,
            "start": 39032537,
            "end": 39033195,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/localization/default.lua",
            "crunched": 0,
            "start": 39033195,
            "end": 39033433,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/lovely.toml",
            "crunched": 0,
            "start": 39033433,
            "end": 39038437,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/api.lua",
            "crunched": 0,
            "start": 39038437,
            "end": 39041202,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/base_compat.lua",
            "crunched": 0,
            "start": 39041202,
            "end": 39041576,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/config.lua",
            "crunched": 0,
            "start": 39041576,
            "end": 39056667,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/incantation_compat.lua",
            "crunched": 0,
            "start": 39056667,
            "end": 39057642,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/init.lua",
            "crunched": 0,
            "start": 39057642,
            "end": 39058958,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/jenlib.lua",
            "crunched": 0,
            "start": 39058958,
            "end": 39087971,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/main.lua",
            "crunched": 0,
            "start": 39087971,
            "end": 39117915,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/overflow_compat.lua",
            "crunched": 0,
            "start": 39117915,
            "end": 39118278,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/ui.lua",
            "crunched": 0,
            "start": 39118278,
            "end": 39164619,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/modules/vanilla_compat.lua",
            "crunched": 0,
            "start": 39164619,
            "end": 39167012,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/Noituus.json",
            "crunched": 0,
            "start": 39167012,
            "end": 39167441,
            "audio": false
        },
        {
            "filename": "/Mods/Noituus/Noituus.lua",
            "crunched": 0,
            "start": 39167441,
            "end": 39167841,
            "audio": false
        },
        {
            "filename": "/Mods/Nopeus/LICENSE",
            "crunched": 0,
            "start": 39167841,
            "end": 39203664,
            "audio": false
        },
        {
            "filename": "/Mods/Nopeus/lovely.toml",
            "crunched": 0,
            "start": 39203664,
            "end": 39205858,
            "audio": false
        },
        {
            "filename": "/Mods/Nopeus/Nopeus.lua",
            "crunched": 0,
            "start": 39205858,
            "end": 39214395,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/👀.png",
            "crunched": 0,
            "start": 39214395,
            "end": 39215480,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/all_in.png",
            "crunched": 0,
            "start": 39215480,
            "end": 39227289,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/alphonse.png",
            "crunched": 0,
            "start": 39227289,
            "end": 39239322,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/arrowace.png",
            "crunched": 0,
            "start": 39239322,
            "end": 39240238,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/backpack.png",
            "crunched": 0,
            "start": 39240238,
            "end": 39242224,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/bad_apple.png",
            "crunched": 0,
            "start": 39242224,
            "end": 39243228,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/bea.png",
            "crunched": 0,
            "start": 39243228,
            "end": 39254744,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/bluegem.png",
            "crunched": 0,
            "start": 39254744,
            "end": 39258392,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/bro_has_the_key.png",
            "crunched": 0,
            "start": 39258392,
            "end": 39259537,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/caixinha.png",
            "crunched": 0,
            "start": 39259537,
            "end": 39265008,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/calculator.png",
            "crunched": 0,
            "start": 39265008,
            "end": 39268278,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/calculator2.png",
            "crunched": 0,
            "start": 39268278,
            "end": 39269347,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/chatgpt.png",
            "crunched": 0,
            "start": 39269347,
            "end": 39276519,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/cinder_block.png",
            "crunched": 0,
            "start": 39276519,
            "end": 39277715,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/coloring_book.png",
            "crunched": 0,
            "start": 39277715,
            "end": 39283039,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/concrete.png",
            "crunched": 0,
            "start": 39283039,
            "end": 39284812,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/crafting_table.png",
            "crunched": 0,
            "start": 39284812,
            "end": 39287159,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/crafting_voucher.png",
            "crunched": 0,
            "start": 39287159,
            "end": 39288023,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/creditcard_inbuffonpack.png",
            "crunched": 0,
            "start": 39288023,
            "end": 39290624,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/cryptid_reference.png",
            "crunched": 0,
            "start": 39290624,
            "end": 39293708,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/d100.png",
            "crunched": 0,
            "start": 39293708,
            "end": 39302840,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/diamond_tester.png",
            "crunched": 0,
            "start": 39302840,
            "end": 39303664,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/diamond.png",
            "crunched": 0,
            "start": 39303664,
            "end": 39306319,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/disco.png",
            "crunched": 0,
            "start": 39306319,
            "end": 39315733,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/dubai_chocolate.png",
            "crunched": 0,
            "start": 39315733,
            "end": 39317031,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/embed_fail_card.png",
            "crunched": 0,
            "start": 39317031,
            "end": 39317624,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/embed_fail.png",
            "crunched": 0,
            "start": 39317624,
            "end": 39318460,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/epic_games.png",
            "crunched": 0,
            "start": 39318460,
            "end": 39319195,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/error.png",
            "crunched": 0,
            "start": 39319195,
            "end": 39320619,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/fake_png.png",
            "crunched": 0,
            "start": 39320619,
            "end": 39321883,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/formula.png",
            "crunched": 0,
            "start": 39321883,
            "end": 39323053,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/fortnite.png",
            "crunched": 0,
            "start": 39323053,
            "end": 39329561,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/foto.png",
            "crunched": 0,
            "start": 39329561,
            "end": 39330774,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/foto2.png",
            "crunched": 0,
            "start": 39330774,
            "end": 39343229,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/free_wifi.png",
            "crunched": 0,
            "start": 39343229,
            "end": 39344142,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/frutiger_aero.png",
            "crunched": 0,
            "start": 39344142,
            "end": 39358753,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/fuckass_dog.png",
            "crunched": 0,
            "start": 39358753,
            "end": 39375320,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/gambling.png",
            "crunched": 0,
            "start": 39375320,
            "end": 39377448,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/gaster.png",
            "crunched": 0,
            "start": 39377448,
            "end": 39383727,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/golden_cookie.png",
            "crunched": 0,
            "start": 39383727,
            "end": 39396804,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/goodbelisk.png",
            "crunched": 0,
            "start": 39396804,
            "end": 39402886,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/gravestone.png",
            "crunched": 0,
            "start": 39402886,
            "end": 39413617,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/greg_materials.png",
            "crunched": 0,
            "start": 39413617,
            "end": 39425829,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/greg_pack.png",
            "crunched": 0,
            "start": 39425829,
            "end": 39433321,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/gregdeck.png",
            "crunched": 0,
            "start": 39433321,
            "end": 39439125,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/gregorius.png",
            "crunched": 0,
            "start": 39439125,
            "end": 39440186,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/h&s.png",
            "crunched": 0,
            "start": 39440186,
            "end": 39441994,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/HTML_pro.png",
            "crunched": 0,
            "start": 39441994,
            "end": 39443212,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/icon.png",
            "crunched": 0,
            "start": 39443212,
            "end": 39443944,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/infinity.png",
            "crunched": 0,
            "start": 39443944,
            "end": 39445974,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/job.png",
            "crunched": 0,
            "start": 39445974,
            "end": 39448538,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/jumbo_omega_pack.png",
            "crunched": 0,
            "start": 39448538,
            "end": 39451989,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/jv.png",
            "crunched": 0,
            "start": 39451989,
            "end": 39461398,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/keep_gambling.png",
            "crunched": 0,
            "start": 39461398,
            "end": 39474305,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/labubu_joker.png",
            "crunched": 0,
            "start": 39474305,
            "end": 39485232,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/le_triangle.png",
            "crunched": 0,
            "start": 39485232,
            "end": 39497392,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/local58.png",
            "crunched": 0,
            "start": 39497392,
            "end": 39506501,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/loss.png",
            "crunched": 0,
            "start": 39506501,
            "end": 39507096,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/mega_omega_pack.png",
            "crunched": 0,
            "start": 39507096,
            "end": 39510839,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/minecraft.png",
            "crunched": 0,
            "start": 39510839,
            "end": 39512529,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/mmorpg.png",
            "crunched": 0,
            "start": 39512529,
            "end": 39513739,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/moche.png",
            "crunched": 0,
            "start": 39513739,
            "end": 39528205,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/ms_paint.png",
            "crunched": 0,
            "start": 39528205,
            "end": 39532774,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/multiple_choice.png",
            "crunched": 0,
            "start": 39532774,
            "end": 39534010,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/negation.png",
            "crunched": 0,
            "start": 39534010,
            "end": 39535247,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/netherite.png",
            "crunched": 0,
            "start": 39535247,
            "end": 39536163,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/nft.png",
            "crunched": 0,
            "start": 39536163,
            "end": 39537551,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/nuke.png",
            "crunched": 0,
            "start": 39537551,
            "end": 39542588,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/obsidian.png",
            "crunched": 0,
            "start": 39542588,
            "end": 39550431,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_deck.png",
            "crunched": 0,
            "start": 39550431,
            "end": 39552544,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_joker.png",
            "crunched": 0,
            "start": 39552544,
            "end": 39558353,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_pack.png",
            "crunched": 0,
            "start": 39558353,
            "end": 39561363,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_suit.png",
            "crunched": 0,
            "start": 39561363,
            "end": 39579613,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_ui.png",
            "crunched": 0,
            "start": 39579613,
            "end": 39580132,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/omega_voucher.png",
            "crunched": 0,
            "start": 39580132,
            "end": 39581591,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/optimally_packed.png",
            "crunched": 0,
            "start": 39581591,
            "end": 39582532,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/os_maias.png",
            "crunched": 0,
            "start": 39582532,
            "end": 39583996,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/pass.png",
            "crunched": 0,
            "start": 39583996,
            "end": 39584763,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/pegi18.png",
            "crunched": 0,
            "start": 39584763,
            "end": 39585456,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/petrification_device.png",
            "crunched": 0,
            "start": 39585456,
            "end": 39592218,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/phone.png",
            "crunched": 0,
            "start": 39592218,
            "end": 39640070,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/photograph_fixed.png",
            "crunched": 0,
            "start": 39640070,
            "end": 39648938,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/pi.png",
            "crunched": 0,
            "start": 39648938,
            "end": 39654476,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/prophecy.png",
            "crunched": 0,
            "start": 39654476,
            "end": 39665366,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/rabbit_clock.png",
            "crunched": 0,
            "start": 39665366,
            "end": 39666756,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/rainbow.png",
            "crunched": 0,
            "start": 39666756,
            "end": 39667907,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/reboot_card.png",
            "crunched": 0,
            "start": 39667907,
            "end": 39672061,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/redacted.png",
            "crunched": 0,
            "start": 39672061,
            "end": 39672967,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/reinforced.png",
            "crunched": 0,
            "start": 39672967,
            "end": 39673956,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/rigged.png",
            "crunched": 0,
            "start": 39673956,
            "end": 39681761,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/rixy.png",
            "crunched": 0,
            "start": 39681761,
            "end": 39692747,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/rtl.png",
            "crunched": 0,
            "start": 39692747,
            "end": 39693987,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/scaling.png",
            "crunched": 0,
            "start": 39693987,
            "end": 39695298,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/sigil_joker.png",
            "crunched": 0,
            "start": 39695298,
            "end": 39696247,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/sigil.png",
            "crunched": 0,
            "start": 39696247,
            "end": 39697132,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/simp.png",
            "crunched": 0,
            "start": 39697132,
            "end": 39702748,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/slothful.png",
            "crunched": 0,
            "start": 39702748,
            "end": 39707255,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/squared.png",
            "crunched": 0,
            "start": 39707255,
            "end": 39713185,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/star_sticker.png",
            "crunched": 0,
            "start": 39713185,
            "end": 39713747,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/swapping.png",
            "crunched": 0,
            "start": 39713747,
            "end": 39716853,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/template thunder.png",
            "crunched": 0,
            "start": 39716853,
            "end": 39718334,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/thatcher.png",
            "crunched": 0,
            "start": 39718334,
            "end": 39719518,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/the_gathering.png",
            "crunched": 0,
            "start": 39719518,
            "end": 39721038,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/the_solo.png",
            "crunched": 0,
            "start": 39721038,
            "end": 39722527,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/the_squad.png",
            "crunched": 0,
            "start": 39722527,
            "end": 39724032,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/the_twins.png",
            "crunched": 0,
            "start": 39724032,
            "end": 39725556,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/titlescreen.png",
            "crunched": 0,
            "start": 39725556,
            "end": 39727241,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/toilet_paper.png",
            "crunched": 0,
            "start": 39727241,
            "end": 39732916,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/tycoon.png",
            "crunched": 0,
            "start": 39732916,
            "end": 39733957,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/unope_pack.png",
            "crunched": 0,
            "start": 39733957,
            "end": 39735660,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/upgrade.png",
            "crunched": 0,
            "start": 39735660,
            "end": 39736962,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/upgraded_deck.png",
            "crunched": 0,
            "start": 39736962,
            "end": 39739218,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/verity_mad.png",
            "crunched": 0,
            "start": 39739218,
            "end": 39742725,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/verity.png",
            "crunched": 0,
            "start": 39742725,
            "end": 39746219,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/waffle.png",
            "crunched": 0,
            "start": 39746219,
            "end": 39759801,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/webdriver.png",
            "crunched": 0,
            "start": 39759801,
            "end": 39760414,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/wild.png",
            "crunched": 0,
            "start": 39760414,
            "end": 39767108,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/wind.png",
            "crunched": 0,
            "start": 39767108,
            "end": 39776007,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/windtrackball.png",
            "crunched": 0,
            "start": 39776007,
            "end": 39776960,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/wordle.png",
            "crunched": 0,
            "start": 39776960,
            "end": 39778000,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/1x/yeah.png",
            "crunched": 0,
            "start": 39778000,
            "end": 39781851,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/👀.png",
            "crunched": 0,
            "start": 39781851,
            "end": 39783308,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/all_in.png",
            "crunched": 0,
            "start": 39783308,
            "end": 39797904,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/alphonse.png",
            "crunched": 0,
            "start": 39797904,
            "end": 39813402,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/arrowace.png",
            "crunched": 0,
            "start": 39813402,
            "end": 39814527,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/backpack.png",
            "crunched": 0,
            "start": 39814527,
            "end": 39818305,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/bea.png",
            "crunched": 0,
            "start": 39818305,
            "end": 39833251,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/bluegem.png",
            "crunched": 0,
            "start": 39833251,
            "end": 39839923,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/bro_has_the_key.png",
            "crunched": 0,
            "start": 39839923,
            "end": 39841318,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/caixinha.png",
            "crunched": 0,
            "start": 39841318,
            "end": 39848728,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/calculator.png",
            "crunched": 0,
            "start": 39848728,
            "end": 39852694,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/calculator2.png",
            "crunched": 0,
            "start": 39852694,
            "end": 39854145,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/chatgpt.png",
            "crunched": 0,
            "start": 39854145,
            "end": 39863794,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/cinder_block.png",
            "crunched": 0,
            "start": 39863794,
            "end": 39865280,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/coloring_book.png",
            "crunched": 0,
            "start": 39865280,
            "end": 39872173,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/concrete.png",
            "crunched": 0,
            "start": 39872173,
            "end": 39874555,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/crafting_table.png",
            "crunched": 0,
            "start": 39874555,
            "end": 39879131,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/crafting_voucher.png",
            "crunched": 0,
            "start": 39879131,
            "end": 39880244,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/creditcard_inbuffonpack.png",
            "crunched": 0,
            "start": 39880244,
            "end": 39883393,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/cryptid_reference.png",
            "crunched": 0,
            "start": 39883393,
            "end": 39898515,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/d100.png",
            "crunched": 0,
            "start": 39898515,
            "end": 39927535,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/diamond.png",
            "crunched": 0,
            "start": 39927535,
            "end": 39931361,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/disco.png",
            "crunched": 0,
            "start": 39931361,
            "end": 39963926,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/dubai_chocolate.png",
            "crunched": 0,
            "start": 39963926,
            "end": 39965590,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/embed_fail_card.png",
            "crunched": 0,
            "start": 39965590,
            "end": 39966328,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/embed_fail.png",
            "crunched": 0,
            "start": 39966328,
            "end": 39967381,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/epic_games.png",
            "crunched": 0,
            "start": 39967381,
            "end": 39968439,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/error.png",
            "crunched": 0,
            "start": 39968439,
            "end": 39971479,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/formula.png",
            "crunched": 0,
            "start": 39971479,
            "end": 39972904,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/fortnite.png",
            "crunched": 0,
            "start": 39972904,
            "end": 39981531,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/foto.png",
            "crunched": 0,
            "start": 39981531,
            "end": 39982997,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/foto2.png",
            "crunched": 0,
            "start": 39982997,
            "end": 40000144,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/free_wifi.png",
            "crunched": 0,
            "start": 40000144,
            "end": 40001287,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/frutiger_aero.png",
            "crunched": 0,
            "start": 40001287,
            "end": 40020605,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/fuckass_dog.png",
            "crunched": 0,
            "start": 40020605,
            "end": 40077450,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/gambling.png",
            "crunched": 0,
            "start": 40077450,
            "end": 40079919,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/gaster.png",
            "crunched": 0,
            "start": 40079919,
            "end": 40088583,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/golden_cookie.png",
            "crunched": 0,
            "start": 40088583,
            "end": 40107152,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/goodbelisk.png",
            "crunched": 0,
            "start": 40107152,
            "end": 40115254,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/gravestone.png",
            "crunched": 0,
            "start": 40115254,
            "end": 40133338,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/greg_materials.png",
            "crunched": 0,
            "start": 40133338,
            "end": 40152383,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/greg_pack.png",
            "crunched": 0,
            "start": 40152383,
            "end": 40162829,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/gregdeck.png",
            "crunched": 0,
            "start": 40162829,
            "end": 40171159,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/gregorius.png",
            "crunched": 0,
            "start": 40171159,
            "end": 40172510,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/h&s.png",
            "crunched": 0,
            "start": 40172510,
            "end": 40175136,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/HTML_pro.png",
            "crunched": 0,
            "start": 40175136,
            "end": 40176817,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/icon.png",
            "crunched": 0,
            "start": 40176817,
            "end": 40177614,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/infinity.png",
            "crunched": 0,
            "start": 40177614,
            "end": 40180093,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/job.png",
            "crunched": 0,
            "start": 40180093,
            "end": 40183300,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/jumbo_omega_pack.png",
            "crunched": 0,
            "start": 40183300,
            "end": 40188009,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/jv.png",
            "crunched": 0,
            "start": 40188009,
            "end": 40200807,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/keep_gambling.png",
            "crunched": 0,
            "start": 40200807,
            "end": 40243614,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/labubu_joker.png",
            "crunched": 0,
            "start": 40243614,
            "end": 40279607,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/le_triangle.png",
            "crunched": 0,
            "start": 40279607,
            "end": 40296920,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/local58.png",
            "crunched": 0,
            "start": 40296920,
            "end": 40309599,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/loss.png",
            "crunched": 0,
            "start": 40309599,
            "end": 40310372,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/mega_omega_pack.png",
            "crunched": 0,
            "start": 40310372,
            "end": 40315597,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/minecraft.png",
            "crunched": 0,
            "start": 40315597,
            "end": 40317873,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/mmorpg.png",
            "crunched": 0,
            "start": 40317873,
            "end": 40319490,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/moche.png",
            "crunched": 0,
            "start": 40319490,
            "end": 40370503,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/ms_paint.png",
            "crunched": 0,
            "start": 40370503,
            "end": 40376346,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/multiple_choice.png",
            "crunched": 0,
            "start": 40376346,
            "end": 40377976,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/negation.png",
            "crunched": 0,
            "start": 40377976,
            "end": 40379567,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/nft.png",
            "crunched": 0,
            "start": 40379567,
            "end": 40381276,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/nuke.png",
            "crunched": 0,
            "start": 40381276,
            "end": 40388131,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/obsidian.png",
            "crunched": 0,
            "start": 40388131,
            "end": 40395133,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_deck.png",
            "crunched": 0,
            "start": 40395133,
            "end": 40397558,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_joker.png",
            "crunched": 0,
            "start": 40397558,
            "end": 40405065,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_pack.png",
            "crunched": 0,
            "start": 40405065,
            "end": 40408892,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_suit.png",
            "crunched": 0,
            "start": 40408892,
            "end": 40433663,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_ui.png",
            "crunched": 0,
            "start": 40433663,
            "end": 40434221,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/omega_voucher.png",
            "crunched": 0,
            "start": 40434221,
            "end": 40436092,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/optimally_packed.png",
            "crunched": 0,
            "start": 40436092,
            "end": 40437277,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/os_maias.png",
            "crunched": 0,
            "start": 40437277,
            "end": 40439115,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/pass.png",
            "crunched": 0,
            "start": 40439115,
            "end": 40440076,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/pegi18.png",
            "crunched": 0,
            "start": 40440076,
            "end": 40440998,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/petrification_device.png",
            "crunched": 0,
            "start": 40440998,
            "end": 40449628,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/phone.png",
            "crunched": 0,
            "start": 40449628,
            "end": 40515659,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/photograph_fixed.png",
            "crunched": 0,
            "start": 40515659,
            "end": 40526982,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/pi.png",
            "crunched": 0,
            "start": 40526982,
            "end": 40534967,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/prophecy.png",
            "crunched": 0,
            "start": 40534967,
            "end": 40548045,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/rabbit_clock.png",
            "crunched": 0,
            "start": 40548045,
            "end": 40549804,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/rainbow.png",
            "crunched": 0,
            "start": 40549804,
            "end": 40551177,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/reboot_card.png",
            "crunched": 0,
            "start": 40551177,
            "end": 40556159,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/redacted.png",
            "crunched": 0,
            "start": 40556159,
            "end": 40557294,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/reinforced.png",
            "crunched": 0,
            "start": 40557294,
            "end": 40558955,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/rigged.png",
            "crunched": 0,
            "start": 40558955,
            "end": 40570214,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/rixy.png",
            "crunched": 0,
            "start": 40570214,
            "end": 40584904,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/rtl.png",
            "crunched": 0,
            "start": 40584904,
            "end": 40586421,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/scaling.png",
            "crunched": 0,
            "start": 40586421,
            "end": 40588133,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/sigil_joker.png",
            "crunched": 0,
            "start": 40588133,
            "end": 40602128,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/sigil.png",
            "crunched": 0,
            "start": 40602128,
            "end": 40612899,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/simp.png",
            "crunched": 0,
            "start": 40612899,
            "end": 40620833,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/slothful.png",
            "crunched": 0,
            "start": 40620833,
            "end": 40626708,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/squared.png",
            "crunched": 0,
            "start": 40626708,
            "end": 40635183,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/star_sticker.png",
            "crunched": 0,
            "start": 40635183,
            "end": 40635919,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/swapping.png",
            "crunched": 0,
            "start": 40635919,
            "end": 40640326,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/thatcher.png",
            "crunched": 0,
            "start": 40640326,
            "end": 40641781,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/the_gathering.png",
            "crunched": 0,
            "start": 40641781,
            "end": 40643682,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/the_solo.png",
            "crunched": 0,
            "start": 40643682,
            "end": 40645559,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/the_squad.png",
            "crunched": 0,
            "start": 40645559,
            "end": 40647456,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/the_twins.png",
            "crunched": 0,
            "start": 40647456,
            "end": 40649355,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/titlescreen.png",
            "crunched": 0,
            "start": 40649355,
            "end": 40651423,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/toilet_paper.png",
            "crunched": 0,
            "start": 40651423,
            "end": 40668527,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/tycoon.png",
            "crunched": 0,
            "start": 40668527,
            "end": 40669817,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/unope_pack.png",
            "crunched": 0,
            "start": 40669817,
            "end": 40671915,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/upgrade.png",
            "crunched": 0,
            "start": 40671915,
            "end": 40673801,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/upgraded_deck.png",
            "crunched": 0,
            "start": 40673801,
            "end": 40676384,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/verity_mad.png",
            "crunched": 0,
            "start": 40676384,
            "end": 40680249,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/verity.png",
            "crunched": 0,
            "start": 40680249,
            "end": 40684108,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/waffle.png",
            "crunched": 0,
            "start": 40684108,
            "end": 40727466,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/webdriver.png",
            "crunched": 0,
            "start": 40727466,
            "end": 40728251,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/wild.png",
            "crunched": 0,
            "start": 40728251,
            "end": 40737890,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/wind.png",
            "crunched": 0,
            "start": 40737890,
            "end": 40763735,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/windtrackball.png",
            "crunched": 0,
            "start": 40763735,
            "end": 40764898,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/2x/wordle.png",
            "crunched": 0,
            "start": 40764898,
            "end": 40766290,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Birthlong.ttf",
            "crunched": 0,
            "start": 40766290,
            "end": 40800578,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Comic Sans.ttf",
            "crunched": 0,
            "start": 40800578,
            "end": 41046178,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/LuckiestGuy.ttf",
            "crunched": 0,
            "start": 41046178,
            "end": 41104502,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/PUSAB.ttf",
            "crunched": 0,
            "start": 41104502,
            "end": 41161498,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Renogare.ttf",
            "crunched": 0,
            "start": 41161498,
            "end": 41301570,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Satisfontory.ttf",
            "crunched": 0,
            "start": 41301570,
            "end": 41307758,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Symbola.ttf",
            "crunched": 0,
            "start": 41307758,
            "end": 43547858,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/times.ttf",
            "crunched": 0,
            "start": 43547858,
            "end": 43895846,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/fonts/Wingdings.ttf",
            "crunched": 0,
            "start": 43895846,
            "end": 43963938,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/sounds/d100.ogg",
            "crunched": 0,
            "start": 43963938,
            "end": 43979596,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/sounds/holdup.ogg",
            "crunched": 0,
            "start": 43979596,
            "end": 44009028,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/sounds/music_labubu.ogg",
            "crunched": 0,
            "start": 44009028,
            "end": 45125519,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/assets/sounds/ok.ogg",
            "crunched": 0,
            "start": 45125519,
            "end": 45146538,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/crashes.txt",
            "crunched": 0,
            "start": 45146538,
            "end": 45146541,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/boosters.lua",
            "crunched": 0,
            "start": 45146541,
            "end": 45152654,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/consumables.lua",
            "crunched": 0,
            "start": 45152654,
            "end": 45169592,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/decks.lua",
            "crunched": 0,
            "start": 45169592,
            "end": 45171762,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/enchancers.lua",
            "crunched": 0,
            "start": 45171762,
            "end": 45182867,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/jokers.lua",
            "crunched": 0,
            "start": 45182867,
            "end": 45291198,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/menu.lua",
            "crunched": 0,
            "start": 45291198,
            "end": 45293814,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/suit_and_rarity.lua",
            "crunched": 0,
            "start": 45293814,
            "end": 45294745,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/items/vouchers.lua",
            "crunched": 0,
            "start": 45294745,
            "end": 45295834,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/main.lua",
            "crunched": 0,
            "start": 45295834,
            "end": 45301148,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/mod.json",
            "crunched": 0,
            "start": 45301148,
            "end": 45301567,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/rtl_posts.txt",
            "crunched": 0,
            "start": 45301567,
            "end": 45301571,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/sounds/gold_click.ogg",
            "crunched": 0,
            "start": 45301571,
            "end": 45313408,
            "audio": false
        },
        {
            "filename": "/Mods/Omegatro/sounds/ok.ogg",
            "crunched": 0,
            "start": 45313408,
            "end": 45334427,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/b_jen_decks.png",
            "crunched": 0,
            "start": 45334427,
            "end": 45443793,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/bl_jen_blinds.png",
            "crunched": 0,
            "start": 45443793,
            "end": 45460579,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/bl_jen_epic_blinds.png",
            "crunched": 0,
            "start": 45460579,
            "end": 46076255,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/bl_jen_legendary_crimson_heart.png",
            "crunched": 0,
            "start": 46076255,
            "end": 46675480,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_acc.png",
            "crunched": 0,
            "start": 46675480,
            "end": 46742748,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_artificer.png",
            "crunched": 0,
            "start": 46742748,
            "end": 46748444,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_blanks.png",
            "crunched": 0,
            "start": 46748444,
            "end": 46749972,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_bottles.png",
            "crunched": 0,
            "start": 46749972,
            "end": 46752641,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_consumables1.png",
            "crunched": 0,
            "start": 46752641,
            "end": 46772852,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_consumables2.png",
            "crunched": 0,
            "start": 46772852,
            "end": 46793063,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_consumables3.png",
            "crunched": 0,
            "start": 46793063,
            "end": 46813274,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_fuse.png",
            "crunched": 0,
            "start": 46813274,
            "end": 46821291,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_goob.png",
            "crunched": 0,
            "start": 46821291,
            "end": 46825091,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_greyhole.png",
            "crunched": 0,
            "start": 46825091,
            "end": 46825773,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_hoxxes.png",
            "crunched": 0,
            "start": 46825773,
            "end": 46826767,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_huge.png",
            "crunched": 0,
            "start": 46826767,
            "end": 46828204,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_nyx.png",
            "crunched": 0,
            "start": 46828204,
            "end": 46840021,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_omegaplanets.png",
            "crunched": 0,
            "start": 46840021,
            "end": 47041760,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_omegaspectrals.png",
            "crunched": 0,
            "start": 47041760,
            "end": 47168219,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_omegatarots.png",
            "crunched": 0,
            "start": 47168219,
            "end": 47397358,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_planets.png",
            "crunched": 0,
            "start": 47397358,
            "end": 47499918,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_reversetarots.png",
            "crunched": 0,
            "start": 47499918,
            "end": 47557749,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_swabbie.png",
            "crunched": 0,
            "start": 47557749,
            "end": 47567315,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_tokens.png",
            "crunched": 0,
            "start": 47567315,
            "end": 47643814,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_uno.png",
            "crunched": 0,
            "start": 47643814,
            "end": 47683671,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/c_jen_yawetag.png",
            "crunched": 0,
            "start": 47683671,
            "end": 47686649,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/enemy_jen_goob.png",
            "crunched": 0,
            "start": 47686649,
            "end": 47694058,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/iamjustsittinghere.png",
            "crunched": 0,
            "start": 47694058,
            "end": 47715022,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_7granddad.png",
            "crunched": 0,
            "start": 47715022,
            "end": 47717153,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_alice.png",
            "crunched": 0,
            "start": 47717153,
            "end": 47726230,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_amalgam.png",
            "crunched": 0,
            "start": 47726230,
            "end": 47727160,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_artificer.png",
            "crunched": 0,
            "start": 47727160,
            "end": 47730460,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_astro.png",
            "crunched": 0,
            "start": 47730460,
            "end": 47738540,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_aym.png",
            "crunched": 0,
            "start": 47738540,
            "end": 47743530,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_baal.png",
            "crunched": 0,
            "start": 47743530,
            "end": 47748908,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_bhdoohickey.png",
            "crunched": 0,
            "start": 47748908,
            "end": 47749838,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_blighter.png",
            "crunched": 0,
            "start": 47749838,
            "end": 47759245,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_boosterdoohickey.png",
            "crunched": 0,
            "start": 47759245,
            "end": 47760529,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_boxten.png",
            "crunched": 0,
            "start": 47760529,
            "end": 47762919,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_bulwark.png",
            "crunched": 0,
            "start": 47762919,
            "end": 47778921,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_charred.png",
            "crunched": 0,
            "start": 47778921,
            "end": 47799815,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_cheese.png",
            "crunched": 0,
            "start": 47799815,
            "end": 47803473,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_chemach.png",
            "crunched": 0,
            "start": 47803473,
            "end": 47804757,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_chester.png",
            "crunched": 0,
            "start": 47804757,
            "end": 47813476,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_cilantro.png",
            "crunched": 0,
            "start": 47813476,
            "end": 47828022,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_clauneck.png",
            "crunched": 0,
            "start": 47828022,
            "end": 47829306,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_codedoohickey.png",
            "crunched": 0,
            "start": 47829306,
            "end": 47830837,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_connie.png",
            "crunched": 0,
            "start": 47830837,
            "end": 47839761,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_consumeabledoohickey.png",
            "crunched": 0,
            "start": 47839761,
            "end": 47841045,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_cosmo.png",
            "crunched": 0,
            "start": 47841045,
            "end": 47850390,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_cracked.png",
            "crunched": 0,
            "start": 47850390,
            "end": 47867857,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_crimbo.png",
            "crunched": 0,
            "start": 47867857,
            "end": 47875881,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_crystal.png",
            "crunched": 0,
            "start": 47875881,
            "end": 47888060,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_dandy.png",
            "crunched": 0,
            "start": 47888060,
            "end": 47907335,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_datura.png",
            "crunched": 0,
            "start": 47907335,
            "end": 47921004,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_drago.png",
            "crunched": 0,
            "start": 47921004,
            "end": 47927049,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_dragofiend.png",
            "crunched": 0,
            "start": 47927049,
            "end": 47933557,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_escapey.png",
            "crunched": 0,
            "start": 47933557,
            "end": 47935854,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_faceless.png",
            "crunched": 0,
            "start": 47935854,
            "end": 47944403,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_finn.png",
            "crunched": 0,
            "start": 47944403,
            "end": 47948131,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_foundry.png",
            "crunched": 0,
            "start": 47948131,
            "end": 47959897,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_gamingchair.png",
            "crunched": 0,
            "start": 47959897,
            "end": 47969568,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_glisten.png",
            "crunched": 0,
            "start": 47969568,
            "end": 47978053,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_godsmarble.png",
            "crunched": 0,
            "start": 47978053,
            "end": 48006001,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_goob_lefthand.png",
            "crunched": 0,
            "start": 48006001,
            "end": 48008111,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_goob_righthand.png",
            "crunched": 0,
            "start": 48008111,
            "end": 48010207,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_goob.png",
            "crunched": 0,
            "start": 48010207,
            "end": 48014658,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_gourmand.png",
            "crunched": 0,
            "start": 48014658,
            "end": 48016766,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_haro.png",
            "crunched": 0,
            "start": 48016766,
            "end": 48018050,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_heket.png",
            "crunched": 0,
            "start": 48018050,
            "end": 48037431,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_honey.png",
            "crunched": 0,
            "start": 48037431,
            "end": 48042076,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_hunter.png",
            "crunched": 0,
            "start": 48042076,
            "end": 48053077,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_indusblue.png",
            "crunched": 0,
            "start": 48053077,
            "end": 48067222,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_inhabited.png",
            "crunched": 0,
            "start": 48067222,
            "end": 48091724,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_jeremy.png",
            "crunched": 0,
            "start": 48091724,
            "end": 48095457,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_jimbo.png",
            "crunched": 0,
            "start": 48095457,
            "end": 48102539,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_kaleido.png",
            "crunched": 0,
            "start": 48102539,
            "end": 48105426,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_kallamar.png",
            "crunched": 0,
            "start": 48105426,
            "end": 48106710,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_kori.png",
            "crunched": 0,
            "start": 48106710,
            "end": 48122138,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_kosmos.png",
            "crunched": 0,
            "start": 48122138,
            "end": 48135250,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_kudaai.png",
            "crunched": 0,
            "start": 48135250,
            "end": 48136180,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_lamb.png",
            "crunched": 0,
            "start": 48136180,
            "end": 48137464,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_landa.png",
            "crunched": 0,
            "start": 48137464,
            "end": 48152582,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_leshy.png",
            "crunched": 0,
            "start": 48152582,
            "end": 48156894,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_lugia.png",
            "crunched": 0,
            "start": 48156894,
            "end": 48163498,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_luke.png",
            "crunched": 0,
            "start": 48163498,
            "end": 48164782,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_math.png",
            "crunched": 0,
            "start": 48164782,
            "end": 48170350,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_maxie.png",
            "crunched": 0,
            "start": 48170350,
            "end": 48174722,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_monk.png",
            "crunched": 0,
            "start": 48174722,
            "end": 48176837,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_multi.png",
            "crunched": 0,
            "start": 48176837,
            "end": 48183779,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_narinder.png",
            "crunched": 0,
            "start": 48183779,
            "end": 48185063,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_negativedoohickey.png",
            "crunched": 0,
            "start": 48185063,
            "end": 48186347,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_nexus.png",
            "crunched": 0,
            "start": 48186347,
            "end": 48203407,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_noise.png",
            "crunched": 0,
            "start": 48203407,
            "end": 48207381,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_nubby.png",
            "crunched": 0,
            "start": 48207381,
            "end": 48210607,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_nyx.png",
            "crunched": 0,
            "start": 48210607,
            "end": 48222421,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_omegadoohickey.png",
            "crunched": 0,
            "start": 48222421,
            "end": 48223705,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_onewhowaits.png",
            "crunched": 0,
            "start": 48223705,
            "end": 48224989,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_oxy.png",
            "crunched": 0,
            "start": 48224989,
            "end": 48238547,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_p03.png",
            "crunched": 0,
            "start": 48238547,
            "end": 48239831,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_paragon.png",
            "crunched": 0,
            "start": 48239831,
            "end": 48258688,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_peppino.png",
            "crunched": 0,
            "start": 48258688,
            "end": 48261866,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_pickel.png",
            "crunched": 0,
            "start": 48261866,
            "end": 48265629,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_pixel.png",
            "crunched": 0,
            "start": 48265629,
            "end": 48270501,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_planetleveldoohickey.png",
            "crunched": 0,
            "start": 48270501,
            "end": 48271785,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_pldoohickey.png",
            "crunched": 0,
            "start": 48271785,
            "end": 48272715,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_queen.png",
            "crunched": 0,
            "start": 48272715,
            "end": 48289596,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_ratau.png",
            "crunched": 0,
            "start": 48289596,
            "end": 48290880,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_razzledazzle.png",
            "crunched": 0,
            "start": 48290880,
            "end": 48296807,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_rivulet.png",
            "crunched": 0,
            "start": 48296807,
            "end": 48302774,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_rot.png",
            "crunched": 0,
            "start": 48302774,
            "end": 48306252,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_ruler.png",
            "crunched": 0,
            "start": 48306252,
            "end": 48307536,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_saint.png",
            "crunched": 0,
            "start": 48307536,
            "end": 48317138,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_sappy.png",
            "crunched": 0,
            "start": 48317138,
            "end": 48320349,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_shamura.png",
            "crunched": 0,
            "start": 48320349,
            "end": 48321633,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_sigil.png",
            "crunched": 0,
            "start": 48321633,
            "end": 48333564,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_slayer.png",
            "crunched": 0,
            "start": 48333564,
            "end": 48334848,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_sleveldoohickey.png",
            "crunched": 0,
            "start": 48334848,
            "end": 48336132,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_spearmaster.png",
            "crunched": 0,
            "start": 48336132,
            "end": 48339485,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_spectraldoohickey.png",
            "crunched": 0,
            "start": 48339485,
            "end": 48340415,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_survivor.png",
            "crunched": 0,
            "start": 48340415,
            "end": 48342532,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_swabbie.png",
            "crunched": 0,
            "start": 48342532,
            "end": 48352110,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_tarotdoohickey.png",
            "crunched": 0,
            "start": 48352110,
            "end": 48353040,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_thomas.png",
            "crunched": 0,
            "start": 48353040,
            "end": 48355908,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_toodles.png",
            "crunched": 0,
            "start": 48355908,
            "end": 48358748,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_urizyth.png",
            "crunched": 0,
            "start": 48358748,
            "end": 48375062,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_vacuum.png",
            "crunched": 0,
            "start": 48375062,
            "end": 48396157,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_warlord.png",
            "crunched": 0,
            "start": 48396157,
            "end": 48397441,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/j_jen_zignorp.png",
            "crunched": 0,
            "start": 48397441,
            "end": 48410398,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_bishop.png",
            "crunched": 0,
            "start": 48410398,
            "end": 48446789,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_legend.png",
            "crunched": 0,
            "start": 48446789,
            "end": 48487117,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_pentagram_bloom.png",
            "crunched": 0,
            "start": 48487117,
            "end": 48555262,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_pentagram.png",
            "crunched": 0,
            "start": 48555262,
            "end": 48668890,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_placeholders.png",
            "crunched": 0,
            "start": 48668890,
            "end": 48682134,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/jen_ui_buttons.png",
            "crunched": 0,
            "start": 48682134,
            "end": 48682843,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/m_jen_enhancements.png",
            "crunched": 0,
            "start": 48682843,
            "end": 48793286,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/oxy_saw.png",
            "crunched": 0,
            "start": 48793286,
            "end": 48796213,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/p_jen_boosters.png",
            "crunched": 0,
            "start": 48796213,
            "end": 48974949,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/pixel_pet_glow.png",
            "crunched": 0,
            "start": 48974949,
            "end": 48979604,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/pixel_pet.png",
            "crunched": 0,
            "start": 48979604,
            "end": 48983587,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/tag_jen.png",
            "crunched": 0,
            "start": 48983587,
            "end": 48991253,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/default/v_jen_vouchers.png",
            "crunched": 0,
            "start": 48991253,
            "end": 49040519,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/1x/polterworx_avatar.png",
            "crunched": 0,
            "start": 49040519,
            "end": 49042129,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/b_jen_decks.png",
            "crunched": 0,
            "start": 49042129,
            "end": 49180371,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/bl_jen_blinds.png",
            "crunched": 0,
            "start": 49180371,
            "end": 49223079,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/bl_jen_epic_blinds.png",
            "crunched": 0,
            "start": 49223079,
            "end": 50020241,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/bl_jen_legendary_crimson_heart.png",
            "crunched": 0,
            "start": 50020241,
            "end": 50790044,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_acc.png",
            "crunched": 0,
            "start": 50790044,
            "end": 50887835,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_artificer.png",
            "crunched": 0,
            "start": 50887835,
            "end": 50895886,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_blanks.png",
            "crunched": 0,
            "start": 50895886,
            "end": 50898493,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_bottles.png",
            "crunched": 0,
            "start": 50898493,
            "end": 50902731,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_consumables1.png",
            "crunched": 0,
            "start": 50902731,
            "end": 50953883,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_consumables2.png",
            "crunched": 0,
            "start": 50953883,
            "end": 51005035,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_consumables3.png",
            "crunched": 0,
            "start": 51005035,
            "end": 51056187,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_fuse.png",
            "crunched": 0,
            "start": 51056187,
            "end": 51069118,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_goob.png",
            "crunched": 0,
            "start": 51069118,
            "end": 51073774,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_greyhole.png",
            "crunched": 0,
            "start": 51073774,
            "end": 51074645,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_hoxxes.png",
            "crunched": 0,
            "start": 51074645,
            "end": 51075906,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_huge.png",
            "crunched": 0,
            "start": 51075906,
            "end": 51077878,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_nyx.png",
            "crunched": 0,
            "start": 51077878,
            "end": 51092456,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_omegaplanets.png",
            "crunched": 0,
            "start": 51092456,
            "end": 51380649,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_omegaspectrals.png",
            "crunched": 0,
            "start": 51380649,
            "end": 51557225,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_omegatarots.png",
            "crunched": 0,
            "start": 51557225,
            "end": 51877196,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_planets.png",
            "crunched": 0,
            "start": 51877196,
            "end": 52029664,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_reversetarots.png",
            "crunched": 0,
            "start": 52029664,
            "end": 52110749,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_swabbie.png",
            "crunched": 0,
            "start": 52110749,
            "end": 52123000,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_tokens.png",
            "crunched": 0,
            "start": 52123000,
            "end": 52231916,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_uno.png",
            "crunched": 0,
            "start": 52231916,
            "end": 52351020,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/c_jen_yawetag.png",
            "crunched": 0,
            "start": 52351020,
            "end": 52355510,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/enemy_jen_goob.png",
            "crunched": 0,
            "start": 52355510,
            "end": 52364571,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/iamjustsittinghere.png",
            "crunched": 0,
            "start": 52364571,
            "end": 52392218,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_7granddad.png",
            "crunched": 0,
            "start": 52392218,
            "end": 52395392,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_alice.png",
            "crunched": 0,
            "start": 52395392,
            "end": 52406571,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_amalgam.png",
            "crunched": 0,
            "start": 52406571,
            "end": 52408102,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_artificer.png",
            "crunched": 0,
            "start": 52408102,
            "end": 52412505,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_astro.png",
            "crunched": 0,
            "start": 52412505,
            "end": 52423374,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_aym.png",
            "crunched": 0,
            "start": 52423374,
            "end": 52430159,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_baal.png",
            "crunched": 0,
            "start": 52430159,
            "end": 52437325,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_bhdoohickey.png",
            "crunched": 0,
            "start": 52437325,
            "end": 52438856,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_blighter.png",
            "crunched": 0,
            "start": 52438856,
            "end": 52451889,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_boosterdoohickey.png",
            "crunched": 0,
            "start": 52451889,
            "end": 52454142,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_boxten.png",
            "crunched": 0,
            "start": 52454142,
            "end": 52457855,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_bulwark.png",
            "crunched": 0,
            "start": 52457855,
            "end": 52478730,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_charred.png",
            "crunched": 0,
            "start": 52478730,
            "end": 52504606,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_cheese.png",
            "crunched": 0,
            "start": 52504606,
            "end": 52509542,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_chemach.png",
            "crunched": 0,
            "start": 52509542,
            "end": 52511795,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_chester.png",
            "crunched": 0,
            "start": 52511795,
            "end": 52522155,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_cilantro.png",
            "crunched": 0,
            "start": 52522155,
            "end": 52540454,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_clauneck.png",
            "crunched": 0,
            "start": 52540454,
            "end": 52541985,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_codedoohickey.png",
            "crunched": 0,
            "start": 52541985,
            "end": 52543516,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_connie.png",
            "crunched": 0,
            "start": 52543516,
            "end": 52555596,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_consumeabledoohickey.png",
            "crunched": 0,
            "start": 52555596,
            "end": 52557849,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_cosmo.png",
            "crunched": 0,
            "start": 52557849,
            "end": 52569775,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_cracked.png",
            "crunched": 0,
            "start": 52569775,
            "end": 52588637,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_crimbo.png",
            "crunched": 0,
            "start": 52588637,
            "end": 52606849,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_crystal.png",
            "crunched": 0,
            "start": 52606849,
            "end": 52622114,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_dandy.png",
            "crunched": 0,
            "start": 52622114,
            "end": 52646294,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_datura.png",
            "crunched": 0,
            "start": 52646294,
            "end": 52663244,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_drago.png",
            "crunched": 0,
            "start": 52663244,
            "end": 52670853,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_dragofiend.png",
            "crunched": 0,
            "start": 52670853,
            "end": 52680200,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_escapey.png",
            "crunched": 0,
            "start": 52680200,
            "end": 52683475,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_faceless.png",
            "crunched": 0,
            "start": 52683475,
            "end": 52705575,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_finn.png",
            "crunched": 0,
            "start": 52705575,
            "end": 52710451,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_gamingchair.png",
            "crunched": 0,
            "start": 52710451,
            "end": 52724031,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_georgetta.png",
            "crunched": 0,
            "start": 52724031,
            "end": 52737976,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_glisten.png",
            "crunched": 0,
            "start": 52737976,
            "end": 52748350,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_godsmarble.png",
            "crunched": 0,
            "start": 52748350,
            "end": 52782350,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_goob_lefthand.png",
            "crunched": 0,
            "start": 52782350,
            "end": 52785474,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_goob_righthand.png",
            "crunched": 0,
            "start": 52785474,
            "end": 52788575,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_goob.png",
            "crunched": 0,
            "start": 52788575,
            "end": 52794209,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_gourmand.png",
            "crunched": 0,
            "start": 52794209,
            "end": 52797389,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_haro.png",
            "crunched": 0,
            "start": 52797389,
            "end": 52799642,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_heket.png",
            "crunched": 0,
            "start": 52799642,
            "end": 52826913,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_honey.png",
            "crunched": 0,
            "start": 52826913,
            "end": 52833086,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_hunter.png",
            "crunched": 0,
            "start": 52833086,
            "end": 52852683,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_indusblue.png",
            "crunched": 0,
            "start": 52852683,
            "end": 52870801,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_inhabited.png",
            "crunched": 0,
            "start": 52870801,
            "end": 52903086,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_jeremy.png",
            "crunched": 0,
            "start": 52903086,
            "end": 52907927,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_jimbo.png",
            "crunched": 0,
            "start": 52907927,
            "end": 52916958,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_kaleido.png",
            "crunched": 0,
            "start": 52916958,
            "end": 52920867,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_kallamar.png",
            "crunched": 0,
            "start": 52920867,
            "end": 52923120,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_kori.png",
            "crunched": 0,
            "start": 52923120,
            "end": 52943244,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_kosmos.png",
            "crunched": 0,
            "start": 52943244,
            "end": 52959657,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_kudaai.png",
            "crunched": 0,
            "start": 52959657,
            "end": 52961188,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_lamb.png",
            "crunched": 0,
            "start": 52961188,
            "end": 52963441,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_landa.png",
            "crunched": 0,
            "start": 52963441,
            "end": 52981353,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_leshy.png",
            "crunched": 0,
            "start": 52981353,
            "end": 52987566,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_lugia.png",
            "crunched": 0,
            "start": 52987566,
            "end": 52996099,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_luke.png",
            "crunched": 0,
            "start": 52996099,
            "end": 52998352,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_math.png",
            "crunched": 0,
            "start": 52998352,
            "end": 53005829,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_maxie.png",
            "crunched": 0,
            "start": 53005829,
            "end": 53011675,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_monk.png",
            "crunched": 0,
            "start": 53011675,
            "end": 53014789,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_multi.png",
            "crunched": 0,
            "start": 53014789,
            "end": 53023267,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_narinder.png",
            "crunched": 0,
            "start": 53023267,
            "end": 53025520,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_negativedoohickey.png",
            "crunched": 0,
            "start": 53025520,
            "end": 53027773,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_nexus.png",
            "crunched": 0,
            "start": 53027773,
            "end": 53048961,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_noise.png",
            "crunched": 0,
            "start": 53048961,
            "end": 53054042,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_nubby.png",
            "crunched": 0,
            "start": 53054042,
            "end": 53058333,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_nyx.png",
            "crunched": 0,
            "start": 53058333,
            "end": 53072993,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_omegadoohickey.png",
            "crunched": 0,
            "start": 53072993,
            "end": 53075246,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_onewhowaits.png",
            "crunched": 0,
            "start": 53075246,
            "end": 53077499,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_oxy.png",
            "crunched": 0,
            "start": 53077499,
            "end": 53094991,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_p03.png",
            "crunched": 0,
            "start": 53094991,
            "end": 53097244,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_paragon.png",
            "crunched": 0,
            "start": 53097244,
            "end": 53121288,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_peppino.png",
            "crunched": 0,
            "start": 53121288,
            "end": 53125613,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_pickel.png",
            "crunched": 0,
            "start": 53125613,
            "end": 53130554,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_pixel.png",
            "crunched": 0,
            "start": 53130554,
            "end": 53137192,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_planetleveldoohickey.png",
            "crunched": 0,
            "start": 53137192,
            "end": 53139445,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_pldoohickey.png",
            "crunched": 0,
            "start": 53139445,
            "end": 53140976,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_queen.png",
            "crunched": 0,
            "start": 53140976,
            "end": 53164062,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_ratau.png",
            "crunched": 0,
            "start": 53164062,
            "end": 53166315,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_razzledazzle.png",
            "crunched": 0,
            "start": 53166315,
            "end": 53177314,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_rivulet.png",
            "crunched": 0,
            "start": 53177314,
            "end": 53184575,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_rot.png",
            "crunched": 0,
            "start": 53184575,
            "end": 53189535,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_ruler.png",
            "crunched": 0,
            "start": 53189535,
            "end": 53191788,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_saint.png",
            "crunched": 0,
            "start": 53191788,
            "end": 53203930,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_sappy.png",
            "crunched": 0,
            "start": 53203930,
            "end": 53208534,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_shamura.png",
            "crunched": 0,
            "start": 53208534,
            "end": 53210787,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_sigil.png",
            "crunched": 0,
            "start": 53210787,
            "end": 53226543,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_slayer.png",
            "crunched": 0,
            "start": 53226543,
            "end": 53228796,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_sleveldoohickey.png",
            "crunched": 0,
            "start": 53228796,
            "end": 53231049,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_spearmaster.png",
            "crunched": 0,
            "start": 53231049,
            "end": 53235474,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_spectraldoohickey.png",
            "crunched": 0,
            "start": 53235474,
            "end": 53237005,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_survivor.png",
            "crunched": 0,
            "start": 53237005,
            "end": 53240091,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_swabbie.png",
            "crunched": 0,
            "start": 53240091,
            "end": 53252396,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_tarotdoohickey.png",
            "crunched": 0,
            "start": 53252396,
            "end": 53253927,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_thomas.png",
            "crunched": 0,
            "start": 53253927,
            "end": 53257576,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_toodles.png",
            "crunched": 0,
            "start": 53257576,
            "end": 53261553,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_urizyth.png",
            "crunched": 0,
            "start": 53261553,
            "end": 53282520,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_vacuum.png",
            "crunched": 0,
            "start": 53282520,
            "end": 53310784,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_warlord.png",
            "crunched": 0,
            "start": 53310784,
            "end": 53313037,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/j_jen_zignorp.png",
            "crunched": 0,
            "start": 53313037,
            "end": 53329359,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_bishop.png",
            "crunched": 0,
            "start": 53329359,
            "end": 53454142,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_legend.png",
            "crunched": 0,
            "start": 53454142,
            "end": 53588707,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_pentagram_bloom.png",
            "crunched": 0,
            "start": 53588707,
            "end": 53705234,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_pentagram.png",
            "crunched": 0,
            "start": 53705234,
            "end": 53891036,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_placeholders.png",
            "crunched": 0,
            "start": 53891036,
            "end": 53910337,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/jen_ui_buttons.png",
            "crunched": 0,
            "start": 53910337,
            "end": 53911274,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/m_jen_enhancements.png",
            "crunched": 0,
            "start": 53911274,
            "end": 54063013,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/oxy_saw.png",
            "crunched": 0,
            "start": 54063013,
            "end": 54072524,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/p_jen_boosters.png",
            "crunched": 0,
            "start": 54072524,
            "end": 54327274,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/pixel_pet_glow.png",
            "crunched": 0,
            "start": 54327274,
            "end": 54335748,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/pixel_pet.png",
            "crunched": 0,
            "start": 54335748,
            "end": 54343407,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/tag_jen.png",
            "crunched": 0,
            "start": 54343407,
            "end": 54364886,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/default/v_jen_vouchers.png",
            "crunched": 0,
            "start": 54364886,
            "end": 54445113,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/2x/polterworx_avatar.png",
            "crunched": 0,
            "start": 54445113,
            "end": 54447302,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/background.fs",
            "crunched": 0,
            "start": 54447302,
            "end": 54449206,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/bedrock.fs",
            "crunched": 0,
            "start": 54449206,
            "end": 54454105,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/bismuth.fs",
            "crunched": 0,
            "start": 54454105,
            "end": 54460127,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/blaze.fs",
            "crunched": 0,
            "start": 54460127,
            "end": 54465543,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/bloodfoil.fs",
            "crunched": 0,
            "start": 54465543,
            "end": 54471538,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/bubblegum.fs",
            "crunched": 0,
            "start": 54471538,
            "end": 54477643,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/bulged.fs",
            "crunched": 0,
            "start": 54477643,
            "end": 54481709,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/chromatic.fs",
            "crunched": 0,
            "start": 54481709,
            "end": 54485983,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/colouriser.fs",
            "crunched": 0,
            "start": 54485983,
            "end": 54491072,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/cosmic.fs",
            "crunched": 0,
            "start": 54491072,
            "end": 54496900,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/diplopia.fs",
            "crunched": 0,
            "start": 54496900,
            "end": 54501986,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/dithered.fs",
            "crunched": 0,
            "start": 54501986,
            "end": 54508128,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/encoded.fs",
            "crunched": 0,
            "start": 54508128,
            "end": 54514095,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/flame.fs",
            "crunched": 0,
            "start": 54514095,
            "end": 54516878,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/gilded.fs",
            "crunched": 0,
            "start": 54516878,
            "end": 54522706,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/greymatter.fs",
            "crunched": 0,
            "start": 54522706,
            "end": 54528589,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/hardstone.fs",
            "crunched": 0,
            "start": 54528589,
            "end": 54533471,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/ink.fs",
            "crunched": 0,
            "start": 54533471,
            "end": 54539325,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/ionized.fs",
            "crunched": 0,
            "start": 54539325,
            "end": 54545169,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/laminated.fs",
            "crunched": 0,
            "start": 54545169,
            "end": 54549927,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/misprint.fs",
            "crunched": 0,
            "start": 54549927,
            "end": 54554694,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/missingtexture.fs",
            "crunched": 0,
            "start": 54554694,
            "end": 54559845,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/moire.fs",
            "crunched": 0,
            "start": 54559845,
            "end": 54565686,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/mosaic.fs",
            "crunched": 0,
            "start": 54565686,
            "end": 54571418,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/polygloss.fs",
            "crunched": 0,
            "start": 54571418,
            "end": 54581407,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/prismatic.fs",
            "crunched": 0,
            "start": 54581407,
            "end": 54587322,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/reversed.fs",
            "crunched": 0,
            "start": 54587322,
            "end": 54591789,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/rotated.fs",
            "crunched": 0,
            "start": 54591789,
            "end": 54596509,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/sepia.fs",
            "crunched": 0,
            "start": 54596509,
            "end": 54601729,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/sequin.fs",
            "crunched": 0,
            "start": 54601729,
            "end": 54607611,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/shaderpack_1.fs",
            "crunched": 0,
            "start": 54607611,
            "end": 54613669,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/shaderpack_4.fs",
            "crunched": 0,
            "start": 54613669,
            "end": 54619699,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/sharpened.fs",
            "crunched": 0,
            "start": 54619699,
            "end": 54624899,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/splash.fs",
            "crunched": 0,
            "start": 54624899,
            "end": 54626886,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/strobe.fs",
            "crunched": 0,
            "start": 54626886,
            "end": 54632768,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/unreal.fs",
            "crunched": 0,
            "start": 54632768,
            "end": 54638790,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/watered.fs",
            "crunched": 0,
            "start": 54638790,
            "end": 54643876,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/wavy.fs",
            "crunched": 0,
            "start": 54643876,
            "end": 54648290,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/wee.fs",
            "crunched": 0,
            "start": 54648290,
            "end": 54652036,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/shaders/wtfwave.fs",
            "crunched": 0,
            "start": 54652036,
            "end": 54658064,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert.ogg",
            "crunched": 0,
            "start": 54658064,
            "end": 54682085,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert1.ogg",
            "crunched": 0,
            "start": 54682085,
            "end": 54699381,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert2.ogg",
            "crunched": 0,
            "start": 54699381,
            "end": 54720227,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert3.ogg",
            "crunched": 0,
            "start": 54720227,
            "end": 54741624,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert4.ogg",
            "crunched": 0,
            "start": 54741624,
            "end": 54764832,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/alert5.ogg",
            "crunched": 0,
            "start": 54764832,
            "end": 54790887,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/ambientDramatic.ogg",
            "crunched": 0,
            "start": 54790887,
            "end": 55451021,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/ambientSinister.ogg",
            "crunched": 0,
            "start": 55451021,
            "end": 56077109,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/ambientSurreal1.ogg",
            "crunched": 0,
            "start": 56077109,
            "end": 56298649,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/ambientSurreal2.ogg",
            "crunched": 0,
            "start": 56298649,
            "end": 56694050,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/ambientSurreal3.ogg",
            "crunched": 0,
            "start": 56694050,
            "end": 57946585,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/attack1.ogg",
            "crunched": 0,
            "start": 57946585,
            "end": 57981046,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/attack2.ogg",
            "crunched": 0,
            "start": 57981046,
            "end": 58014665,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/attack3.ogg",
            "crunched": 0,
            "start": 58014665,
            "end": 58048745,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/bingo.ogg",
            "crunched": 0,
            "start": 58048745,
            "end": 58072781,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/boost1.ogg",
            "crunched": 0,
            "start": 58072781,
            "end": 58094139,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/boost2.ogg",
            "crunched": 0,
            "start": 58094139,
            "end": 58114734,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/boost3.ogg",
            "crunched": 0,
            "start": 58114734,
            "end": 58134978,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/boost4.ogg",
            "crunched": 0,
            "start": 58134978,
            "end": 58154079,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/brimstone.ogg",
            "crunched": 0,
            "start": 58154079,
            "end": 58321866,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/chime.ogg",
            "crunched": 0,
            "start": 58321866,
            "end": 58402097,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/click.ogg",
            "crunched": 0,
            "start": 58402097,
            "end": 58407710,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/collapse_1.ogg",
            "crunched": 0,
            "start": 58407710,
            "end": 58426380,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/collapse_2.ogg",
            "crunched": 0,
            "start": 58426380,
            "end": 58449626,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/collapse_3.ogg",
            "crunched": 0,
            "start": 58449626,
            "end": 58473976,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/collapse_4.ogg",
            "crunched": 0,
            "start": 58473976,
            "end": 58500920,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/collapse_5.ogg",
            "crunched": 0,
            "start": 58500920,
            "end": 58542460,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crack1.ogg",
            "crunched": 0,
            "start": 58542460,
            "end": 58550174,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crack2.ogg",
            "crunched": 0,
            "start": 58550174,
            "end": 58561193,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/cry.ogg",
            "crunched": 0,
            "start": 58561193,
            "end": 58601408,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crystal_break.ogg",
            "crunched": 0,
            "start": 58601408,
            "end": 58617201,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crystal_hit1.ogg",
            "crunched": 0,
            "start": 58617201,
            "end": 58626572,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crystal_hit2.ogg",
            "crunched": 0,
            "start": 58626572,
            "end": 58635928,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/crystal_hit3.ogg",
            "crunched": 0,
            "start": 58635928,
            "end": 58647088,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/done.ogg",
            "crunched": 0,
            "start": 58647088,
            "end": 58670855,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/draw.ogg",
            "crunched": 0,
            "start": 58670855,
            "end": 58676377,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_bismuth.ogg",
            "crunched": 0,
            "start": 58676377,
            "end": 58735118,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_blaze.ogg",
            "crunched": 0,
            "start": 58735118,
            "end": 58761759,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_chromatic.ogg",
            "crunched": 0,
            "start": 58761759,
            "end": 58799621,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_crystal.ogg",
            "crunched": 0,
            "start": 58799621,
            "end": 58831148,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_diplopia.ogg",
            "crunched": 0,
            "start": 58831148,
            "end": 58859219,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_dithered.ogg",
            "crunched": 0,
            "start": 58859219,
            "end": 58866829,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_encoded.ogg",
            "crunched": 0,
            "start": 58866829,
            "end": 58904480,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_gemstone.ogg",
            "crunched": 0,
            "start": 58904480,
            "end": 58934780,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_gilded.ogg",
            "crunched": 0,
            "start": 58934780,
            "end": 58959590,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_greymatter.ogg",
            "crunched": 0,
            "start": 58959590,
            "end": 58995383,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_ink.ogg",
            "crunched": 0,
            "start": 58995383,
            "end": 59021432,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_ionized.ogg",
            "crunched": 0,
            "start": 59021432,
            "end": 59052429,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_jumbo.ogg",
            "crunched": 0,
            "start": 59052429,
            "end": 59080264,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_laminated.ogg",
            "crunched": 0,
            "start": 59080264,
            "end": 59088316,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_misprint.ogg",
            "crunched": 0,
            "start": 59088316,
            "end": 59109817,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_missingtexture.ogg",
            "crunched": 0,
            "start": 59109817,
            "end": 59119158,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_moire.ogg",
            "crunched": 0,
            "start": 59119158,
            "end": 59143987,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_noisy.ogg",
            "crunched": 0,
            "start": 59143987,
            "end": 59163728,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_polygloss.ogg",
            "crunched": 0,
            "start": 59163728,
            "end": 59186509,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_prismatic.ogg",
            "crunched": 0,
            "start": 59186509,
            "end": 59211607,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_reversed.ogg",
            "crunched": 0,
            "start": 59211607,
            "end": 59231338,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_sepia.ogg",
            "crunched": 0,
            "start": 59231338,
            "end": 59254641,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_sequin.ogg",
            "crunched": 0,
            "start": 59254641,
            "end": 59269018,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_sharpened.ogg",
            "crunched": 0,
            "start": 59269018,
            "end": 59281703,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_sinned.ogg",
            "crunched": 0,
            "start": 59281703,
            "end": 59308326,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_strobe.ogg",
            "crunched": 0,
            "start": 59308326,
            "end": 59318693,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_unreal.ogg",
            "crunched": 0,
            "start": 59318693,
            "end": 59362420,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_watered.ogg",
            "crunched": 0,
            "start": 59362420,
            "end": 59370762,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_wavy.ogg",
            "crunched": 0,
            "start": 59370762,
            "end": 59393367,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/e_wee.ogg",
            "crunched": 0,
            "start": 59393367,
            "end": 59401716,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/eat.ogg",
            "crunched": 0,
            "start": 59401716,
            "end": 59416016,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/enchant.ogg",
            "crunched": 0,
            "start": 59416016,
            "end": 59451989,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/enlightened.ogg",
            "crunched": 0,
            "start": 59451989,
            "end": 59518552,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_1.ogg",
            "crunched": 0,
            "start": 59518552,
            "end": 59588323,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_2.ogg",
            "crunched": 0,
            "start": 59588323,
            "end": 59634665,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_3.ogg",
            "crunched": 0,
            "start": 59634665,
            "end": 59690415,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_4.ogg",
            "crunched": 0,
            "start": 59690415,
            "end": 59713103,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_5.ogg",
            "crunched": 0,
            "start": 59713103,
            "end": 59757726,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_6.ogg",
            "crunched": 0,
            "start": 59757726,
            "end": 59848346,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_7.ogg",
            "crunched": 0,
            "start": 59848346,
            "end": 59876864,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_8.ogg",
            "crunched": 0,
            "start": 59876864,
            "end": 59917327,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/explode_9.ogg",
            "crunched": 0,
            "start": 59917327,
            "end": 59946343,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/exponentiatehand.ogg",
            "crunched": 0,
            "start": 59946343,
            "end": 59974854,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/fusion_create.ogg",
            "crunched": 0,
            "start": 59974854,
            "end": 59989604,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/fusion_place.ogg",
            "crunched": 0,
            "start": 59989604,
            "end": 60003355,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gem.ogg",
            "crunched": 0,
            "start": 60003355,
            "end": 60056476,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gong.ogg",
            "crunched": 0,
            "start": 60056476,
            "end": 60105816,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore1.ogg",
            "crunched": 0,
            "start": 60105816,
            "end": 60117809,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore2.ogg",
            "crunched": 0,
            "start": 60117809,
            "end": 60133069,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore3.ogg",
            "crunched": 0,
            "start": 60133069,
            "end": 60154458,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore4.ogg",
            "crunched": 0,
            "start": 60154458,
            "end": 60170832,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore5.ogg",
            "crunched": 0,
            "start": 60170832,
            "end": 60190093,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore6.ogg",
            "crunched": 0,
            "start": 60190093,
            "end": 60228484,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore7.ogg",
            "crunched": 0,
            "start": 60228484,
            "end": 60252864,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gore8.ogg",
            "crunched": 0,
            "start": 60252864,
            "end": 60268407,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad1.ogg",
            "crunched": 0,
            "start": 60268407,
            "end": 60286240,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad2.ogg",
            "crunched": 0,
            "start": 60286240,
            "end": 60307093,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad3.ogg",
            "crunched": 0,
            "start": 60307093,
            "end": 60325534,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad4.ogg",
            "crunched": 0,
            "start": 60325534,
            "end": 60339820,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad5.ogg",
            "crunched": 0,
            "start": 60339820,
            "end": 60355101,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grand_dad6.ogg",
            "crunched": 0,
            "start": 60355101,
            "end": 60370072,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/grindstone.ogg",
            "crunched": 0,
            "start": 60370072,
            "end": 60384768,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/gup.ogg",
            "crunched": 0,
            "start": 60384768,
            "end": 60391128,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/hurt1.ogg",
            "crunched": 0,
            "start": 60391128,
            "end": 60398506,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/hurt2.ogg",
            "crunched": 0,
            "start": 60398506,
            "end": 60405443,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/hurt3.ogg",
            "crunched": 0,
            "start": 60405443,
            "end": 60414045,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/level_up.ogg",
            "crunched": 0,
            "start": 60414045,
            "end": 60498047,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/manjiji_ma.ogg",
            "crunched": 0,
            "start": 60498047,
            "end": 60569985,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/megatrigger.ogg",
            "crunched": 0,
            "start": 60569985,
            "end": 60630038,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/metal_break1.ogg",
            "crunched": 0,
            "start": 60630038,
            "end": 60654736,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/metal_break2.ogg",
            "crunched": 0,
            "start": 60654736,
            "end": 60683793,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/metal_hit.ogg",
            "crunched": 0,
            "start": 60683793,
            "end": 60697476,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/misc1.ogg",
            "crunched": 0,
            "start": 60697476,
            "end": 60730493,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/moan1.ogg",
            "crunched": 0,
            "start": 60730493,
            "end": 60755446,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/moan2.ogg",
            "crunched": 0,
            "start": 60755446,
            "end": 60781977,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/multiplyhand.ogg",
            "crunched": 0,
            "start": 60781977,
            "end": 60800014,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/mushroom1.ogg",
            "crunched": 0,
            "start": 60800014,
            "end": 60814897,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/mushroom2.ogg",
            "crunched": 0,
            "start": 60814897,
            "end": 60830215,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicCombat.ogg",
            "crunched": 0,
            "start": 60830215,
            "end": 62320193,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicExtraordinary.ogg",
            "crunched": 0,
            "start": 62320193,
            "end": 65029214,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicGameshow.ogg",
            "crunched": 0,
            "start": 65029214,
            "end": 66540830,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicHighTension.ogg",
            "crunched": 0,
            "start": 66540830,
            "end": 68202467,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicHypertensiveCrisis.ogg",
            "crunched": 0,
            "start": 68202467,
            "end": 70065645,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicIcon.ogg",
            "crunched": 0,
            "start": 70065645,
            "end": 70869439,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicKosmos.ogg",
            "crunched": 0,
            "start": 70869439,
            "end": 71998547,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicMatrix.ogg",
            "crunched": 0,
            "start": 71998547,
            "end": 75395774,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicPwxMain.ogg",
            "crunched": 0,
            "start": 75395774,
            "end": 77908585,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicVelkommen.ogg",
            "crunched": 0,
            "start": 77908585,
            "end": 82605026,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/musicWondrous.ogg",
            "crunched": 0,
            "start": 82605026,
            "end": 85215914,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/omega_card.ogg",
            "crunched": 0,
            "start": 85215914,
            "end": 85255783,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/pan.ogg",
            "crunched": 0,
            "start": 85255783,
            "end": 85267614,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/pixelBeep.ogg",
            "crunched": 0,
            "start": 85267614,
            "end": 85274593,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/plasticButton1.ogg",
            "crunched": 0,
            "start": 85274593,
            "end": 85283545,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/plasticButton2.ogg",
            "crunched": 0,
            "start": 85283545,
            "end": 85292462,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/polytatehand.ogg",
            "crunched": 0,
            "start": 85292462,
            "end": 85413400,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/pop.ogg",
            "crunched": 0,
            "start": 85413400,
            "end": 85440983,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/powerup.ogg",
            "crunched": 0,
            "start": 85440983,
            "end": 85458748,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/relief.ogg",
            "crunched": 0,
            "start": 85458748,
            "end": 85485770,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/rizz.ogg",
            "crunched": 0,
            "start": 85485770,
            "end": 85506252,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/select.ogg",
            "crunched": 0,
            "start": 85506252,
            "end": 85511833,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/snap.ogg",
            "crunched": 0,
            "start": 85511833,
            "end": 85522921,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/squirk.ogg",
            "crunched": 0,
            "start": 85522921,
            "end": 85531075,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/stinger.ogg",
            "crunched": 0,
            "start": 85531075,
            "end": 85646025,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/straddle_increase.ogg",
            "crunched": 0,
            "start": 85646025,
            "end": 85690251,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/straddle_tick.ogg",
            "crunched": 0,
            "start": 85690251,
            "end": 85711730,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/tension.ogg",
            "crunched": 0,
            "start": 85711730,
            "end": 85741767,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/tetratehand.ogg",
            "crunched": 0,
            "start": 85741767,
            "end": 85813298,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/treasure.ogg",
            "crunched": 0,
            "start": 85813298,
            "end": 85856270,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/uno.ogg",
            "crunched": 0,
            "start": 85856270,
            "end": 85877898,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/warning_heartbeat.ogg",
            "crunched": 0,
            "start": 85877898,
            "end": 85899192,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/warning.ogg",
            "crunched": 0,
            "start": 85899192,
            "end": 86030064,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/warningInitial.ogg",
            "crunched": 0,
            "start": 86030064,
            "end": 86043880,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/warningLoop.ogg",
            "crunched": 0,
            "start": 86043880,
            "end": 86056970,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/assets/sounds/wererich.ogg",
            "crunched": 0,
            "start": 86056970,
            "end": 86072685,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/config.lua",
            "crunched": 0,
            "start": 86072685,
            "end": 86072972,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/Jen.json",
            "crunched": 0,
            "start": 86072972,
            "end": 86073791,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/Jen.lua",
            "crunched": 0,
            "start": 86073791,
            "end": 86815150,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/LICENSE",
            "crunched": 0,
            "start": 86815150,
            "end": 86850973,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/localization/en-us.lua",
            "crunched": 0,
            "start": 86850973,
            "end": 86851262,
            "audio": false
        },
        {
            "filename": "/Mods/POLTERWORX/lovely.toml",
            "crunched": 0,
            "start": 86851262,
            "end": 86908703,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitattributes",
            "crunched": 0,
            "start": 86908703,
            "end": 86908721,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitignore",
            "crunched": 0,
            "start": 86908721,
            "end": 86912624,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/default_achievements.png",
            "crunched": 0,
            "start": 86912624,
            "end": 86915560,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/dropdown_arrow.png",
            "crunched": 0,
            "start": 86915560,
            "end": 86916314,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/mod_tags.png",
            "crunched": 0,
            "start": 86916314,
            "end": 86919348,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/default_achievements.png",
            "crunched": 0,
            "start": 86919348,
            "end": 86923112,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/dropdown_arrow.png",
            "crunched": 0,
            "start": 86923112,
            "end": 86924690,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/mod_tags.png",
            "crunched": 0,
            "start": 86924690,
            "end": 86928618,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/cat.png",
            "crunched": 0,
            "start": 86928618,
            "end": 86947555,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xblindsize.ogg",
            "crunched": 0,
            "start": 86947555,
            "end": 86960916,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xchips.ogg",
            "crunched": 0,
            "start": 86960916,
            "end": 86985942,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xscore.ogg",
            "crunched": 0,
            "start": 86985942,
            "end": 87010826,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/config.lua",
            "crunched": 0,
            "start": 87010826,
            "end": 87011014,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/icon.png",
            "crunched": 0,
            "start": 87011014,
            "end": 87043495,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/luajit-curl.lua",
            "crunched": 0,
            "start": 87043495,
            "end": 87072234,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/smods-https.lua",
            "crunched": 0,
            "start": 87072234,
            "end": 87080712,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/init.lua",
            "crunched": 0,
            "start": 87080712,
            "end": 87080744,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/json.lua",
            "crunched": 0,
            "start": 87080744,
            "end": 87090381,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/icon.png",
            "crunched": 0,
            "start": 87090381,
            "end": 87232177,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/init.lua",
            "crunched": 0,
            "start": 87232177,
            "end": 87232214,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/LICENSE",
            "crunched": 0,
            "start": 87232214,
            "end": 87233269,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/manifest.json",
            "crunched": 0,
            "start": 87233269,
            "end": 87233560,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/nativefs.lua",
            "crunched": 0,
            "start": 87233560,
            "end": 87251774,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/README.md",
            "crunched": 0,
            "start": 87251774,
            "end": 87257162,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/LICENSE",
            "crunched": 0,
            "start": 87257162,
            "end": 87292311,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/de.lua",
            "crunched": 0,
            "start": 87292311,
            "end": 87306275,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/en-us.lua",
            "crunched": 0,
            "start": 87306275,
            "end": 87318801,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_419.lua",
            "crunched": 0,
            "start": 87318801,
            "end": 87332065,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_ES.lua",
            "crunched": 0,
            "start": 87332065,
            "end": 87345328,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/fr.lua",
            "crunched": 0,
            "start": 87345328,
            "end": 87353358,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/id.lua",
            "crunched": 0,
            "start": 87353358,
            "end": 87354376,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/it.lua",
            "crunched": 0,
            "start": 87354376,
            "end": 87360803,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ja.lua",
            "crunched": 0,
            "start": 87360803,
            "end": 87361901,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ko.lua",
            "crunched": 0,
            "start": 87361901,
            "end": 87369350,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/nl.lua",
            "crunched": 0,
            "start": 87369350,
            "end": 87370382,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pl.lua",
            "crunched": 0,
            "start": 87370382,
            "end": 87371411,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pt_BR.lua",
            "crunched": 0,
            "start": 87371411,
            "end": 87376766,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ru.lua",
            "crunched": 0,
            "start": 87376766,
            "end": 87386145,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_CN.lua",
            "crunched": 0,
            "start": 87386145,
            "end": 87395512,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_TW.lua",
            "crunched": 0,
            "start": 87395512,
            "end": 87396520,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/achievements.toml",
            "crunched": 0,
            "start": 87396520,
            "end": 87400065,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/atlas.toml",
            "crunched": 0,
            "start": 87400065,
            "end": 87401200,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/back.toml",
            "crunched": 0,
            "start": 87401200,
            "end": 87406784,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/better_calc_fixes.toml",
            "crunched": 0,
            "start": 87406784,
            "end": 87407784,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/better_calc.toml",
            "crunched": 0,
            "start": 87407784,
            "end": 87478127,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind_score_mod.toml",
            "crunched": 0,
            "start": 87478127,
            "end": 87479527,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind_ui.toml",
            "crunched": 0,
            "start": 87479527,
            "end": 87486218,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind.toml",
            "crunched": 0,
            "start": 87486218,
            "end": 87505298,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/booster.toml",
            "crunched": 0,
            "start": 87505298,
            "end": 87518503,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/calc_returns.toml",
            "crunched": 0,
            "start": 87518503,
            "end": 87519662,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/calculate_card_added.toml",
            "crunched": 0,
            "start": 87519662,
            "end": 87520416,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/can_calculate.toml",
            "crunched": 0,
            "start": 87520416,
            "end": 87521841,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/card_limit.toml",
            "crunched": 0,
            "start": 87521841,
            "end": 87533284,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/cardarea.toml",
            "crunched": 0,
            "start": 87533284,
            "end": 87534475,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/cardareas.toml",
            "crunched": 0,
            "start": 87534475,
            "end": 87535684,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/center.toml",
            "crunched": 0,
            "start": 87535684,
            "end": 87558618,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/challenge.toml",
            "crunched": 0,
            "start": 87558618,
            "end": 87562743,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/compact_cashout.toml",
            "crunched": 0,
            "start": 87562743,
            "end": 87564337,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/compat_0_9_8.toml",
            "crunched": 0,
            "start": 87564337,
            "end": 87565390,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/core.toml",
            "crunched": 0,
            "start": 87565390,
            "end": 87565881,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/crash_handler.toml",
            "crunched": 0,
            "start": 87565881,
            "end": 87566472,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/create_sprite.toml",
            "crunched": 0,
            "start": 87566472,
            "end": 87569625,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/deck_skins.toml",
            "crunched": 0,
            "start": 87569625,
            "end": 87572370,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/dollar_row.toml",
            "crunched": 0,
            "start": 87572370,
            "end": 87575266,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/dynatext_conditionals.toml",
            "crunched": 0,
            "start": 87575266,
            "end": 87577392,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/easings.toml",
            "crunched": 0,
            "start": 87577392,
            "end": 87579493,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/edition.toml",
            "crunched": 0,
            "start": 87579493,
            "end": 87586915,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/enhancement.toml",
            "crunched": 0,
            "start": 87586915,
            "end": 87597175,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/event.toml",
            "crunched": 0,
            "start": 87597175,
            "end": 87598527,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/fixes.toml",
            "crunched": 0,
            "start": 87598527,
            "end": 87626018,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/gradient.toml",
            "crunched": 0,
            "start": 87626018,
            "end": 87627467,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/hand_limit.toml",
            "crunched": 0,
            "start": 87627467,
            "end": 87630283,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/jimboquip.toml",
            "crunched": 0,
            "start": 87630283,
            "end": 87636001,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/joker_retriggers.toml",
            "crunched": 0,
            "start": 87636001,
            "end": 87642997,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/joker_size.toml",
            "crunched": 0,
            "start": 87642997,
            "end": 87645404,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/keybind.toml",
            "crunched": 0,
            "start": 87645404,
            "end": 87647595,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/language.toml",
            "crunched": 0,
            "start": 87647595,
            "end": 87649592,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/libs.toml",
            "crunched": 0,
            "start": 87649592,
            "end": 87650199,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/listed_probabilities.toml",
            "crunched": 0,
            "start": 87650199,
            "end": 87656498,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/loader.toml",
            "crunched": 0,
            "start": 87656498,
            "end": 87657016,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/menu.toml",
            "crunched": 0,
            "start": 87657016,
            "end": 87659195,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/mobile_patches.toml",
            "crunched": 0,
            "start": 87659195,
            "end": 87661597,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/mod.toml",
            "crunched": 0,
            "start": 87661597,
            "end": 87663352,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/multi_box_descriptions.toml",
            "crunched": 0,
            "start": 87663352,
            "end": 87669079,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/number_formatting.toml",
            "crunched": 0,
            "start": 87669079,
            "end": 87673820,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/override_notice.toml",
            "crunched": 0,
            "start": 87673820,
            "end": 87681756,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/perma_bonus.toml",
            "crunched": 0,
            "start": 87681756,
            "end": 87694916,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/playing_card.toml",
            "crunched": 0,
            "start": 87694916,
            "end": 87706221,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand_screen.toml",
            "crunched": 0,
            "start": 87706221,
            "end": 87708322,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand_text.toml",
            "crunched": 0,
            "start": 87708322,
            "end": 87709584,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand.toml",
            "crunched": 0,
            "start": 87709584,
            "end": 87712913,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/pool.toml",
            "crunched": 0,
            "start": 87712913,
            "end": 87719044,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/preflight.toml",
            "crunched": 0,
            "start": 87719044,
            "end": 87720270,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/rarity.toml",
            "crunched": 0,
            "start": 87720270,
            "end": 87722617,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/scaling.toml",
            "crunched": 0,
            "start": 87722617,
            "end": 87739345,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/score_mod.toml",
            "crunched": 0,
            "start": 87739345,
            "end": 87740848,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/scoring_calculation.toml",
            "crunched": 0,
            "start": 87740848,
            "end": 87752164,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/screenshader_rendering.toml",
            "crunched": 0,
            "start": 87752164,
            "end": 87754483,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/seal.toml",
            "crunched": 0,
            "start": 87754483,
            "end": 87761298,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/shaders.toml",
            "crunched": 0,
            "start": 87761298,
            "end": 87762217,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/shop.toml",
            "crunched": 0,
            "start": 87762217,
            "end": 87769546,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/sound.toml",
            "crunched": 0,
            "start": 87769546,
            "end": 87774706,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/stake.toml",
            "crunched": 0,
            "start": 87774706,
            "end": 87784912,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/sticker.toml",
            "crunched": 0,
            "start": 87784912,
            "end": 87788867,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/tag.toml",
            "crunched": 0,
            "start": 87788867,
            "end": 87793959,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/text_effect.toml",
            "crunched": 0,
            "start": 87793959,
            "end": 87799808,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/threads.toml",
            "crunched": 0,
            "start": 87799808,
            "end": 87800490,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_additional_text_props.toml",
            "crunched": 0,
            "start": 87800490,
            "end": 87810881,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_elements.toml",
            "crunched": 0,
            "start": 87810881,
            "end": 87823136,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_overflow.toml",
            "crunched": 0,
            "start": 87823136,
            "end": 87825690,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui.toml",
            "crunched": 0,
            "start": 87825690,
            "end": 87842551,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/weights.toml",
            "crunched": 0,
            "start": 87842551,
            "end": 87845277,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/manifest.json",
            "crunched": 0,
            "start": 87845277,
            "end": 87845510,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/README.md",
            "crunched": 0,
            "start": 87845510,
            "end": 87847312,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/release.lua",
            "crunched": 0,
            "start": 87847312,
            "end": 87847349,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/card_draw.lua",
            "crunched": 0,
            "start": 87847349,
            "end": 87872116,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/compat_0_9_8.lua",
            "crunched": 0,
            "start": 87872116,
            "end": 87890186,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/core.lua",
            "crunched": 0,
            "start": 87890186,
            "end": 87892055,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/crash_handler.lua",
            "crunched": 0,
            "start": 87892055,
            "end": 87929316,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_object.lua",
            "crunched": 0,
            "start": 87929316,
            "end": 88100697,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_objects/attributes.lua",
            "crunched": 0,
            "start": 88100697,
            "end": 88113110,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/index.lua",
            "crunched": 0,
            "start": 88113110,
            "end": 88114523,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/overrides.lua",
            "crunched": 0,
            "start": 88114523,
            "end": 88227539,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/core.lua",
            "crunched": 0,
            "start": 88227539,
            "end": 88233123,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/loader.lua",
            "crunched": 0,
            "start": 88233123,
            "end": 88272731,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/logging.lua",
            "crunched": 0,
            "start": 88272731,
            "end": 88274643,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/main.lua",
            "crunched": 0,
            "start": 88274643,
            "end": 88277438,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 88277438,
            "end": 88283364,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 88283364,
            "end": 88286662,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/ui.lua",
            "crunched": 0,
            "start": 88286662,
            "end": 88418955,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils.lua",
            "crunched": 0,
            "start": 88418955,
            "end": 88590992,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils/weights.lua",
            "crunched": 0,
            "start": 88590992,
            "end": 88610122,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/tk_debug_window.py",
            "crunched": 0,
            "start": 88610122,
            "end": 88635951,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/version.lua",
            "crunched": 0,
            "start": 88635951,
            "end": 88635988,
            "audio": false
        },
        {
            "filename": "/nativefs.lua",
            "crunched": 0,
            "start": 88635988,
            "end": 88639746,
            "audio": false
        },
        {
            "filename": "/resources/fonts/m6x11plus.ttf",
            "crunched": 0,
            "start": 88639746,
            "end": 88674811,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSans-Bold.ttf",
            "crunched": 0,
            "start": 88674811,
            "end": 89257415,
            "audio": false
        },
        {
            "filename": "/resources/gamecontrollerdb.txt",
            "crunched": 0,
            "start": 89257415,
            "end": 89655239,
            "audio": false
        },
        {
            "filename": "/resources/shaders/background.fs",
            "crunched": 0,
            "start": 89655239,
            "end": 89657759,
            "audio": false
        },
        {
            "filename": "/resources/shaders/booster.fs",
            "crunched": 0,
            "start": 89657759,
            "end": 89663082,
            "audio": false
        },
        {
            "filename": "/resources/shaders/CRT.fs",
            "crunched": 0,
            "start": 89663082,
            "end": 89670352,
            "audio": false
        },
        {
            "filename": "/resources/shaders/debuff.fs",
            "crunched": 0,
            "start": 89670352,
            "end": 89675516,
            "audio": false
        },
        {
            "filename": "/resources/shaders/dissolve.fs",
            "crunched": 0,
            "start": 89675516,
            "end": 89679785,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flame.fs",
            "crunched": 0,
            "start": 89679785,
            "end": 89682634,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flash.fs",
            "crunched": 0,
            "start": 89682634,
            "end": 89683535,
            "audio": false
        },
        {
            "filename": "/resources/shaders/foil.fs",
            "crunched": 0,
            "start": 89683535,
            "end": 89689470,
            "audio": false
        },
        {
            "filename": "/resources/shaders/gold_seal.fs",
            "crunched": 0,
            "start": 89689470,
            "end": 89690271,
            "audio": false
        },
        {
            "filename": "/resources/shaders/holo.fs",
            "crunched": 0,
            "start": 89690271,
            "end": 89696278,
            "audio": false
        },
        {
            "filename": "/resources/shaders/hologram.fs",
            "crunched": 0,
            "start": 89696278,
            "end": 89702034,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative_shine.fs",
            "crunched": 0,
            "start": 89702034,
            "end": 89706944,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative.fs",
            "crunched": 0,
            "start": 89706944,
            "end": 89711838,
            "audio": false
        },
        {
            "filename": "/resources/shaders/played.fs",
            "crunched": 0,
            "start": 89711838,
            "end": 89716628,
            "audio": false
        },
        {
            "filename": "/resources/shaders/polychrome.fs",
            "crunched": 0,
            "start": 89716628,
            "end": 89722454,
            "audio": false
        },
        {
            "filename": "/resources/shaders/skew.fs",
            "crunched": 0,
            "start": 89722454,
            "end": 89723125,
            "audio": false
        },
        {
            "filename": "/resources/shaders/splash.fs",
            "crunched": 0,
            "start": 89723125,
            "end": 89725732,
            "audio": false
        },
        {
            "filename": "/resources/shaders/vortex.fs",
            "crunched": 0,
            "start": 89725732,
            "end": 89726543,
            "audio": false
        },
        {
            "filename": "/resources/shaders/voucher.fs",
            "crunched": 0,
            "start": 89726543,
            "end": 89731372,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire1.ogg",
            "crunched": 0,
            "start": 89731372,
            "end": 90209703,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire2.ogg",
            "crunched": 0,
            "start": 90209703,
            "end": 90718200,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire3.ogg",
            "crunched": 0,
            "start": 90718200,
            "end": 91221757,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientOrgan1.ogg",
            "crunched": 0,
            "start": 91221757,
            "end": 91602710,
            "audio": false
        },
        {
            "filename": "/resources/sounds/button.ogg",
            "crunched": 0,
            "start": 91602710,
            "end": 91610843,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cancel.ogg",
            "crunched": 0,
            "start": 91610843,
            "end": 91620923,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card1.ogg",
            "crunched": 0,
            "start": 91620923,
            "end": 91634861,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card3.ogg",
            "crunched": 0,
            "start": 91634861,
            "end": 91646733,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardFan2.ogg",
            "crunched": 0,
            "start": 91646733,
            "end": 91663202,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide1.ogg",
            "crunched": 0,
            "start": 91663202,
            "end": 91674130,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide2.ogg",
            "crunched": 0,
            "start": 91674130,
            "end": 91684013,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips1.ogg",
            "crunched": 0,
            "start": 91684013,
            "end": 91692997,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips2.ogg",
            "crunched": 0,
            "start": 91692997,
            "end": 91705114,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin1.ogg",
            "crunched": 0,
            "start": 91705114,
            "end": 91716423,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin2.ogg",
            "crunched": 0,
            "start": 91716423,
            "end": 91726149,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin3.ogg",
            "crunched": 0,
            "start": 91726149,
            "end": 91737812,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin4.ogg",
            "crunched": 0,
            "start": 91737812,
            "end": 91748337,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin5.ogg",
            "crunched": 0,
            "start": 91748337,
            "end": 91761439,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin6.ogg",
            "crunched": 0,
            "start": 91761439,
            "end": 91779490,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin7.ogg",
            "crunched": 0,
            "start": 91779490,
            "end": 91790805,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple1.ogg",
            "crunched": 0,
            "start": 91790805,
            "end": 91804989,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple2.ogg",
            "crunched": 0,
            "start": 91804989,
            "end": 91819325,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple3.ogg",
            "crunched": 0,
            "start": 91819325,
            "end": 91832609,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple4.ogg",
            "crunched": 0,
            "start": 91832609,
            "end": 91845741,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple5.ogg",
            "crunched": 0,
            "start": 91845741,
            "end": 91859547,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong1.ogg",
            "crunched": 0,
            "start": 91859547,
            "end": 91910685,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong2.ogg",
            "crunched": 0,
            "start": 91910685,
            "end": 91965427,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_buildup1.ogg",
            "crunched": 0,
            "start": 91965427,
            "end": 91997278,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_release1.ogg",
            "crunched": 0,
            "start": 91997278,
            "end": 92029276,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion1.ogg",
            "crunched": 0,
            "start": 92029276,
            "end": 92077702,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil1.ogg",
            "crunched": 0,
            "start": 92077702,
            "end": 92086468,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil2.ogg",
            "crunched": 0,
            "start": 92086468,
            "end": 92096010,
            "audio": false
        },
        {
            "filename": "/resources/sounds/generic1.ogg",
            "crunched": 0,
            "start": 92096010,
            "end": 92103145,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass1.ogg",
            "crunched": 0,
            "start": 92103145,
            "end": 92120099,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass2.ogg",
            "crunched": 0,
            "start": 92120099,
            "end": 92136896,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass3.ogg",
            "crunched": 0,
            "start": 92136896,
            "end": 92153468,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass4.ogg",
            "crunched": 0,
            "start": 92153468,
            "end": 92170972,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass5.ogg",
            "crunched": 0,
            "start": 92170972,
            "end": 92188107,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass6.ogg",
            "crunched": 0,
            "start": 92188107,
            "end": 92206152,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gold_seal.ogg",
            "crunched": 0,
            "start": 92206152,
            "end": 92219436,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gong.ogg",
            "crunched": 0,
            "start": 92219436,
            "end": 92237581,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight1.ogg",
            "crunched": 0,
            "start": 92237581,
            "end": 92244768,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight2.ogg",
            "crunched": 0,
            "start": 92244768,
            "end": 92258152,
            "audio": false
        },
        {
            "filename": "/resources/sounds/holo1.ogg",
            "crunched": 0,
            "start": 92258152,
            "end": 92270707,
            "audio": false
        },
        {
            "filename": "/resources/sounds/introPad1.ogg",
            "crunched": 0,
            "start": 92270707,
            "end": 92604725,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple.ogg",
            "crunched": 0,
            "start": 92604725,
            "end": 92690854,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple2.ogg",
            "crunched": 0,
            "start": 92690854,
            "end": 92726184,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple3.ogg",
            "crunched": 0,
            "start": 92726184,
            "end": 92750614,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit1.ogg",
            "crunched": 0,
            "start": 92750614,
            "end": 92762696,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit2.ogg",
            "crunched": 0,
            "start": 92762696,
            "end": 92777648,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music1.ogg",
            "crunched": 0,
            "start": 92777648,
            "end": 95716390,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music2.ogg",
            "crunched": 0,
            "start": 95716390,
            "end": 98331659,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music3.ogg",
            "crunched": 0,
            "start": 98331659,
            "end": 100842717,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music4.ogg",
            "crunched": 0,
            "start": 100842717,
            "end": 103651114,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music5.ogg",
            "crunched": 0,
            "start": 103651114,
            "end": 106496942,
            "audio": false
        },
        {
            "filename": "/resources/sounds/negative.ogg",
            "crunched": 0,
            "start": 106496942,
            "end": 106510140,
            "audio": false
        },
        {
            "filename": "/resources/sounds/other1.ogg",
            "crunched": 0,
            "start": 106510140,
            "end": 106522288,
            "audio": false
        },
        {
            "filename": "/resources/sounds/paper1.ogg",
            "crunched": 0,
            "start": 106522288,
            "end": 106527560,
            "audio": false
        },
        {
            "filename": "/resources/sounds/polychrome1.ogg",
            "crunched": 0,
            "start": 106527560,
            "end": 106557581,
            "audio": false
        },
        {
            "filename": "/resources/sounds/slice1.ogg",
            "crunched": 0,
            "start": 106557581,
            "end": 106566078,
            "audio": false
        },
        {
            "filename": "/resources/sounds/splash_buildup.ogg",
            "crunched": 0,
            "start": 106566078,
            "end": 106905637,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot1.ogg",
            "crunched": 0,
            "start": 106905637,
            "end": 106914758,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot2.ogg",
            "crunched": 0,
            "start": 106914758,
            "end": 106925580,
            "audio": false
        },
        {
            "filename": "/resources/sounds/timpani.ogg",
            "crunched": 0,
            "start": 106925580,
            "end": 106939771,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice1.ogg",
            "crunched": 0,
            "start": 106939771,
            "end": 106946855,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice10.ogg",
            "crunched": 0,
            "start": 106946855,
            "end": 106953946,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice11.ogg",
            "crunched": 0,
            "start": 106953946,
            "end": 106960935,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice2.ogg",
            "crunched": 0,
            "start": 106960935,
            "end": 106967955,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice3.ogg",
            "crunched": 0,
            "start": 106967955,
            "end": 106975054,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice4.ogg",
            "crunched": 0,
            "start": 106975054,
            "end": 106982417,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice5.ogg",
            "crunched": 0,
            "start": 106982417,
            "end": 106989612,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice6.ogg",
            "crunched": 0,
            "start": 106989612,
            "end": 106996731,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice7.ogg",
            "crunched": 0,
            "start": 106996731,
            "end": 107003792,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice8.ogg",
            "crunched": 0,
            "start": 107003792,
            "end": 107010956,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice9.ogg",
            "crunched": 0,
            "start": 107010956,
            "end": 107018122,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh_long.ogg",
            "crunched": 0,
            "start": 107018122,
            "end": 107132303,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh.ogg",
            "crunched": 0,
            "start": 107132303,
            "end": 107142215,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh1.ogg",
            "crunched": 0,
            "start": 107142215,
            "end": 107155117,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh2.ogg",
            "crunched": 0,
            "start": 107155117,
            "end": 107167965,
            "audio": false
        },
        {
            "filename": "/resources/sounds/win.ogg",
            "crunched": 0,
            "start": 107167965,
            "end": 107204531,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 107204531,
            "end": 107266668,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck.png",
            "crunched": 0,
            "start": 107266668,
            "end": 107313546,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro_alt.png",
            "crunched": 0,
            "start": 107313546,
            "end": 107334372,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro.png",
            "crunched": 0,
            "start": 107334372,
            "end": 107361249,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/BlindChips.png",
            "crunched": 0,
            "start": 107361249,
            "end": 107445061,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/boosters.png",
            "crunched": 0,
            "start": 107445061,
            "end": 107615679,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/chips.png",
            "crunched": 0,
            "start": 107615679,
            "end": 107623934,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 107623934,
            "end": 107632313,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 107632313,
            "end": 107640628,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 107640628,
            "end": 107645660,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 107645660,
            "end": 107652964,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 107652964,
            "end": 107664116,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 107664116,
            "end": 107676836,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 107676836,
            "end": 107686639,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 107686639,
            "end": 107696318,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 107696318,
            "end": 107702801,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 107702801,
            "end": 107711063,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 107711063,
            "end": 107719230,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 107719230,
            "end": 107728231,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 107728231,
            "end": 107735495,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 107735495,
            "end": 107742817,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 107742817,
            "end": 107750531,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 107750531,
            "end": 107759372,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 107759372,
            "end": 107768059,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 107768059,
            "end": 107777148,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 107777148,
            "end": 107784946,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 107784946,
            "end": 107792677,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 107792677,
            "end": 107800111,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 107800111,
            "end": 107806073,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 107806073,
            "end": 107810806,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 107810806,
            "end": 107816005,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 107816005,
            "end": 107825250,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 107825250,
            "end": 107834808,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 107834808,
            "end": 107842478,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 107842478,
            "end": 107849975,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 107849975,
            "end": 107861683,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 107861683,
            "end": 107874484,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 107874484,
            "end": 107886368,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 107886368,
            "end": 107898009,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 107898009,
            "end": 107906447,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 107906447,
            "end": 107914872,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 107914872,
            "end": 107924033,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 107924033,
            "end": 107934132,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 107934132,
            "end": 107942010,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 107942010,
            "end": 107950592,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 107950592,
            "end": 107958029,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 107958029,
            "end": 107965501,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 107965501,
            "end": 107973068,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 107973068,
            "end": 107980415,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 107980415,
            "end": 107985407,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 107985407,
            "end": 107993213,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 107993213,
            "end": 107999843,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 107999843,
            "end": 108007272,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 108007272,
            "end": 108019418,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 108019418,
            "end": 108030038,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Enhancers.png",
            "crunched": 0,
            "start": 108030038,
            "end": 108105990,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/gamepad_ui.png",
            "crunched": 0,
            "start": 108105990,
            "end": 108125917,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/icons.png",
            "crunched": 0,
            "start": 108125917,
            "end": 108134473,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Jokers.png",
            "crunched": 0,
            "start": 108134473,
            "end": 108639160,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/localthunk-logo.png",
            "crunched": 0,
            "start": 108639160,
            "end": 108648787,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/playstack-logo.png",
            "crunched": 0,
            "start": 108648787,
            "end": 108721513,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 108721513,
            "end": 108732311,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/stickers.png",
            "crunched": 0,
            "start": 108732311,
            "end": 108736695,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/tags.png",
            "crunched": 0,
            "start": 108736695,
            "end": 108744030,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Tarots.png",
            "crunched": 0,
            "start": 108744030,
            "end": 108840361,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 108840361,
            "end": 108841813,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets.png",
            "crunched": 0,
            "start": 108841813,
            "end": 108843281,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Vouchers.png",
            "crunched": 0,
            "start": 108843281,
            "end": 108913990,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 108913990,
            "end": 108994560,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck.png",
            "crunched": 0,
            "start": 108994560,
            "end": 109058958,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro_alt.png",
            "crunched": 0,
            "start": 109058958,
            "end": 109086026,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro.png",
            "crunched": 0,
            "start": 109086026,
            "end": 109121360,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/BlindChips.png",
            "crunched": 0,
            "start": 109121360,
            "end": 109255866,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/boosters.png",
            "crunched": 0,
            "start": 109255866,
            "end": 109467529,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/chips.png",
            "crunched": 0,
            "start": 109467529,
            "end": 109477411,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 109477411,
            "end": 109487316,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 109487316,
            "end": 109497184,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 109497184,
            "end": 109505158,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 109505158,
            "end": 109515453,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 109515453,
            "end": 109528851,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 109528851,
            "end": 109543581,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 109543581,
            "end": 109555301,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 109555301,
            "end": 109567033,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 109567033,
            "end": 109577526,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 109577526,
            "end": 109587292,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 109587292,
            "end": 109597143,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 109597143,
            "end": 109607883,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 109607883,
            "end": 109619375,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 109619375,
            "end": 109630941,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 109630941,
            "end": 109641447,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 109641447,
            "end": 109652016,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 109652016,
            "end": 109662194,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 109662194,
            "end": 109672938,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 109672938,
            "end": 109682562,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 109682562,
            "end": 109692147,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 109692147,
            "end": 109701713,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 109701713,
            "end": 109709130,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 109709130,
            "end": 109714971,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 109714971,
            "end": 109721369,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 109721369,
            "end": 109732291,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 109732291,
            "end": 109743572,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 109743572,
            "end": 109752659,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 109752659,
            "end": 109761694,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 109761694,
            "end": 109775508,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 109775508,
            "end": 109790566,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 109790566,
            "end": 109804290,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 109804290,
            "end": 109817679,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 109817679,
            "end": 109827721,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 109827721,
            "end": 109837719,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 109837719,
            "end": 109848778,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 109848778,
            "end": 109860932,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 109860932,
            "end": 109872545,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 109872545,
            "end": 109885142,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 109885142,
            "end": 109895866,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 109895866,
            "end": 109906589,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 109906589,
            "end": 109917816,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 109917816,
            "end": 109928742,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 109928742,
            "end": 109936161,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 109936161,
            "end": 109945427,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 109945427,
            "end": 109956710,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 109956710,
            "end": 109969472,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 109969472,
            "end": 109983701,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 109983701,
            "end": 109996593,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Enhancers.png",
            "crunched": 0,
            "start": 109996593,
            "end": 110090478,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/gamepad_ui.png",
            "crunched": 0,
            "start": 110090478,
            "end": 110115343,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/icons.png",
            "crunched": 0,
            "start": 110115343,
            "end": 110126913,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Jokers.png",
            "crunched": 0,
            "start": 110126913,
            "end": 110739437,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/localthunk-logo.png",
            "crunched": 0,
            "start": 110739437,
            "end": 110760000,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/playstack-logo.png",
            "crunched": 0,
            "start": 110760000,
            "end": 110867388,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 110867388,
            "end": 110883043,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/stickers.png",
            "crunched": 0,
            "start": 110883043,
            "end": 110889781,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/tags.png",
            "crunched": 0,
            "start": 110889781,
            "end": 110900632,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Tarots.png",
            "crunched": 0,
            "start": 110900632,
            "end": 111020294,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 111020294,
            "end": 111022048,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets.png",
            "crunched": 0,
            "start": 111022048,
            "end": 111023805,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Vouchers.png",
            "crunched": 0,
            "start": 111023805,
            "end": 111108406,
            "audio": false
        },
        {
            "filename": "/SMODS/lovely_regex.lua",
            "crunched": 0,
            "start": 111108406,
            "end": 111138998,
            "audio": false
        },
        {
            "filename": "/SMODS/nativefs.lua",
            "crunched": 0,
            "start": 111138998,
            "end": 111142756,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/loader.lua",
            "crunched": 0,
            "start": 111142756,
            "end": 111182364,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/logging.lua",
            "crunched": 0,
            "start": 111182364,
            "end": 111183010,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 111183010,
            "end": 111188936,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 111188936,
            "end": 111192234,
            "audio": false
        },
        {
            "filename": "/SMODS/release.lua",
            "crunched": 0,
            "start": 111192234,
            "end": 111192271,
            "audio": false
        },
        {
            "filename": "/SMODS/version.lua",
            "crunched": 0,
            "start": 111192271,
            "end": 111192308,
            "audio": false
        },
        {
            "filename": "/SMODS/web_bootstrap.lua",
            "crunched": 0,
            "start": 111192308,
            "end": 111240350,
            "audio": false
        },
        {
            "filename": "/SMODS/web_compare.lua",
            "crunched": 0,
            "start": 111240350,
            "end": 111253955,
            "audio": false
        },
        {
            "filename": "/SMODS/web_shaders.lua",
            "crunched": 0,
            "start": 111253955,
            "end": 111283605,
            "audio": false
        },
        {
            "filename": "/SMODS/web_threads.lua",
            "crunched": 0,
            "start": 111283605,
            "end": 111288083,
            "audio": false
        },
        {
            "filename": "/tag.lua",
            "crunched": 0,
            "start": 111288083,
            "end": 111313222,
            "audio": false
        },
        {
            "filename": "/version.jkr",
            "crunched": 0,
            "start": 111313222,
            "end": 111313256,
            "audio": false
        }
    ]
});
})();
