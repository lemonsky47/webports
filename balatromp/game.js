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

    function fetchRemotePackage(packageName, packageSize, callback, errback) {
      if (!Module.dataFileDownloads) Module.dataFileDownloads = {};

      var chunksLoaded = 0;
      var chunkBuffers = new Array(TOTAL_CHUNKS);
      var chunkProgress = new Array(TOTAL_CHUNKS).fill(0);
      var chunkTotals = new Array(TOTAL_CHUNKS).fill(0);

      function updateProgress() {
        var loaded = 0;
        var total = 0;
        for (var i = 0; i < TOTAL_CHUNKS; i++) {
          loaded += chunkProgress[i];
          total += chunkTotals[i] || (i < TOTAL_CHUNKS - 1 ? CHUNK_SIZE : (packageSize - CHUNK_SIZE * (TOTAL_CHUNKS - 1)));
        }
        Module.dataFileDownloads['game.data'] = { loaded: loaded, total: total };
        if (Module['setStatus'])
          Module['setStatus'](
            `Downloading data... ${asciiProgressBar(loaded, total, 50)} (${loaded}B/${total}B)`,
          );
      }

      function onAllChunksLoaded() {
        // Concatenate all chunks into a single ArrayBuffer
        var totalSize = 0;
        for (var i = 0; i < TOTAL_CHUNKS; i++) {
          totalSize += chunkBuffers[i].byteLength;
        }
        var combined = new Uint8Array(totalSize);
        var offset = 0;
        for (var i = 0; i < TOTAL_CHUNKS; i++) {
          combined.set(new Uint8Array(chunkBuffers[i]), offset);
          offset += chunkBuffers[i].byteLength;
        }
        callback(combined.buffer);
      }

      for (var c = 0; c < TOTAL_CHUNKS; c++) {
        (function(chunkIndex) {
          var chunkName = './data/game.data.' + String(chunkIndex).padStart(3, '0');
          var xhr = new XMLHttpRequest();
          xhr.open('GET', chunkName, true);
          xhr.responseType = 'arraybuffer';
          xhr.onprogress = function(event) {
            if (event.total) chunkTotals[chunkIndex] = event.total;
            if (event.loaded) {
              chunkProgress[chunkIndex] = event.loaded;
              updateProgress();
            }
          };
          xhr.onerror = function(event) {
            errback(new Error('NetworkError for chunk: ' + chunkName));
          };
          xhr.onload = function(event) {
            if (
              xhr.status == 200 ||
              xhr.status == 304 ||
              xhr.status == 206 ||
              (xhr.status == 0 && xhr.response)
            ) {
              chunkBuffers[chunkIndex] = xhr.response;
              chunkProgress[chunkIndex] = xhr.response.byteLength;
              chunkTotals[chunkIndex] = xhr.response.byteLength;
              chunksLoaded++;
              updateProgress();
              if (chunksLoaded === TOTAL_CHUNKS) {
                onAllChunksLoaded();
              }
            } else {
              errback(new Error(xhr.statusText + ' : ' + xhr.responseURL));
            }
          };
          xhr.send(null);
        })(c);
      }
    }

    function handleError(error) {
      console.error('package error:', error);
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
          ); // canOwn this data in the filesystem, it is a slide into the heap that will never change
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
      var DB_VERSION = 1;
      var METADATA_STORE_NAME = 'METADATA';
      var PACKAGE_STORE_NAME = 'PACKAGES';

      function openDatabase(callback, errback) {
        try {
          var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
          return errback(e);
        }
        openRequest.onupgradeneeded = function(event) {
          var db = event.target.result;

          if (db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
            db.deleteObjectStore(PACKAGE_STORE_NAME);
          }
          var packages = db.createObjectStore(PACKAGE_STORE_NAME);

          if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
            db.deleteObjectStore(METADATA_STORE_NAME);
          }
          var metadata = db.createObjectStore(METADATA_STORE_NAME);
        };
        openRequest.onsuccess = function(event) {
          var db = event.target.result;
          callback(db);
        };
        openRequest.onerror = function(error) {
          errback(error);
        };
      }

      /* Check if there's a cached package, and if so whether it's the latest available */
      function checkCachedPackage(db, packageName, callback, errback) {
        var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
        var metadata = transaction.objectStore(METADATA_STORE_NAME);

        var getRequest = metadata.get('metadata/' + packageName);
        getRequest.onsuccess = function(event) {
          var result = event.target.result;
          if (!result) {
            return callback(false);
          } else {
            return callback(PACKAGE_UUID === result.uuid);
          }
        };
        getRequest.onerror = function(error) {
          errback(error);
        };
      }

      function fetchCachedPackage(db, packageName, callback, errback) {
        var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
        var packages = transaction.objectStore(PACKAGE_STORE_NAME);

        var getRequest = packages.get('package/' + packageName);
        getRequest.onsuccess = function(event) {
          var result = event.target.result;
          callback(result);
        };
        getRequest.onerror = function(error) {
          errback(error);
        };
      }

      function cacheRemotePackage(
        db,
        packageName,
        packageData,
        packageMeta,
        callback,
        errback,
      ) {
        var transaction_packages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
        var packages = transaction_packages.objectStore(PACKAGE_STORE_NAME);

        var putPackageRequest = packages.put(
          packageData,
          'package/' + packageName,
        );
        putPackageRequest.onsuccess = function(event) {
          var transaction_metadata = db.transaction(
            [METADATA_STORE_NAME],
            IDB_RW,
          );
          var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
          var putMetadataRequest = metadata.put(
            packageMeta,
            'metadata/' + packageName,
          );
          putMetadataRequest.onsuccess = function(event) {
            callback(packageData);
          };
          putMetadataRequest.onerror = function(error) {
            errback(error);
          };
        };
        putPackageRequest.onerror = function(error) {
          errback(error);
        };
      }

      function processPackageData(arrayBuffer) {
        Module.finishedDataFileDownloads++;
        assert(arrayBuffer, 'Loading data file failed.');
        assert(
          arrayBuffer instanceof ArrayBuffer,
          'bad input to processPackageData',
        );
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;

        // copy the entire loaded file into a spot in the heap. Files will refer to slices in that. They cannot be freed though
        // (we may be allocating before malloc is ready, during startup).
        if (Module['SPLIT_MEMORY'])
          Module.printErr(
            'warning: you should run the file packager with --no-heap-copy when SPLIT_MEMORY is used, otherwise copying into the heap may fail due to the splitting',
          );
        var ptr = Module['getMemory'](byteArray.length);
        Module['HEAPU8'].set(byteArray, ptr);
        DataRequest.prototype.byteArray = Module['HEAPU8'].subarray(
          ptr,
          ptr + byteArray.length,
        );

        var files = metadata.files;
        for (i = 0; i < files.length; ++i) {
          DataRequest.prototype.requests[files[i].filename].onload();
        }
        Module['removeRunDependency']('datafile_game.data');
      }
      Module['addRunDependency']('datafile_game.data');

      if (!Module.preloadResults) Module.preloadResults = {};

      function preloadFallback(error) {
        console.error(error);
        console.error('falling back to default preload behavior');
        fetchRemotePackage(
          PACKAGE_NAME,
          REMOTE_PACKAGE_SIZE,
          processPackageData,
          handleError,
        );
      }

      openDatabase(function(db) {
        checkCachedPackage(
          db,
          PACKAGE_PATH + PACKAGE_NAME,
          function(useCached) {
            Module.preloadResults[PACKAGE_NAME] = {
              fromCache: useCached
            };
            if (
              useCached &&
              !DEBUG_MODE &&
              localStorage.getItem('packageUuid') === PACKAGE_UUID // fix for when game.data is updated, it will force the user to redownload the new package instead of using the cached one
            ) {
              // disabled cached stuff when in debug mode
              console.info('loading ' + PACKAGE_NAME + ' from cache');
              fetchCachedPackage(
                db,
                PACKAGE_PATH + PACKAGE_NAME,
                processPackageData,
                preloadFallback,
              );
            } else {
              console.info('loading ' + PACKAGE_NAME + ' from remote');
              localStorage.setItem('packageUuid', PACKAGE_UUID);
              fetchRemotePackage(
                PACKAGE_NAME,
                REMOTE_PACKAGE_SIZE,
                function(packageData) {
                  cacheRemotePackage(
                    db,
                    PACKAGE_PATH + PACKAGE_NAME,
                    packageData, {
                      uuid: PACKAGE_UUID
                    },
                    processPackageData,
                    function(error) {
                      console.error(error);
                      processPackageData(packageData);
                    },
                  );
                },
                preloadFallback,
              );
            }
          },
          preloadFallback,
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
    "package_uuid": "1b380a60-d7a4-4c58-8079-98b3fd66a6af",
    "remote_package_size": 95875349,
    "files": [
        {
            "filename": "/back.lua",
            "crunched": 0,
            "start": 0,
            "end": 15441,
            "audio": false
        },
        {
            "filename": "/bit.lua",
            "crunched": 0,
            "start": 15441,
            "end": 16963,
            "audio": false
        },
        {
            "filename": "/blind.lua",
            "crunched": 0,
            "start": 16963,
            "end": 50145,
            "audio": false
        },
        {
            "filename": "/card_character.lua",
            "crunched": 0,
            "start": 50145,
            "end": 56988,
            "audio": false
        },
        {
            "filename": "/card.lua",
            "crunched": 0,
            "start": 56988,
            "end": 353530,
            "audio": false
        },
        {
            "filename": "/cardarea.lua",
            "crunched": 0,
            "start": 353530,
            "end": 389460,
            "audio": false
        },
        {
            "filename": "/challenges.lua",
            "crunched": 0,
            "start": 389460,
            "end": 413392,
            "audio": false
        },
        {
            "filename": "/conf.lua",
            "crunched": 0,
            "start": 413392,
            "end": 413602,
            "audio": false
        },
        {
            "filename": "/engine/animatedsprite.lua",
            "crunched": 0,
            "start": 413602,
            "end": 416934,
            "audio": false
        },
        {
            "filename": "/engine/controller.lua",
            "crunched": 0,
            "start": 416934,
            "end": 481722,
            "audio": false
        },
        {
            "filename": "/engine/event.lua",
            "crunched": 0,
            "start": 481722,
            "end": 488781,
            "audio": false
        },
        {
            "filename": "/engine/http_manager.lua",
            "crunched": 0,
            "start": 488781,
            "end": 489451,
            "audio": false
        },
        {
            "filename": "/engine/moveable.lua",
            "crunched": 0,
            "start": 489451,
            "end": 510743,
            "audio": false
        },
        {
            "filename": "/engine/node.lua",
            "crunched": 0,
            "start": 510743,
            "end": 526838,
            "audio": false
        },
        {
            "filename": "/engine/object.lua",
            "crunched": 0,
            "start": 526838,
            "end": 527504,
            "audio": false
        },
        {
            "filename": "/engine/particles.lua",
            "crunched": 0,
            "start": 527504,
            "end": 534099,
            "audio": false
        },
        {
            "filename": "/engine/profile.lua",
            "crunched": 0,
            "start": 534099,
            "end": 538672,
            "audio": false
        },
        {
            "filename": "/engine/save_manager.lua",
            "crunched": 0,
            "start": 538672,
            "end": 542512,
            "audio": false
        },
        {
            "filename": "/engine/sound_manager.lua",
            "crunched": 0,
            "start": 542512,
            "end": 549998,
            "audio": false
        },
        {
            "filename": "/engine/sprite.lua",
            "crunched": 0,
            "start": 549998,
            "end": 558644,
            "audio": false
        },
        {
            "filename": "/engine/string_packer.lua",
            "crunched": 0,
            "start": 558644,
            "end": 561424,
            "audio": false
        },
        {
            "filename": "/engine/text.lua",
            "crunched": 0,
            "start": 561424,
            "end": 582105,
            "audio": false
        },
        {
            "filename": "/engine/ui.lua",
            "crunched": 0,
            "start": 582105,
            "end": 631708,
            "audio": false
        },
        {
            "filename": "/functions/button_callbacks.lua",
            "crunched": 0,
            "start": 631708,
            "end": 753665,
            "audio": false
        },
        {
            "filename": "/functions/common_events.lua",
            "crunched": 0,
            "start": 753665,
            "end": 943417,
            "audio": false
        },
        {
            "filename": "/functions/misc_functions.lua",
            "crunched": 0,
            "start": 943417,
            "end": 1023968,
            "audio": false
        },
        {
            "filename": "/functions/state_events.lua",
            "crunched": 0,
            "start": 1023968,
            "end": 1098046,
            "audio": false
        },
        {
            "filename": "/functions/test_functions.lua",
            "crunched": 0,
            "start": 1098046,
            "end": 1106195,
            "audio": false
        },
        {
            "filename": "/functions/UI_definitions.lua",
            "crunched": 0,
            "start": 1106195,
            "end": 1481517,
            "audio": false
        },
        {
            "filename": "/game.lua",
            "crunched": 0,
            "start": 1481517,
            "end": 1726351,
            "audio": false
        },
        {
            "filename": "/globals.lua",
            "crunched": 0,
            "start": 1726351,
            "end": 1747939,
            "audio": false
        },
        {
            "filename": "/json.lua",
            "crunched": 0,
            "start": 1747939,
            "end": 1757576,
            "audio": false
        },
        {
            "filename": "/localization/de.lua",
            "crunched": 0,
            "start": 1757576,
            "end": 1912257,
            "audio": false
        },
        {
            "filename": "/localization/en-us.lua",
            "crunched": 0,
            "start": 1912257,
            "end": 2058943,
            "audio": false
        },
        {
            "filename": "/localization/es_419.lua",
            "crunched": 0,
            "start": 2058943,
            "end": 2212505,
            "audio": false
        },
        {
            "filename": "/localization/es_ES.lua",
            "crunched": 0,
            "start": 2212505,
            "end": 2366175,
            "audio": false
        },
        {
            "filename": "/localization/fr.lua",
            "crunched": 0,
            "start": 2366175,
            "end": 2523725,
            "audio": false
        },
        {
            "filename": "/localization/id.lua",
            "crunched": 0,
            "start": 2523725,
            "end": 2675382,
            "audio": false
        },
        {
            "filename": "/localization/it.lua",
            "crunched": 0,
            "start": 2675382,
            "end": 2827248,
            "audio": false
        },
        {
            "filename": "/localization/ja.lua",
            "crunched": 0,
            "start": 2827248,
            "end": 2995645,
            "audio": false
        },
        {
            "filename": "/localization/ko.lua",
            "crunched": 0,
            "start": 2995645,
            "end": 3155718,
            "audio": false
        },
        {
            "filename": "/localization/nl.lua",
            "crunched": 0,
            "start": 3155718,
            "end": 3308489,
            "audio": false
        },
        {
            "filename": "/localization/pl.lua",
            "crunched": 0,
            "start": 3308489,
            "end": 3463375,
            "audio": false
        },
        {
            "filename": "/localization/pt_BR.lua",
            "crunched": 0,
            "start": 3463375,
            "end": 3616757,
            "audio": false
        },
        {
            "filename": "/localization/ru.lua",
            "crunched": 0,
            "start": 3616757,
            "end": 3798628,
            "audio": false
        },
        {
            "filename": "/localization/zh_CN.lua",
            "crunched": 0,
            "start": 3798628,
            "end": 3946035,
            "audio": false
        },
        {
            "filename": "/localization/zh_TW.lua",
            "crunched": 0,
            "start": 3946035,
            "end": 4093077,
            "audio": false
        },
        {
            "filename": "/lovely.lua",
            "crunched": 0,
            "start": 4093077,
            "end": 4093295,
            "audio": false
        },
        {
            "filename": "/lovely/SMODS/preflight/core/src/preflight/core.lua",
            "crunched": 0,
            "start": 4093295,
            "end": 4098884,
            "audio": false
        },
        {
            "filename": "/main.lua",
            "crunched": 0,
            "start": 4098884,
            "end": 4164342,
            "audio": false
        },
        {
            "filename": "/manifest.json",
            "crunched": 0,
            "start": 4164342,
            "end": 4203988,
            "audio": false
        },
        {
            "filename": "/Mods/config/Multiplayer.jkr",
            "crunched": 0,
            "start": 4203988,
            "end": 4204403,
            "audio": false
        },
        {
            "filename": "/Mods/config/Steamodded.jkr",
            "crunched": 0,
            "start": 4204403,
            "end": 4204588,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/.env.example",
            "crunched": 0,
            "start": 4204588,
            "end": 4204820,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/.gitignore",
            "crunched": 0,
            "start": 4204820,
            "end": 4204938,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/agents.md",
            "crunched": 0,
            "start": 4204938,
            "end": 4225485,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 4225485,
            "end": 4229733,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/alt_stickers.png",
            "crunched": 0,
            "start": 4229733,
            "end": 4231287,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/b_heidelberg.png",
            "crunched": 0,
            "start": 4231287,
            "end": 4232494,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/blind_col.png",
            "crunched": 0,
            "start": 4232494,
            "end": 4337830,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 4337830,
            "end": 4363075,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/c_asteroid.png",
            "crunched": 0,
            "start": 4363075,
            "end": 4370127,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/c_ouija_2.png",
            "crunched": 0,
            "start": 4370127,
            "end": 4371526,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/deck_stickers.png",
            "crunched": 0,
            "start": 4371526,
            "end": 4398152,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/decks.png",
            "crunched": 0,
            "start": 4398152,
            "end": 4425151,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 4425151,
            "end": 4623449,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 4623449,
            "end": 4728826,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 4728826,
            "end": 4739694,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 4739694,
            "end": 4746728,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 4746728,
            "end": 4756942,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 4756942,
            "end": 4765635,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 4765635,
            "end": 4768557,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 4768557,
            "end": 4779294,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_copycat.png",
            "crunched": 0,
            "start": 4779294,
            "end": 4786015,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_defensive_joker.png",
            "crunched": 0,
            "start": 4786015,
            "end": 4787983,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 4787983,
            "end": 4788799,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 4788799,
            "end": 4795218,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 4795218,
            "end": 4807203,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 4807203,
            "end": 4809924,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 4809924,
            "end": 4815091,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 4815091,
            "end": 4823628,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 4823628,
            "end": 4827241,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 4827241,
            "end": 4837190,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 4837190,
            "end": 4849691,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_magnet.png",
            "crunched": 0,
            "start": 4849691,
            "end": 4854486,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 4854486,
            "end": 4863614,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 4863614,
            "end": 4868102,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_order_sandbox.png",
            "crunched": 0,
            "start": 4868102,
            "end": 4876713,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_pacifist.png",
            "crunched": 0,
            "start": 4876713,
            "end": 4878698,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_penny_pincher.png",
            "crunched": 0,
            "start": 4878698,
            "end": 4880993,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 4880993,
            "end": 4891133,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_pizza.png",
            "crunched": 0,
            "start": 4891133,
            "end": 4894531,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 4894531,
            "end": 4896275,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 4896275,
            "end": 4903039,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 4903039,
            "end": 4910192,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_skip_off.png",
            "crunched": 0,
            "start": 4910192,
            "end": 4911988,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_speedrun.png",
            "crunched": 0,
            "start": 4911988,
            "end": 4912603,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_square_sandbox.png",
            "crunched": 0,
            "start": 4912603,
            "end": 4916835,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 4916835,
            "end": 4922877,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_taxes.png",
            "crunched": 0,
            "start": 4922877,
            "end": 4929918,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 4929918,
            "end": 4939703,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 4939703,
            "end": 4946807,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/modicon.png",
            "crunched": 0,
            "start": 4946807,
            "end": 4947277,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/player_blind_row.png",
            "crunched": 0,
            "start": 4947277,
            "end": 4948847,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/release_jokers.png",
            "crunched": 0,
            "start": 4948847,
            "end": 5538145,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/stakes-chips.png",
            "crunched": 0,
            "start": 5538145,
            "end": 5540175,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/standard_giga.png",
            "crunched": 0,
            "start": 5540175,
            "end": 5544159,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/sticker_balanced.png",
            "crunched": 0,
            "start": 5544159,
            "end": 5548652,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/sticker_nemesis.png",
            "crunched": 0,
            "start": 5548652,
            "end": 5549214,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/stickers.png",
            "crunched": 0,
            "start": 5549214,
            "end": 5553598,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/1x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 5553598,
            "end": 5555391,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 5555391,
            "end": 5577421,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/alt_stickers.png",
            "crunched": 0,
            "start": 5577421,
            "end": 5580889,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/b_heidelberg.png",
            "crunched": 0,
            "start": 5580889,
            "end": 5583392,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/blind_col.png",
            "crunched": 0,
            "start": 5583392,
            "end": 5775653,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 5775653,
            "end": 5783365,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/c_asteroid.png",
            "crunched": 0,
            "start": 5783365,
            "end": 5791583,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/c_ouija_2.png",
            "crunched": 0,
            "start": 5791583,
            "end": 5794522,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/deck_stickers.png",
            "crunched": 0,
            "start": 5794522,
            "end": 5835931,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/decks.png",
            "crunched": 0,
            "start": 5835931,
            "end": 5886730,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 5886730,
            "end": 6147988,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 6147988,
            "end": 6205788,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 6205788,
            "end": 6232910,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 6232910,
            "end": 6246252,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 6246252,
            "end": 6271350,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 6271350,
            "end": 6294306,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 6294306,
            "end": 6297508,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 6297508,
            "end": 6322995,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_copycat.png",
            "crunched": 0,
            "start": 6322995,
            "end": 6330524,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_defensive_joker.png",
            "crunched": 0,
            "start": 6330524,
            "end": 6332926,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 6332926,
            "end": 6334580,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 6334580,
            "end": 6349645,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 6349645,
            "end": 6379470,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 6379470,
            "end": 6389925,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 6389925,
            "end": 6400687,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 6400687,
            "end": 6419941,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 6419941,
            "end": 6423926,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 6423926,
            "end": 6447188,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 6447188,
            "end": 6488405,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_magnet.png",
            "crunched": 0,
            "start": 6488405,
            "end": 6494577,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 6494577,
            "end": 6516543,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 6516543,
            "end": 6538680,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_order_sandbox.png",
            "crunched": 0,
            "start": 6538680,
            "end": 6559052,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_pacifist.png",
            "crunched": 0,
            "start": 6559052,
            "end": 6561553,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_penny_pincher.png",
            "crunched": 0,
            "start": 6561553,
            "end": 6564354,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 6564354,
            "end": 6589713,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_pizza.png",
            "crunched": 0,
            "start": 6589713,
            "end": 6593720,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 6593720,
            "end": 6599159,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 6599159,
            "end": 6614066,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 6614066,
            "end": 6630148,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_skip_off.png",
            "crunched": 0,
            "start": 6630148,
            "end": 6632324,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_speedrun.png",
            "crunched": 0,
            "start": 6632324,
            "end": 6633608,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_square_sandbox.png",
            "crunched": 0,
            "start": 6633608,
            "end": 6642961,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 6642961,
            "end": 6656170,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_taxes.png",
            "crunched": 0,
            "start": 6656170,
            "end": 6660263,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 6660263,
            "end": 6683752,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 6683752,
            "end": 6701060,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/modicon.png",
            "crunched": 0,
            "start": 6701060,
            "end": 6701763,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/player_blind_row.png",
            "crunched": 0,
            "start": 6701763,
            "end": 6706041,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/release_jokers.png",
            "crunched": 0,
            "start": 6706041,
            "end": 7570951,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/stakes-chips.png",
            "crunched": 0,
            "start": 7570951,
            "end": 7579726,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/standard_giga.png",
            "crunched": 0,
            "start": 7579726,
            "end": 7588164,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/sticker_balanced.png",
            "crunched": 0,
            "start": 7588164,
            "end": 7589183,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/sticker_nemesis.png",
            "crunched": 0,
            "start": 7589183,
            "end": 7590075,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/assets/2x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 7590075,
            "end": 7590778,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/CHANGELOG.md",
            "crunched": 0,
            "start": 7590778,
            "end": 7592900,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/_compatibility.lua",
            "crunched": 0,
            "start": 7592900,
            "end": 7594895,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/AntePreview.lua",
            "crunched": 0,
            "start": 7594895,
            "end": 7595286,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/CodexArcanum.lua",
            "crunched": 0,
            "start": 7595286,
            "end": 7595512,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Cryptid.lua",
            "crunched": 0,
            "start": 7595512,
            "end": 7597413,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Distro.lua",
            "crunched": 0,
            "start": 7597413,
            "end": 7600149,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/ExtraCredit.lua",
            "crunched": 0,
            "start": 7600149,
            "end": 7600348,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Handy.lua",
            "crunched": 0,
            "start": 7600348,
            "end": 7605490,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/HotPotato.lua",
            "crunched": 0,
            "start": 7605490,
            "end": 7609303,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Jen.lua",
            "crunched": 0,
            "start": 7609303,
            "end": 7609574,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/JokerDisplay.lua",
            "crunched": 0,
            "start": 7609574,
            "end": 7618436,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Ortalab.lua",
            "crunched": 0,
            "start": 7618436,
            "end": 7618740,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Pokermon.lua",
            "crunched": 0,
            "start": 7618740,
            "end": 7618987,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/CorePreview.lua",
            "crunched": 0,
            "start": 7618987,
            "end": 7628357,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/EngineSimulate.lua",
            "crunched": 0,
            "start": 7628357,
            "end": 7644915,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/InitPreview.lua",
            "crunched": 0,
            "start": 7644915,
            "end": 7649148,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/InitSimulate.lua",
            "crunched": 0,
            "start": 7649148,
            "end": 7650160,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/InterfacePreview.lua",
            "crunched": 0,
            "start": 7650160,
            "end": 7655106,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/Jokers/_Vanilla.lua",
            "crunched": 0,
            "start": 7655106,
            "end": 7690955,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/Jokers/Multiplayer.lua",
            "crunched": 0,
            "start": 7690955,
            "end": 7693333,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/UtilsPreview.lua",
            "crunched": 0,
            "start": 7693333,
            "end": 7694201,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Preview/UtilsSimulate.lua",
            "crunched": 0,
            "start": 7694201,
            "end": 7701428,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/StrangePencil.lua",
            "crunched": 0,
            "start": 7701428,
            "end": 7702055,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/Talisman.lua",
            "crunched": 0,
            "start": 7702055,
            "end": 7702103,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/TheOrder.lua",
            "crunched": 0,
            "start": 7702103,
            "end": 7726349,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/TooManyJokers.lua",
            "crunched": 0,
            "start": 7726349,
            "end": 7726757,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/compatibility/UpgradeMod.lua",
            "crunched": 0,
            "start": 7726757,
            "end": 7727618,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/config.lua",
            "crunched": 0,
            "start": 7727618,
            "end": 7727982,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/CONTRIBUTING.md",
            "crunched": 0,
            "start": 7727982,
            "end": 7732215,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/core.lua",
            "crunched": 0,
            "start": 7732215,
            "end": 7741514,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/gamemodes/_gamemodes.lua",
            "crunched": 0,
            "start": 7741514,
            "end": 7742420,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/gamemodes/attrition.lua",
            "crunched": 0,
            "start": 7742420,
            "end": 7746704,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/gamemodes/showdown.lua",
            "crunched": 0,
            "start": 7746704,
            "end": 7750913,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/gamemodes/survival.lua",
            "crunched": 0,
            "start": 7750913,
            "end": 7753674,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/_layers.lua",
            "crunched": 0,
            "start": 7753674,
            "end": 7762716,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/ban_mutators.lua",
            "crunched": 0,
            "start": 7762716,
            "end": 7763367,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/classic.lua",
            "crunched": 0,
            "start": 7763367,
            "end": 7763466,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/economy_mutators.lua",
            "crunched": 0,
            "start": 7763466,
            "end": 7764534,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/eeeee.lua",
            "crunched": 0,
            "start": 7764534,
            "end": 7765410,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/esoteric_mutators.lua",
            "crunched": 0,
            "start": 7765410,
            "end": 7765809,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/experimental.lua",
            "crunched": 0,
            "start": 7765809,
            "end": 7767820,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/glass_cannon.lua",
            "crunched": 0,
            "start": 7767820,
            "end": 7768608,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/glass_variants.lua",
            "crunched": 0,
            "start": 7768608,
            "end": 7768818,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/mutator_stubs.lua",
            "crunched": 0,
            "start": 7768818,
            "end": 7769072,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/no_anim_timer.lua",
            "crunched": 0,
            "start": 7769072,
            "end": 7769210,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/no_red_seals.lua",
            "crunched": 0,
            "start": 7769210,
            "end": 7770156,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/polymorph_spam.lua",
            "crunched": 0,
            "start": 7770156,
            "end": 7774335,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/pressure_timer.lua",
            "crunched": 0,
            "start": 7774335,
            "end": 7774867,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/pvp_timer.lua",
            "crunched": 0,
            "start": 7774867,
            "end": 7774971,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/ranked.lua",
            "crunched": 0,
            "start": 7774971,
            "end": 7775232,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/release.lua",
            "crunched": 0,
            "start": 7775232,
            "end": 7775323,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/sandbox.lua",
            "crunched": 0,
            "start": 7775323,
            "end": 7784061,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/score_instability.lua",
            "crunched": 0,
            "start": 7784061,
            "end": 7786108,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/shared_pockets.lua",
            "crunched": 0,
            "start": 7786108,
            "end": 7788751,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/shop_mutators.lua",
            "crunched": 0,
            "start": 7788751,
            "end": 7788836,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/smallworld.lua",
            "crunched": 0,
            "start": 7788836,
            "end": 7793943,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/speedlatro_timer.lua",
            "crunched": 0,
            "start": 7793943,
            "end": 7799175,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/standard.lua",
            "crunched": 0,
            "start": 7799175,
            "end": 7799731,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/layers/wraith_rework.lua",
            "crunched": 0,
            "start": 7799731,
            "end": 7799925,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/_init.lua",
            "crunched": 0,
            "start": 7799925,
            "end": 7799939,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/_table_utils.lua",
            "crunched": 0,
            "start": 7799939,
            "end": 7801513,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/blind_utils.lua",
            "crunched": 0,
            "start": 7801513,
            "end": 7802137,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/card_utils.lua",
            "crunched": 0,
            "start": 7802137,
            "end": 7808921,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/crypto.lua",
            "crunched": 0,
            "start": 7808921,
            "end": 7811120,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/debug_utils.lua",
            "crunched": 0,
            "start": 7811120,
            "end": 7811868,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/ghost_replay.lua",
            "crunched": 0,
            "start": 7811868,
            "end": 7824085,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/insane_int.lua",
            "crunched": 0,
            "start": 7824085,
            "end": 7828264,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/joker_stats.lua",
            "crunched": 0,
            "start": 7828264,
            "end": 7829535,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/log_parser.lua",
            "crunched": 0,
            "start": 7829535,
            "end": 7842745,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/matchmaking.lua",
            "crunched": 0,
            "start": 7842745,
            "end": 7851843,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/practice_mode.lua",
            "crunched": 0,
            "start": 7851843,
            "end": 7853933,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/replay_log.lua",
            "crunched": 0,
            "start": 7853933,
            "end": 7863458,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/ruleset_utils.lua",
            "crunched": 0,
            "start": 7863458,
            "end": 7865600,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/serialization.lua",
            "crunched": 0,
            "start": 7865600,
            "end": 7868399,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/settings_utils.lua",
            "crunched": 0,
            "start": 7868399,
            "end": 7868399,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/string_utils.lua",
            "crunched": 0,
            "start": 7868399,
            "end": 7869183,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/lib/ui.lua",
            "crunched": 0,
            "start": 7869183,
            "end": 7872237,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/LICENSE.md",
            "crunched": 0,
            "start": 7872237,
            "end": 7907386,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/de.lua",
            "crunched": 0,
            "start": 7907386,
            "end": 7916404,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/en-us.lua",
            "crunched": 0,
            "start": 7916404,
            "end": 7967513,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/es_419.lua",
            "crunched": 0,
            "start": 7967513,
            "end": 8003667,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/es_ES.lua",
            "crunched": 0,
            "start": 8003667,
            "end": 8016451,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/fr.lua",
            "crunched": 0,
            "start": 8016451,
            "end": 8030200,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/it.lua",
            "crunched": 0,
            "start": 8030200,
            "end": 8057993,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/ja.lua",
            "crunched": 0,
            "start": 8057993,
            "end": 8092249,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/ko.lua",
            "crunched": 0,
            "start": 8092249,
            "end": 8125655,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/mi.lua",
            "crunched": 0,
            "start": 8125655,
            "end": 8135783,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/nl.lua",
            "crunched": 0,
            "start": 8135783,
            "end": 8149383,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/pl.lua",
            "crunched": 0,
            "start": 8149383,
            "end": 8162282,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/pt_BR.lua",
            "crunched": 0,
            "start": 8162282,
            "end": 8177266,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/ru.lua",
            "crunched": 0,
            "start": 8177266,
            "end": 8246302,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/stylua.toml",
            "crunched": 0,
            "start": 8246302,
            "end": 8246436,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/vi.lua",
            "crunched": 0,
            "start": 8246436,
            "end": 8292079,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/zh_CN.lua",
            "crunched": 0,
            "start": 8292079,
            "end": 8309470,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/localization/zh_TW.lua",
            "crunched": 0,
            "start": 8309470,
            "end": 8312392,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/Multiplayer.json",
            "crunched": 0,
            "start": 8312392,
            "end": 8313022,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/networking/action_handlers.lua",
            "crunched": 0,
            "start": 8313022,
            "end": 8359879,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/networking/socket.lua",
            "crunched": 0,
            "start": 8359879,
            "end": 8366379,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/blinds/nemesis.lua",
            "crunched": 0,
            "start": 8366379,
            "end": 8367132,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/boosters/standard_giga.lua",
            "crunched": 0,
            "start": 8367132,
            "end": 8368317,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/all_must_go.lua",
            "crunched": 0,
            "start": 8368317,
            "end": 8368505,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/bacon.lua",
            "crunched": 0,
            "start": 8368505,
            "end": 8369647,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/balancing_act.lua",
            "crunched": 0,
            "start": 8369647,
            "end": 8370154,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/chore_list.lua",
            "crunched": 0,
            "start": 8370154,
            "end": 8370939,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/divination.lua",
            "crunched": 0,
            "start": 8370939,
            "end": 8371085,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/eeeee.lua",
            "crunched": 0,
            "start": 8371085,
            "end": 8371311,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/high_hand.lua",
            "crunched": 0,
            "start": 8371311,
            "end": 8371610,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/in_the_red.lua",
            "crunched": 0,
            "start": 8371610,
            "end": 8372004,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/legendaries.lua",
            "crunched": 0,
            "start": 8372004,
            "end": 8372619,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/lets_go_gambling.lua",
            "crunched": 0,
            "start": 8372619,
            "end": 8373620,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/misprint_deck.lua",
            "crunched": 0,
            "start": 8373620,
            "end": 8373857,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/oops_all_jokers.lua",
            "crunched": 0,
            "start": 8373857,
            "end": 8375059,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/planet_tycoon.lua",
            "crunched": 0,
            "start": 8375059,
            "end": 8375460,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/polymorph_spam.lua",
            "crunched": 0,
            "start": 8375460,
            "end": 8376133,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/psychosis.lua",
            "crunched": 0,
            "start": 8376133,
            "end": 8376277,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/salvaged_sibyl.lua",
            "crunched": 0,
            "start": 8376277,
            "end": 8378357,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/scratch.lua",
            "crunched": 0,
            "start": 8378357,
            "end": 8378624,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/shared_pockets.lua",
            "crunched": 0,
            "start": 8378624,
            "end": 8378998,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/skip_off.lua",
            "crunched": 0,
            "start": 8378998,
            "end": 8379187,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/speed.lua",
            "crunched": 0,
            "start": 8379187,
            "end": 8379426,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/twin_towers.lua",
            "crunched": 0,
            "start": 8379426,
            "end": 8379612,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/challenges/vantablack.lua",
            "crunched": 0,
            "start": 8379612,
            "end": 8379980,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/consumables/asteroid.lua",
            "crunched": 0,
            "start": 8379980,
            "end": 8381430,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/consumables/judgement.lua",
            "crunched": 0,
            "start": 8381430,
            "end": 8383896,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/consumables/ouija.lua",
            "crunched": 0,
            "start": 8383896,
            "end": 8386415,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/consumables/sandbox/ectoplasm.lua",
            "crunched": 0,
            "start": 8386415,
            "end": 8388109,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/consumables/wraith.lua",
            "crunched": 0,
            "start": 8388109,
            "end": 8389015,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/_decks.lua",
            "crunched": 0,
            "start": 8389015,
            "end": 8390045,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/00_violet.lua",
            "crunched": 0,
            "start": 8390045,
            "end": 8390876,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/01_indigo.lua",
            "crunched": 0,
            "start": 8390876,
            "end": 8393931,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/02_orange.lua",
            "crunched": 0,
            "start": 8393931,
            "end": 8395202,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/09_white.lua",
            "crunched": 0,
            "start": 8395202,
            "end": 8396188,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/AA_oracle.lua",
            "crunched": 0,
            "start": 8396188,
            "end": 8396985,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/BB_gradient.lua",
            "crunched": 0,
            "start": 8396985,
            "end": 8402523,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/CC_heidelberg.lua",
            "crunched": 0,
            "start": 8402523,
            "end": 8403243,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/EC_echo_deck.lua",
            "crunched": 0,
            "start": 8403243,
            "end": 8404592,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/decks/ZZ_cocktail.lua",
            "crunched": 0,
            "start": 8404592,
            "end": 8423956,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/editions/phantom.lua",
            "crunched": 0,
            "start": 8423956,
            "end": 8425103,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/enhancements/mp_glass.lua",
            "crunched": 0,
            "start": 8425103,
            "end": 8425310,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/conjoined_joker.lua",
            "crunched": 0,
            "start": 8425310,
            "end": 8427113,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/defensive_joker.lua",
            "crunched": 0,
            "start": 8427113,
            "end": 8428510,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/experimental/baron_uncommon.lua",
            "crunched": 0,
            "start": 8428510,
            "end": 8429237,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/experimental/idol_rare.lua",
            "crunched": 0,
            "start": 8429237,
            "end": 8430171,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/experimental/mime_rare.lua",
            "crunched": 0,
            "start": 8430171,
            "end": 8430659,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/experimental/todo_list.lua",
            "crunched": 0,
            "start": 8430659,
            "end": 8432272,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/lets_go_gambling.lua",
            "crunched": 0,
            "start": 8432272,
            "end": 8434557,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/pacifist.lua",
            "crunched": 0,
            "start": 8434557,
            "end": 8435369,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/penny_pincher.lua",
            "crunched": 0,
            "start": 8435369,
            "end": 8436495,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/pizza.lua",
            "crunched": 0,
            "start": 8436495,
            "end": 8438197,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/baseball.lua",
            "crunched": 0,
            "start": 8438197,
            "end": 8439049,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/bloodstone.lua",
            "crunched": 0,
            "start": 8439049,
            "end": 8440156,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/castle.lua",
            "crunched": 0,
            "start": 8440156,
            "end": 8441631,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/cloud_9.lua",
            "crunched": 0,
            "start": 8441631,
            "end": 8443343,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/constellation.lua",
            "crunched": 0,
            "start": 8443343,
            "end": 8444958,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/error.lua",
            "crunched": 0,
            "start": 8444958,
            "end": 8449686,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/_ec_atlas.lua",
            "crunched": 0,
            "start": 8449686,
            "end": 8450049,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/_ec_utils.lua",
            "crunched": 0,
            "start": 8450049,
            "end": 8453381,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/alloy.lua",
            "crunched": 0,
            "start": 8453381,
            "end": 8454281,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/ambrosia.lua",
            "crunched": 0,
            "start": 8454281,
            "end": 8456509,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/bobby.lua",
            "crunched": 0,
            "start": 8456509,
            "end": 8458264,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/candynecklace.lua",
            "crunched": 0,
            "start": 8458264,
            "end": 8460071,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/chainlightning.lua",
            "crunched": 0,
            "start": 8460071,
            "end": 8461555,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/clowncar.lua",
            "crunched": 0,
            "start": 8461555,
            "end": 8462553,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/clowncollege.lua",
            "crunched": 0,
            "start": 8462553,
            "end": 8464238,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/couponsheet.lua",
            "crunched": 0,
            "start": 8464238,
            "end": 8465961,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/doublerainbow.lua",
            "crunched": 0,
            "start": 8465961,
            "end": 8467288,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/espresso.lua",
            "crunched": 0,
            "start": 8467288,
            "end": 8469848,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/farmer.lua",
            "crunched": 0,
            "start": 8469848,
            "end": 8470986,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/forklift.lua",
            "crunched": 0,
            "start": 8470986,
            "end": 8472145,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/gofish.lua",
            "crunched": 0,
            "start": 8472145,
            "end": 8473806,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/hoarder.lua",
            "crunched": 0,
            "start": 8473806,
            "end": 8474394,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/jokalisa.lua",
            "crunched": 0,
            "start": 8474394,
            "end": 8476132,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/jokeroftheyear.lua",
            "crunched": 0,
            "start": 8476132,
            "end": 8476965,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/lucky7.lua",
            "crunched": 0,
            "start": 8476965,
            "end": 8478499,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/montehaul.lua",
            "crunched": 0,
            "start": 8478499,
            "end": 8480631,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/pocketaces.lua",
            "crunched": 0,
            "start": 8480631,
            "end": 8481851,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/pyromancer.lua",
            "crunched": 0,
            "start": 8481851,
            "end": 8482811,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/shipoftheseus.lua",
            "crunched": 0,
            "start": 8482811,
            "end": 8485028,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/starfruit.lua",
            "crunched": 0,
            "start": 8485028,
            "end": 8487419,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/trafficlight.lua",
            "crunched": 0,
            "start": 8487419,
            "end": 8489191,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/tuxedo.lua",
            "crunched": 0,
            "start": 8489191,
            "end": 8490597,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/warlock.lua",
            "crunched": 0,
            "start": 8490597,
            "end": 8493072,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/extra-credit/werewolf.lua",
            "crunched": 0,
            "start": 8493072,
            "end": 8494410,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/faceless.lua",
            "crunched": 0,
            "start": 8494410,
            "end": 8495817,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/golden_ticket.lua",
            "crunched": 0,
            "start": 8495817,
            "end": 8497177,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/hit_the_road.lua",
            "crunched": 0,
            "start": 8497177,
            "end": 8498347,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/idol.lua",
            "crunched": 0,
            "start": 8498347,
            "end": 8504754,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/juggler.lua",
            "crunched": 0,
            "start": 8504754,
            "end": 8506575,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/loyalty_card.lua",
            "crunched": 0,
            "start": 8506575,
            "end": 8508770,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/lucky_cat.lua",
            "crunched": 0,
            "start": 8508770,
            "end": 8510096,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/magnet_sandbox.lua",
            "crunched": 0,
            "start": 8510096,
            "end": 8513012,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/mail.lua",
            "crunched": 0,
            "start": 8513012,
            "end": 8514571,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/misprint.lua",
            "crunched": 0,
            "start": 8514571,
            "end": 8515725,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/order.lua",
            "crunched": 0,
            "start": 8515725,
            "end": 8517084,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/photograph.lua",
            "crunched": 0,
            "start": 8517084,
            "end": 8518093,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/ride_the_bus.lua",
            "crunched": 0,
            "start": 8518093,
            "end": 8519974,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/runner.lua",
            "crunched": 0,
            "start": 8519974,
            "end": 8521058,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/satellite.lua",
            "crunched": 0,
            "start": 8521058,
            "end": 8522589,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/square.lua",
            "crunched": 0,
            "start": 8522589,
            "end": 8523713,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/steel_joker.lua",
            "crunched": 0,
            "start": 8523713,
            "end": 8524564,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/throwback.lua",
            "crunched": 0,
            "start": 8524564,
            "end": 8526876,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/sandbox/vampire.lua",
            "crunched": 0,
            "start": 8526876,
            "end": 8529068,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/skip_off.lua",
            "crunched": 0,
            "start": 8529068,
            "end": 8530939,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/speedrun.lua",
            "crunched": 0,
            "start": 8530939,
            "end": 8532663,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/bloodstone.lua",
            "crunched": 0,
            "start": 8532663,
            "end": 8534778,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/hanging_chad.lua",
            "crunched": 0,
            "start": 8534778,
            "end": 8535623,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/ice_cream.lua",
            "crunched": 0,
            "start": 8535623,
            "end": 8536743,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/seltzer.lua",
            "crunched": 0,
            "start": 8536743,
            "end": 8538960,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/ticket.lua",
            "crunched": 0,
            "start": 8538960,
            "end": 8540847,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/standard/turtle_bean.lua",
            "crunched": 0,
            "start": 8540847,
            "end": 8542151,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/jokers/taxes.lua",
            "crunched": 0,
            "start": 8542151,
            "end": 8543741,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/seals/mp_gold_seal.lua",
            "crunched": 0,
            "start": 8543741,
            "end": 8544040,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/00_planet.lua",
            "crunched": 0,
            "start": 8544040,
            "end": 8544721,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/01_spectral.lua",
            "crunched": 0,
            "start": 8544721,
            "end": 8545130,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/02_spectralplus.lua",
            "crunched": 0,
            "start": 8545130,
            "end": 8545496,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/1_plastic.lua",
            "crunched": 0,
            "start": 8545496,
            "end": 8548238,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/2_pebble.lua",
            "crunched": 0,
            "start": 8548238,
            "end": 8548672,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/3_ferrite.lua",
            "crunched": 0,
            "start": 8548672,
            "end": 8549095,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/4_pyrite.lua",
            "crunched": 0,
            "start": 8549095,
            "end": 8550085,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/5_jade.lua",
            "crunched": 0,
            "start": 8550085,
            "end": 8550513,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/6_crystal.lua",
            "crunched": 0,
            "start": 8550513,
            "end": 8550929,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/7_antimatter.lua",
            "crunched": 0,
            "start": 8550929,
            "end": 8551355,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stakes/atlas.lua",
            "crunched": 0,
            "start": 8551355,
            "end": 8551536,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/_stickers.lua",
            "crunched": 0,
            "start": 8551536,
            "end": 8554195,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/1_persistent.lua",
            "crunched": 0,
            "start": 8554195,
            "end": 8558873,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/2_unreliable.lua",
            "crunched": 0,
            "start": 8558873,
            "end": 8559355,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/3_draining.lua",
            "crunched": 0,
            "start": 8559355,
            "end": 8559728,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/balanced.lua",
            "crunched": 0,
            "start": 8559728,
            "end": 8560211,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/extra_credit.lua",
            "crunched": 0,
            "start": 8560211,
            "end": 8560425,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/stickers/nemesis.lua",
            "crunched": 0,
            "start": 8560425,
            "end": 8560698,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/tags/gambling_sandbox.lua",
            "crunched": 0,
            "start": 8560698,
            "end": 8562500,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/tags/investment_sandbox.lua",
            "crunched": 0,
            "start": 8562500,
            "end": 8563604,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/objects/tags/juggle_sandbox.lua",
            "crunched": 0,
            "start": 8563604,
            "end": 8564240,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/overrides/disable_restart.lua",
            "crunched": 0,
            "start": 8564240,
            "end": 8564410,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/overrides/game.lua",
            "crunched": 0,
            "start": 8564410,
            "end": 8570506,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/overrides/hide_content.lua",
            "crunched": 0,
            "start": 8570506,
            "end": 8572728,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/overrides/mod_badges.lua",
            "crunched": 0,
            "start": 8572728,
            "end": 8575664,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/README.md",
            "crunched": 0,
            "start": 8575664,
            "end": 8579009,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/replays/.gitkeep",
            "crunched": 0,
            "start": 8579009,
            "end": 8579009,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/_rulesets.lua",
            "crunched": 0,
            "start": 8579009,
            "end": 8590544,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/badlatro.lua",
            "crunched": 0,
            "start": 8590544,
            "end": 8591747,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/blitz.lua",
            "crunched": 0,
            "start": 8591747,
            "end": 8591814,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/chaos.lua",
            "crunched": 0,
            "start": 8591814,
            "end": 8591930,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/experimental/experimental_legacy.lua",
            "crunched": 0,
            "start": 8591930,
            "end": 8592575,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/experimental/experimental.lua",
            "crunched": 0,
            "start": 8592575,
            "end": 8592847,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/legacy_ranked.lua",
            "crunched": 0,
            "start": 8592847,
            "end": 8592975,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/majorleague.lua",
            "crunched": 0,
            "start": 8592975,
            "end": 8593835,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/minorleague.lua",
            "crunched": 0,
            "start": 8593835,
            "end": 8594448,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/ranked.lua",
            "crunched": 0,
            "start": 8594448,
            "end": 8594592,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/release.lua",
            "crunched": 0,
            "start": 8594592,
            "end": 8616373,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/sandbox.lua",
            "crunched": 0,
            "start": 8616373,
            "end": 8616646,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/smallworld.lua",
            "crunched": 0,
            "start": 8616646,
            "end": 8616732,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/speedlatro.lua",
            "crunched": 0,
            "start": 8616732,
            "end": 8616868,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/traditional.lua",
            "crunched": 0,
            "start": 8616868,
            "end": 8617100,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/vanilla.lua",
            "crunched": 0,
            "start": 8617100,
            "end": 8617459,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/rulesets/wsob.lua",
            "crunched": 0,
            "start": 8617459,
            "end": 8618231,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/scripts/release.sh",
            "crunched": 0,
            "start": 8618231,
            "end": 8624104,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/stylua.toml",
            "crunched": 0,
            "start": 8624104,
            "end": 8624457,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/readme.md",
            "crunched": 0,
            "start": 8624457,
            "end": 8627679,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/ruleset_shape.snapshot.lua",
            "crunched": 0,
            "start": 8627679,
            "end": 8645471,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/test_rlog_checksum.lua",
            "crunched": 0,
            "start": 8645471,
            "end": 8647783,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/test_rlog_roundtrip.lua",
            "crunched": 0,
            "start": 8647783,
            "end": 8653093,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/test_rlog_stream.lua",
            "crunched": 0,
            "start": 8653093,
            "end": 8656518,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/test_ruleset_shape.lua",
            "crunched": 0,
            "start": 8656518,
            "end": 8667515,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/tests/test_serialization_guard.lua",
            "crunched": 0,
            "start": 8667515,
            "end": 8670488,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/_common/background_grouping.lua",
            "crunched": 0,
            "start": 8670488,
            "end": 8671063,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/_common/disableable_button.lua",
            "crunched": 0,
            "start": 8671063,
            "end": 8671940,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/_common/disableable_option_cycle.lua",
            "crunched": 0,
            "start": 8671940,
            "end": 8672283,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/_common/disableable_toggle.lua",
            "crunched": 0,
            "start": 8672283,
            "end": 8672945,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/_common/spacer.lua",
            "crunched": 0,
            "start": 8672945,
            "end": 8673218,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/blind_chip_sprite.lua",
            "crunched": 0,
            "start": 8673218,
            "end": 8673886,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/blind_choice.lua",
            "crunched": 0,
            "start": 8673886,
            "end": 8688294,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/blind_hud.lua",
            "crunched": 0,
            "start": 8688294,
            "end": 8698785,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/confirmation.lua",
            "crunched": 0,
            "start": 8698785,
            "end": 8699705,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/enemy_location.lua",
            "crunched": 0,
            "start": 8699705,
            "end": 8706496,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/functions.lua",
            "crunched": 0,
            "start": 8706496,
            "end": 8721259,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/game_end.lua",
            "crunched": 0,
            "start": 8721259,
            "end": 8739155,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/game_state.lua",
            "crunched": 0,
            "start": 8739155,
            "end": 8758927,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/lobby_info.lua",
            "crunched": 0,
            "start": 8758927,
            "end": 8766752,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/round.lua",
            "crunched": 0,
            "start": 8766752,
            "end": 8769841,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/ruleset_info_menu.lua",
            "crunched": 0,
            "start": 8769841,
            "end": 8774039,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/game/timer.lua",
            "crunched": 0,
            "start": 8774039,
            "end": 8793972,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/_lobby_options/advanced_tab.lua",
            "crunched": 0,
            "start": 8793972,
            "end": 8798624,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/_lobby_options/gameplay_tab.lua",
            "crunched": 0,
            "start": 8798624,
            "end": 8799264,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/_lobby_options/main_options.lua",
            "crunched": 0,
            "start": 8799264,
            "end": 8803120,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/_lobby_options/modifiers_tab.lua",
            "crunched": 0,
            "start": 8803120,
            "end": 8806191,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/_lobby_options/options_tab.lua",
            "crunched": 0,
            "start": 8806191,
            "end": 8808804,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/deck_stake_button.lua",
            "crunched": 0,
            "start": 8808804,
            "end": 8809971,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/leave_button.lua",
            "crunched": 0,
            "start": 8809971,
            "end": 8810274,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/lobby_code_buttons.lua",
            "crunched": 0,
            "start": 8810274,
            "end": 8810867,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/lobby.lua",
            "crunched": 0,
            "start": 8810867,
            "end": 8827705,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/players_display.lua",
            "crunched": 0,
            "start": 8827705,
            "end": 8828985,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/start_ready_button.lua",
            "crunched": 0,
            "start": 8828985,
            "end": 8833411,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/lobby/version_mismatch_warning.lua",
            "crunched": 0,
            "start": 8833411,
            "end": 8836981,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/dev_warning.lua",
            "crunched": 0,
            "start": 8836981,
            "end": 8839221,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/main_menu.lua",
            "crunched": 0,
            "start": 8839221,
            "end": 8841906,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/_modifiers_overlay.lua",
            "crunched": 0,
            "start": 8841906,
            "end": 8844106,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/_mutators_wall.lua",
            "crunched": 0,
            "start": 8844106,
            "end": 8859264,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/_practice_options_overlay.lua",
            "crunched": 0,
            "start": 8859264,
            "end": 8861474,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/custom_ruleset_editor.lua",
            "crunched": 0,
            "start": 8861474,
            "end": 8870813,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/gamemode_selection.lua",
            "crunched": 0,
            "start": 8870813,
            "end": 8875632,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/ghost_replay_picker.lua",
            "crunched": 0,
            "start": 8875632,
            "end": 8895158,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/join_lobby_button.lua",
            "crunched": 0,
            "start": 8895158,
            "end": 8895996,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/play_button_callbacks.lua",
            "crunched": 0,
            "start": 8895996,
            "end": 8900272,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/play_button.lua",
            "crunched": 0,
            "start": 8900272,
            "end": 8902207,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/ruleset_selection.lua",
            "crunched": 0,
            "start": 8902207,
            "end": 8922681,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/play_button/weekly_interrupt.lua",
            "crunched": 0,
            "start": 8922681,
            "end": 8923653,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/title_card.lua",
            "crunched": 0,
            "start": 8923653,
            "end": 8927642,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/main_menu/version_display.lua",
            "crunched": 0,
            "start": 8927642,
            "end": 8928196,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/shortcuts_menu.lua",
            "crunched": 0,
            "start": 8928196,
            "end": 8933799,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/smods_menu/config_tab.lua",
            "crunched": 0,
            "start": 8933799,
            "end": 8937375,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/smods_menu/credits_tab.lua",
            "crunched": 0,
            "start": 8937375,
            "end": 8938846,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/smods_menu/customization_tab.lua",
            "crunched": 0,
            "start": 8938846,
            "end": 8943540,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/smods_menu/smods_menu.lua",
            "crunched": 0,
            "start": 8943540,
            "end": 8944981,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer-0.5.5/ui/utils.lua",
            "crunched": 0,
            "start": 8944981,
            "end": 8948335,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitattributes",
            "crunched": 0,
            "start": 8948335,
            "end": 8948353,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitignore",
            "crunched": 0,
            "start": 8948353,
            "end": 8952256,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/default_achievements.png",
            "crunched": 0,
            "start": 8952256,
            "end": 8955192,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/dropdown_arrow.png",
            "crunched": 0,
            "start": 8955192,
            "end": 8955946,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/mod_tags.png",
            "crunched": 0,
            "start": 8955946,
            "end": 8958980,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/default_achievements.png",
            "crunched": 0,
            "start": 8958980,
            "end": 8962744,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/dropdown_arrow.png",
            "crunched": 0,
            "start": 8962744,
            "end": 8964322,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/mod_tags.png",
            "crunched": 0,
            "start": 8964322,
            "end": 8968250,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/cat.png",
            "crunched": 0,
            "start": 8968250,
            "end": 8987187,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xblindsize.ogg",
            "crunched": 0,
            "start": 8987187,
            "end": 9000548,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xchips.ogg",
            "crunched": 0,
            "start": 9000548,
            "end": 9025574,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xscore.ogg",
            "crunched": 0,
            "start": 9025574,
            "end": 9073051,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/config.lua",
            "crunched": 0,
            "start": 9073051,
            "end": 9073239,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/icon.png",
            "crunched": 0,
            "start": 9073239,
            "end": 9105720,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/luajit-curl.lua",
            "crunched": 0,
            "start": 9105720,
            "end": 9134459,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/smods-https.lua",
            "crunched": 0,
            "start": 9134459,
            "end": 9142937,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/init.lua",
            "crunched": 0,
            "start": 9142937,
            "end": 9142969,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/json.lua",
            "crunched": 0,
            "start": 9142969,
            "end": 9152606,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/icon.png",
            "crunched": 0,
            "start": 9152606,
            "end": 9294402,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/init.lua",
            "crunched": 0,
            "start": 9294402,
            "end": 9294439,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/LICENSE",
            "crunched": 0,
            "start": 9294439,
            "end": 9295494,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/manifest.json",
            "crunched": 0,
            "start": 9295494,
            "end": 9295785,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/nativefs.lua",
            "crunched": 0,
            "start": 9295785,
            "end": 9313999,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/README.md",
            "crunched": 0,
            "start": 9313999,
            "end": 9319387,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/LICENSE",
            "crunched": 0,
            "start": 9319387,
            "end": 9354536,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/de.lua",
            "crunched": 0,
            "start": 9354536,
            "end": 9368500,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/en-us.lua",
            "crunched": 0,
            "start": 9368500,
            "end": 9381026,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_419.lua",
            "crunched": 0,
            "start": 9381026,
            "end": 9394290,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_ES.lua",
            "crunched": 0,
            "start": 9394290,
            "end": 9407553,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/fr.lua",
            "crunched": 0,
            "start": 9407553,
            "end": 9415583,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/id.lua",
            "crunched": 0,
            "start": 9415583,
            "end": 9416601,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/it.lua",
            "crunched": 0,
            "start": 9416601,
            "end": 9423028,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ja.lua",
            "crunched": 0,
            "start": 9423028,
            "end": 9424126,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ko.lua",
            "crunched": 0,
            "start": 9424126,
            "end": 9431575,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/nl.lua",
            "crunched": 0,
            "start": 9431575,
            "end": 9432607,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pl.lua",
            "crunched": 0,
            "start": 9432607,
            "end": 9433636,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pt_BR.lua",
            "crunched": 0,
            "start": 9433636,
            "end": 9438991,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ru.lua",
            "crunched": 0,
            "start": 9438991,
            "end": 9448370,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_CN.lua",
            "crunched": 0,
            "start": 9448370,
            "end": 9457737,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_TW.lua",
            "crunched": 0,
            "start": 9457737,
            "end": 9458745,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/manifest.json",
            "crunched": 0,
            "start": 9458745,
            "end": 9458978,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/README.md",
            "crunched": 0,
            "start": 9458978,
            "end": 9460780,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/release.lua",
            "crunched": 0,
            "start": 9460780,
            "end": 9460817,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/card_draw.lua",
            "crunched": 0,
            "start": 9460817,
            "end": 9485584,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/compat_0_9_8.lua",
            "crunched": 0,
            "start": 9485584,
            "end": 9503654,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/core.lua",
            "crunched": 0,
            "start": 9503654,
            "end": 9505523,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/crash_handler.lua",
            "crunched": 0,
            "start": 9505523,
            "end": 9542784,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_object.lua",
            "crunched": 0,
            "start": 9542784,
            "end": 9714855,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_objects/attributes.lua",
            "crunched": 0,
            "start": 9714855,
            "end": 9727268,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/index.lua",
            "crunched": 0,
            "start": 9727268,
            "end": 9728681,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/overrides.lua",
            "crunched": 0,
            "start": 9728681,
            "end": 9841697,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/core.lua",
            "crunched": 0,
            "start": 9841697,
            "end": 9847281,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/loader.lua",
            "crunched": 0,
            "start": 9847281,
            "end": 9886889,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/logging.lua",
            "crunched": 0,
            "start": 9886889,
            "end": 9888801,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/main.lua",
            "crunched": 0,
            "start": 9888801,
            "end": 9891596,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 9891596,
            "end": 9897522,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 9897522,
            "end": 9900820,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/ui.lua",
            "crunched": 0,
            "start": 9900820,
            "end": 10033113,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils.lua",
            "crunched": 0,
            "start": 10033113,
            "end": 10205088,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils/weights.lua",
            "crunched": 0,
            "start": 10205088,
            "end": 10224218,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/tk_debug_window.py",
            "crunched": 0,
            "start": 10224218,
            "end": 10250047,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/version.lua",
            "crunched": 0,
            "start": 10250047,
            "end": 10250084,
            "audio": false
        },
        {
            "filename": "/resources/fonts/GoNotoCJKCore.ttf",
            "crunched": 0,
            "start": 10250084,
            "end": 28750056,
            "audio": false
        },
        {
            "filename": "/resources/fonts/GoNotoCurrent-Bold.ttf",
            "crunched": 0,
            "start": 28750056,
            "end": 43284100,
            "audio": false
        },
        {
            "filename": "/resources/fonts/m6x11plus.ttf",
            "crunched": 0,
            "start": 43284100,
            "end": 43319165,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSans-Bold.ttf",
            "crunched": 0,
            "start": 43319165,
            "end": 43901769,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansJP-Bold.ttf",
            "crunched": 0,
            "start": 43901769,
            "end": 49629597,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansKR-Bold.ttf",
            "crunched": 0,
            "start": 49629597,
            "end": 55820421,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansSC-Bold.ttf",
            "crunched": 0,
            "start": 55820421,
            "end": 66370537,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansTC-Bold.ttf",
            "crunched": 0,
            "start": 66370537,
            "end": 73475849,
            "audio": false
        },
        {
            "filename": "/resources/gamecontrollerdb.txt",
            "crunched": 0,
            "start": 73475849,
            "end": 73873673,
            "audio": false
        },
        {
            "filename": "/resources/shaders/background.fs",
            "crunched": 0,
            "start": 73873673,
            "end": 73876218,
            "audio": false
        },
        {
            "filename": "/resources/shaders/booster.fs",
            "crunched": 0,
            "start": 73876218,
            "end": 73881520,
            "audio": false
        },
        {
            "filename": "/resources/shaders/CRT.fs",
            "crunched": 0,
            "start": 73881520,
            "end": 73888715,
            "audio": false
        },
        {
            "filename": "/resources/shaders/debuff.fs",
            "crunched": 0,
            "start": 73888715,
            "end": 73893807,
            "audio": false
        },
        {
            "filename": "/resources/shaders/dissolve.fs",
            "crunched": 0,
            "start": 73893807,
            "end": 73898067,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flame.fs",
            "crunched": 0,
            "start": 73898067,
            "end": 73900924,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flash.fs",
            "crunched": 0,
            "start": 73900924,
            "end": 73901879,
            "audio": false
        },
        {
            "filename": "/resources/shaders/foil.fs",
            "crunched": 0,
            "start": 73901879,
            "end": 73907748,
            "audio": false
        },
        {
            "filename": "/resources/shaders/gold_seal.fs",
            "crunched": 0,
            "start": 73907748,
            "end": 73908604,
            "audio": false
        },
        {
            "filename": "/resources/shaders/holo.fs",
            "crunched": 0,
            "start": 73908604,
            "end": 73914536,
            "audio": false
        },
        {
            "filename": "/resources/shaders/hologram.fs",
            "crunched": 0,
            "start": 73914536,
            "end": 73920246,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative_shine.fs",
            "crunched": 0,
            "start": 73920246,
            "end": 73925135,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative.fs",
            "crunched": 0,
            "start": 73925135,
            "end": 73929973,
            "audio": false
        },
        {
            "filename": "/resources/shaders/played.fs",
            "crunched": 0,
            "start": 73929973,
            "end": 73934710,
            "audio": false
        },
        {
            "filename": "/resources/shaders/polychrome.fs",
            "crunched": 0,
            "start": 73934710,
            "end": 73940463,
            "audio": false
        },
        {
            "filename": "/resources/shaders/skew.fs",
            "crunched": 0,
            "start": 73940463,
            "end": 73941161,
            "audio": false
        },
        {
            "filename": "/resources/shaders/splash.fs",
            "crunched": 0,
            "start": 73941161,
            "end": 73943789,
            "audio": false
        },
        {
            "filename": "/resources/shaders/vortex.fs",
            "crunched": 0,
            "start": 73943789,
            "end": 73944624,
            "audio": false
        },
        {
            "filename": "/resources/shaders/voucher.fs",
            "crunched": 0,
            "start": 73944624,
            "end": 73949432,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire1.ogg",
            "crunched": 0,
            "start": 73949432,
            "end": 74427763,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire2.ogg",
            "crunched": 0,
            "start": 74427763,
            "end": 74936260,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire3.ogg",
            "crunched": 0,
            "start": 74936260,
            "end": 75439817,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientOrgan1.ogg",
            "crunched": 0,
            "start": 75439817,
            "end": 75820770,
            "audio": false
        },
        {
            "filename": "/resources/sounds/button.ogg",
            "crunched": 0,
            "start": 75820770,
            "end": 75828903,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cancel.ogg",
            "crunched": 0,
            "start": 75828903,
            "end": 75838983,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card1.ogg",
            "crunched": 0,
            "start": 75838983,
            "end": 75852921,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card3.ogg",
            "crunched": 0,
            "start": 75852921,
            "end": 75864793,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardFan2.ogg",
            "crunched": 0,
            "start": 75864793,
            "end": 75881262,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide1.ogg",
            "crunched": 0,
            "start": 75881262,
            "end": 75892190,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide2.ogg",
            "crunched": 0,
            "start": 75892190,
            "end": 75902073,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips1.ogg",
            "crunched": 0,
            "start": 75902073,
            "end": 75911057,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips2.ogg",
            "crunched": 0,
            "start": 75911057,
            "end": 75923174,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin1.ogg",
            "crunched": 0,
            "start": 75923174,
            "end": 75934483,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin2.ogg",
            "crunched": 0,
            "start": 75934483,
            "end": 75944209,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin3.ogg",
            "crunched": 0,
            "start": 75944209,
            "end": 75955872,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin4.ogg",
            "crunched": 0,
            "start": 75955872,
            "end": 75966397,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin5.ogg",
            "crunched": 0,
            "start": 75966397,
            "end": 75979499,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin6.ogg",
            "crunched": 0,
            "start": 75979499,
            "end": 75997550,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin7.ogg",
            "crunched": 0,
            "start": 75997550,
            "end": 76008865,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple1.ogg",
            "crunched": 0,
            "start": 76008865,
            "end": 76023049,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple2.ogg",
            "crunched": 0,
            "start": 76023049,
            "end": 76037385,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple3.ogg",
            "crunched": 0,
            "start": 76037385,
            "end": 76050669,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple4.ogg",
            "crunched": 0,
            "start": 76050669,
            "end": 76063801,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple5.ogg",
            "crunched": 0,
            "start": 76063801,
            "end": 76077607,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong1.ogg",
            "crunched": 0,
            "start": 76077607,
            "end": 76128745,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong2.ogg",
            "crunched": 0,
            "start": 76128745,
            "end": 76183487,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_buildup1.ogg",
            "crunched": 0,
            "start": 76183487,
            "end": 76215338,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_release1.ogg",
            "crunched": 0,
            "start": 76215338,
            "end": 76247336,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion1.ogg",
            "crunched": 0,
            "start": 76247336,
            "end": 76295762,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil1.ogg",
            "crunched": 0,
            "start": 76295762,
            "end": 76304528,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil2.ogg",
            "crunched": 0,
            "start": 76304528,
            "end": 76314070,
            "audio": false
        },
        {
            "filename": "/resources/sounds/generic1.ogg",
            "crunched": 0,
            "start": 76314070,
            "end": 76321205,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass1.ogg",
            "crunched": 0,
            "start": 76321205,
            "end": 76338159,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass2.ogg",
            "crunched": 0,
            "start": 76338159,
            "end": 76354956,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass3.ogg",
            "crunched": 0,
            "start": 76354956,
            "end": 76371528,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass4.ogg",
            "crunched": 0,
            "start": 76371528,
            "end": 76389032,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass5.ogg",
            "crunched": 0,
            "start": 76389032,
            "end": 76406167,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass6.ogg",
            "crunched": 0,
            "start": 76406167,
            "end": 76424212,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gold_seal.ogg",
            "crunched": 0,
            "start": 76424212,
            "end": 76437496,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gong.ogg",
            "crunched": 0,
            "start": 76437496,
            "end": 76455641,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight1.ogg",
            "crunched": 0,
            "start": 76455641,
            "end": 76462828,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight2.ogg",
            "crunched": 0,
            "start": 76462828,
            "end": 76476212,
            "audio": false
        },
        {
            "filename": "/resources/sounds/holo1.ogg",
            "crunched": 0,
            "start": 76476212,
            "end": 76488767,
            "audio": false
        },
        {
            "filename": "/resources/sounds/introPad1.ogg",
            "crunched": 0,
            "start": 76488767,
            "end": 76822785,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple.ogg",
            "crunched": 0,
            "start": 76822785,
            "end": 76908914,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple2.ogg",
            "crunched": 0,
            "start": 76908914,
            "end": 76944244,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple3.ogg",
            "crunched": 0,
            "start": 76944244,
            "end": 76968674,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit1.ogg",
            "crunched": 0,
            "start": 76968674,
            "end": 76980756,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit2.ogg",
            "crunched": 0,
            "start": 76980756,
            "end": 76995708,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music1.ogg",
            "crunched": 0,
            "start": 76995708,
            "end": 79934450,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music2.ogg",
            "crunched": 0,
            "start": 79934450,
            "end": 82549719,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music3.ogg",
            "crunched": 0,
            "start": 82549719,
            "end": 85060777,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music4.ogg",
            "crunched": 0,
            "start": 85060777,
            "end": 87869174,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music5.ogg",
            "crunched": 0,
            "start": 87869174,
            "end": 90715002,
            "audio": false
        },
        {
            "filename": "/resources/sounds/negative.ogg",
            "crunched": 0,
            "start": 90715002,
            "end": 90728200,
            "audio": false
        },
        {
            "filename": "/resources/sounds/other1.ogg",
            "crunched": 0,
            "start": 90728200,
            "end": 90740348,
            "audio": false
        },
        {
            "filename": "/resources/sounds/paper1.ogg",
            "crunched": 0,
            "start": 90740348,
            "end": 90745620,
            "audio": false
        },
        {
            "filename": "/resources/sounds/polychrome1.ogg",
            "crunched": 0,
            "start": 90745620,
            "end": 90775641,
            "audio": false
        },
        {
            "filename": "/resources/sounds/slice1.ogg",
            "crunched": 0,
            "start": 90775641,
            "end": 90784138,
            "audio": false
        },
        {
            "filename": "/resources/sounds/splash_buildup.ogg",
            "crunched": 0,
            "start": 90784138,
            "end": 91123697,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot1.ogg",
            "crunched": 0,
            "start": 91123697,
            "end": 91132818,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot2.ogg",
            "crunched": 0,
            "start": 91132818,
            "end": 91143640,
            "audio": false
        },
        {
            "filename": "/resources/sounds/timpani.ogg",
            "crunched": 0,
            "start": 91143640,
            "end": 91157831,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice1.ogg",
            "crunched": 0,
            "start": 91157831,
            "end": 91164915,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice10.ogg",
            "crunched": 0,
            "start": 91164915,
            "end": 91172006,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice11.ogg",
            "crunched": 0,
            "start": 91172006,
            "end": 91178995,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice2.ogg",
            "crunched": 0,
            "start": 91178995,
            "end": 91186015,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice3.ogg",
            "crunched": 0,
            "start": 91186015,
            "end": 91193114,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice4.ogg",
            "crunched": 0,
            "start": 91193114,
            "end": 91200477,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice5.ogg",
            "crunched": 0,
            "start": 91200477,
            "end": 91207672,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice6.ogg",
            "crunched": 0,
            "start": 91207672,
            "end": 91214791,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice7.ogg",
            "crunched": 0,
            "start": 91214791,
            "end": 91221852,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice8.ogg",
            "crunched": 0,
            "start": 91221852,
            "end": 91229016,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice9.ogg",
            "crunched": 0,
            "start": 91229016,
            "end": 91236182,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh_long.ogg",
            "crunched": 0,
            "start": 91236182,
            "end": 91350363,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh.ogg",
            "crunched": 0,
            "start": 91350363,
            "end": 91360275,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh1.ogg",
            "crunched": 0,
            "start": 91360275,
            "end": 91373177,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh2.ogg",
            "crunched": 0,
            "start": 91373177,
            "end": 91386025,
            "audio": false
        },
        {
            "filename": "/resources/sounds/win.ogg",
            "crunched": 0,
            "start": 91386025,
            "end": 91422591,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 91422591,
            "end": 91484728,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck.png",
            "crunched": 0,
            "start": 91484728,
            "end": 91531606,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro_alt.png",
            "crunched": 0,
            "start": 91531606,
            "end": 91552432,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro.png",
            "crunched": 0,
            "start": 91552432,
            "end": 91579309,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/BlindChips.png",
            "crunched": 0,
            "start": 91579309,
            "end": 91663121,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/boosters.png",
            "crunched": 0,
            "start": 91663121,
            "end": 91833739,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/chips.png",
            "crunched": 0,
            "start": 91833739,
            "end": 91841994,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 91841994,
            "end": 91850373,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 91850373,
            "end": 91858688,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 91858688,
            "end": 91863720,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 91863720,
            "end": 91871024,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 91871024,
            "end": 91882176,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 91882176,
            "end": 91894896,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 91894896,
            "end": 91904699,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 91904699,
            "end": 91914378,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 91914378,
            "end": 91920861,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 91920861,
            "end": 91929123,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 91929123,
            "end": 91937290,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 91937290,
            "end": 91946291,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 91946291,
            "end": 91953555,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 91953555,
            "end": 91960877,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 91960877,
            "end": 91968591,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 91968591,
            "end": 91977432,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 91977432,
            "end": 91986119,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 91986119,
            "end": 91995208,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 91995208,
            "end": 92003006,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 92003006,
            "end": 92010737,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 92010737,
            "end": 92018171,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 92018171,
            "end": 92024133,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 92024133,
            "end": 92028866,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 92028866,
            "end": 92034065,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 92034065,
            "end": 92043310,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 92043310,
            "end": 92052868,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 92052868,
            "end": 92060538,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 92060538,
            "end": 92068035,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 92068035,
            "end": 92079743,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 92079743,
            "end": 92092544,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 92092544,
            "end": 92104428,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 92104428,
            "end": 92116069,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 92116069,
            "end": 92124507,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 92124507,
            "end": 92132932,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 92132932,
            "end": 92142093,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 92142093,
            "end": 92152192,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 92152192,
            "end": 92160070,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 92160070,
            "end": 92168652,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 92168652,
            "end": 92176089,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 92176089,
            "end": 92183561,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 92183561,
            "end": 92191128,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 92191128,
            "end": 92198475,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 92198475,
            "end": 92203467,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 92203467,
            "end": 92211273,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 92211273,
            "end": 92217903,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 92217903,
            "end": 92225332,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 92225332,
            "end": 92237478,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 92237478,
            "end": 92248098,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Enhancers.png",
            "crunched": 0,
            "start": 92248098,
            "end": 92324050,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/gamepad_ui.png",
            "crunched": 0,
            "start": 92324050,
            "end": 92343977,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/icons.png",
            "crunched": 0,
            "start": 92343977,
            "end": 92352533,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Jokers.png",
            "crunched": 0,
            "start": 92352533,
            "end": 92857220,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/localthunk-logo.png",
            "crunched": 0,
            "start": 92857220,
            "end": 92866847,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/playstack-logo.png",
            "crunched": 0,
            "start": 92866847,
            "end": 92939573,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 92939573,
            "end": 92950371,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/stickers.png",
            "crunched": 0,
            "start": 92950371,
            "end": 92954755,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/tags.png",
            "crunched": 0,
            "start": 92954755,
            "end": 92962090,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Tarots.png",
            "crunched": 0,
            "start": 92962090,
            "end": 93058421,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 93058421,
            "end": 93059873,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets.png",
            "crunched": 0,
            "start": 93059873,
            "end": 93061341,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Vouchers.png",
            "crunched": 0,
            "start": 93061341,
            "end": 93132050,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 93132050,
            "end": 93212620,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck.png",
            "crunched": 0,
            "start": 93212620,
            "end": 93277018,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro_alt.png",
            "crunched": 0,
            "start": 93277018,
            "end": 93304086,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro.png",
            "crunched": 0,
            "start": 93304086,
            "end": 93339420,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/BlindChips.png",
            "crunched": 0,
            "start": 93339420,
            "end": 93473926,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/boosters.png",
            "crunched": 0,
            "start": 93473926,
            "end": 93685589,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/chips.png",
            "crunched": 0,
            "start": 93685589,
            "end": 93695471,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 93695471,
            "end": 93705376,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 93705376,
            "end": 93715244,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 93715244,
            "end": 93723218,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 93723218,
            "end": 93733513,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 93733513,
            "end": 93746911,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 93746911,
            "end": 93761641,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 93761641,
            "end": 93773361,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 93773361,
            "end": 93785093,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 93785093,
            "end": 93795586,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 93795586,
            "end": 93805352,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 93805352,
            "end": 93815203,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 93815203,
            "end": 93825943,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 93825943,
            "end": 93837435,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 93837435,
            "end": 93849001,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 93849001,
            "end": 93859507,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 93859507,
            "end": 93870076,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 93870076,
            "end": 93880254,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 93880254,
            "end": 93890998,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 93890998,
            "end": 93900622,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 93900622,
            "end": 93910207,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 93910207,
            "end": 93919773,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 93919773,
            "end": 93927190,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 93927190,
            "end": 93933031,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 93933031,
            "end": 93939429,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 93939429,
            "end": 93950351,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 93950351,
            "end": 93961632,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 93961632,
            "end": 93970719,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 93970719,
            "end": 93979754,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 93979754,
            "end": 93993568,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 93993568,
            "end": 94008626,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 94008626,
            "end": 94022350,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 94022350,
            "end": 94035739,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 94035739,
            "end": 94045781,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 94045781,
            "end": 94055779,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 94055779,
            "end": 94066838,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 94066838,
            "end": 94078992,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 94078992,
            "end": 94090605,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 94090605,
            "end": 94103202,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 94103202,
            "end": 94113926,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 94113926,
            "end": 94124649,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 94124649,
            "end": 94135876,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 94135876,
            "end": 94146802,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 94146802,
            "end": 94154221,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 94154221,
            "end": 94163487,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 94163487,
            "end": 94174770,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 94174770,
            "end": 94187532,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 94187532,
            "end": 94201761,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 94201761,
            "end": 94214653,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Enhancers.png",
            "crunched": 0,
            "start": 94214653,
            "end": 94308538,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/gamepad_ui.png",
            "crunched": 0,
            "start": 94308538,
            "end": 94333403,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/icons.png",
            "crunched": 0,
            "start": 94333403,
            "end": 94344973,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Jokers.png",
            "crunched": 0,
            "start": 94344973,
            "end": 94957497,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/localthunk-logo.png",
            "crunched": 0,
            "start": 94957497,
            "end": 94978060,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/playstack-logo.png",
            "crunched": 0,
            "start": 94978060,
            "end": 95085448,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 95085448,
            "end": 95101103,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/stickers.png",
            "crunched": 0,
            "start": 95101103,
            "end": 95107841,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/tags.png",
            "crunched": 0,
            "start": 95107841,
            "end": 95118692,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Tarots.png",
            "crunched": 0,
            "start": 95118692,
            "end": 95238354,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 95238354,
            "end": 95240108,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets.png",
            "crunched": 0,
            "start": 95240108,
            "end": 95241865,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Vouchers.png",
            "crunched": 0,
            "start": 95241865,
            "end": 95326466,
            "audio": false
        },
        {
            "filename": "/SMODS/_/src/game_object.lua",
            "crunched": 0,
            "start": 95326466,
            "end": 95498576,
            "audio": false
        },
        {
            "filename": "/SMODS/_/src/overrides.lua",
            "crunched": 0,
            "start": 95498576,
            "end": 95611583,
            "audio": false
        },
        {
            "filename": "/SMODS/_/src/utils.lua",
            "crunched": 0,
            "start": 95611583,
            "end": 95783558,
            "audio": false
        },
        {
            "filename": "/SMODS/nativefs.lua",
            "crunched": 0,
            "start": 95783558,
            "end": 95785712,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/loader.lua",
            "crunched": 0,
            "start": 95785712,
            "end": 95825320,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/logging.lua",
            "crunched": 0,
            "start": 95825320,
            "end": 95825966,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 95825966,
            "end": 95831892,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 95831892,
            "end": 95835190,
            "audio": false
        },
        {
            "filename": "/SMODS/release.lua",
            "crunched": 0,
            "start": 95835190,
            "end": 95835227,
            "audio": false
        },
        {
            "filename": "/SMODS/version.lua",
            "crunched": 0,
            "start": 95835227,
            "end": 95835264,
            "audio": false
        },
        {
            "filename": "/SMODS/web_bootstrap.lua",
            "crunched": 0,
            "start": 95835264,
            "end": 95842805,
            "audio": false
        },
        {
            "filename": "/SMODS/web_threads.lua",
            "crunched": 0,
            "start": 95842805,
            "end": 95848912,
            "audio": false
        },
        {
            "filename": "/tag.lua",
            "crunched": 0,
            "start": 95848912,
            "end": 95875315,
            "audio": false
        },
        {
            "filename": "/version.jkr",
            "crunched": 0,
            "start": 95875315,
            "end": 95875349,
            "audio": false
        }
    ]
});
})();
