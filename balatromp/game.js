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
    var TOTAL_CHUNKS = 8; // game.data.000 through game.data.007
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
    "package_uuid": "83962291-3af7-4a06-8231-0d135e004e77",
    "remote_package_size": 139608945,
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
            "end": 4880171,
            "audio": false
        },
        {
            "filename": "/lovely.lua",
            "crunched": 0,
            "start": 4880171,
            "end": 4911944,
            "audio": false
        },
        {
            "filename": "/main.lua",
            "crunched": 0,
            "start": 4911944,
            "end": 4912017,
            "audio": false
        },
        {
            "filename": "/manifest.json",
            "crunched": 0,
            "start": 4912017,
            "end": 4990391,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/1x/icon.png",
            "crunched": 0,
            "start": 4990391,
            "end": 4991237,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/2x/icon.png",
            "crunched": 0,
            "start": 4991237,
            "end": 4992270,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/e.ogg",
            "crunched": 0,
            "start": 4992270,
            "end": 5090224,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/ee.ogg",
            "crunched": 0,
            "start": 5090224,
            "end": 5236620,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/blindsize/eee.ogg",
            "crunched": 0,
            "start": 5236620,
            "end": 5431470,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/e.ogg",
            "crunched": 0,
            "start": 5431470,
            "end": 5473219,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/ee.ogg",
            "crunched": 0,
            "start": 5473219,
            "end": 5559520,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/eee.ogg",
            "crunched": 0,
            "start": 5559520,
            "end": 5726391,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/chips/x.ogg",
            "crunched": 0,
            "start": 5726391,
            "end": 5751419,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/e.ogg",
            "crunched": 0,
            "start": 5751419,
            "end": 5794827,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/ee.ogg",
            "crunched": 0,
            "start": 5794827,
            "end": 5838345,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/assets/sounds/mult/eee.ogg",
            "crunched": 0,
            "start": 5838345,
            "end": 5904566,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/constants.lua",
            "crunched": 0,
            "start": 5904566,
            "end": 5905389,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations.lua",
            "crunched": 0,
            "start": 5905389,
            "end": 5905544,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/arraynotation.lua",
            "crunched": 0,
            "start": 5905544,
            "end": 5906824,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/Balatro.lua",
            "crunched": 0,
            "start": 5906824,
            "end": 5910085,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/notations/notation.lua",
            "crunched": 0,
            "start": 5910085,
            "end": 5911154,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/big-num/omeganum.lua",
            "crunched": 0,
            "start": 5911154,
            "end": 5951565,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/icon.png",
            "crunched": 0,
            "start": 5951565,
            "end": 5953909,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/LICENSE",
            "crunched": 0,
            "start": 5953909,
            "end": 5989058,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely.toml",
            "crunched": 0,
            "start": 5989058,
            "end": 5991234,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/anims.toml",
            "crunched": 0,
            "start": 5991234,
            "end": 5992864,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/card.toml",
            "crunched": 0,
            "start": 5992864,
            "end": 5993932,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/fixes.toml",
            "crunched": 0,
            "start": 5993932,
            "end": 6001914,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/gradients.toml",
            "crunched": 0,
            "start": 6001914,
            "end": 6002282,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/noanims.toml",
            "crunched": 0,
            "start": 6002282,
            "end": 6006014,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/numfmt.toml",
            "crunched": 0,
            "start": 6006014,
            "end": 6008803,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/save.toml",
            "crunched": 0,
            "start": 6008803,
            "end": 6011344,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/scoring.toml",
            "crunched": 0,
            "start": 6011344,
            "end": 6015029,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/talisman-detection-after.toml",
            "crunched": 0,
            "start": 6015029,
            "end": 6015901,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/talisman-detection.toml",
            "crunched": 0,
            "start": 6015901,
            "end": 6016181,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/typefix.toml",
            "crunched": 0,
            "start": 6016181,
            "end": 6018522,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/valid.toml",
            "crunched": 0,
            "start": 6018522,
            "end": 6018717,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/lovely/valid.txt",
            "crunched": 0,
            "start": 6018717,
            "end": 6018743,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/manifest.json",
            "crunched": 0,
            "start": 6018743,
            "end": 6018999,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/README.md",
            "crunched": 0,
            "start": 6018999,
            "end": 6020878,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/smods.json",
            "crunched": 0,
            "start": 6020878,
            "end": 6021335,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/smods.lua",
            "crunched": 0,
            "start": 6021335,
            "end": 6025069,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman.lua",
            "crunched": 0,
            "start": 6025069,
            "end": 6026009,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf.lua",
            "crunched": 0,
            "start": 6026009,
            "end": 6032851,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/globals.lua",
            "crunched": 0,
            "start": 6032851,
            "end": 6033517,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/math.lua",
            "crunched": 0,
            "start": 6033517,
            "end": 6035305,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/break_inf/sanitizer.lua",
            "crunched": 0,
            "start": 6035305,
            "end": 6037620,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/configinit.lua",
            "crunched": 0,
            "start": 6037620,
            "end": 6040393,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/configtab.lua",
            "crunched": 0,
            "start": 6040393,
            "end": 6048765,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/coroutine.lua",
            "crunched": 0,
            "start": 6048765,
            "end": 6056198,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/debug.lua",
            "crunched": 0,
            "start": 6056198,
            "end": 6056750,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/effects.lua",
            "crunched": 0,
            "start": 6056750,
            "end": 6066768,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/globals.lua",
            "crunched": 0,
            "start": 6066768,
            "end": 6068296,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/gradients.lua",
            "crunched": 0,
            "start": 6068296,
            "end": 6070674,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization.lua",
            "crunched": 0,
            "start": 6070674,
            "end": 6071507,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/en-us.lua",
            "crunched": 0,
            "start": 6071507,
            "end": 6074040,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/vi.lua",
            "crunched": 0,
            "start": 6074040,
            "end": 6076900,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/localization/zh_CN.lua",
            "crunched": 0,
            "start": 6076900,
            "end": 6079503,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/noanims.lua",
            "crunched": 0,
            "start": 6079503,
            "end": 6083260,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/sanitizer.lua",
            "crunched": 0,
            "start": 6083260,
            "end": 6085436,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/gradients.lua",
            "crunched": 0,
            "start": 6085436,
            "end": 6086001,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/ind_effect.lua",
            "crunched": 0,
            "start": 6086001,
            "end": 6088151,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/scoring_calc.lua",
            "crunched": 0,
            "start": 6088151,
            "end": 6089775,
            "audio": false
        },
        {
            "filename": "/Mods/Amulet/talisman/smods/test.lua",
            "crunched": 0,
            "start": 6089775,
            "end": 6091015,
            "audio": false
        },
        {
            "filename": "/Mods/config/Multiplayer.jkr",
            "crunched": 0,
            "start": 6091015,
            "end": 6091430,
            "audio": false
        },
        {
            "filename": "/Mods/config/Steamodded.jkr",
            "crunched": 0,
            "start": 6091430,
            "end": 6091615,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/.gitattributes",
            "crunched": 0,
            "start": 6091615,
            "end": 6091681,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/.gitignore",
            "crunched": 0,
            "start": 6091681,
            "end": 6091804,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasdeck.png",
            "crunched": 0,
            "start": 6091804,
            "end": 6283455,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlaseditiondeck.png",
            "crunched": 0,
            "start": 6283455,
            "end": 6339440,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasepic.png",
            "crunched": 0,
            "start": 6339440,
            "end": 6453177,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasexotic.png",
            "crunched": 0,
            "start": 6453177,
            "end": 6645822,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasnotjokers.png",
            "crunched": 0,
            "start": 6645822,
            "end": 6821338,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasone.png",
            "crunched": 0,
            "start": 6821338,
            "end": 6953925,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasSleeves.png",
            "crunched": 0,
            "start": 6953925,
            "end": 6992016,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasspooky.png",
            "crunched": 0,
            "start": 6992016,
            "end": 7063640,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasthree.png",
            "crunched": 0,
            "start": 7063640,
            "end": 7303152,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlastwo.png",
            "crunched": 0,
            "start": 7303152,
            "end": 7451675,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/atlasvoucher.png",
            "crunched": 0,
            "start": 7451675,
            "end": 7580602,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/b_cry_glowing.png",
            "crunched": 0,
            "start": 7580602,
            "end": 7623645,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_cry_two.png",
            "crunched": 0,
            "start": 7623645,
            "end": 7630905,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_cry.png",
            "crunched": 0,
            "start": 7630905,
            "end": 7660549,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/bl_nostalgia.png",
            "crunched": 0,
            "start": 7660549,
            "end": 7687660,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_achievements.png",
            "crunched": 0,
            "start": 7687660,
            "end": 7694602,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_gameset.png",
            "crunched": 0,
            "start": 7694602,
            "end": 7696347,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_icon.png",
            "crunched": 0,
            "start": 7696347,
            "end": 7696923,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/cry_misc.png",
            "crunched": 0,
            "start": 7696923,
            "end": 7723207,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/goofy.png",
            "crunched": 0,
            "start": 7723207,
            "end": 7728641,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/hands.png",
            "crunched": 0,
            "start": 7728641,
            "end": 7729053,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/intercept_sprite.aseprite",
            "crunched": 0,
            "start": 7729053,
            "end": 7732300,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/j_cry_jimball.png",
            "crunched": 0,
            "start": 7732300,
            "end": 7778948,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/jolly.png",
            "crunched": 0,
            "start": 7778948,
            "end": 8192842,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/old.png",
            "crunched": 0,
            "start": 8192842,
            "end": 8258624,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/pack_cry.png",
            "crunched": 0,
            "start": 8258624,
            "end": 8293974,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/placeholders.png",
            "crunched": 0,
            "start": 8293974,
            "end": 8307707,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/resize.py",
            "crunched": 0,
            "start": 8307707,
            "end": 8308526,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/shinyc.png",
            "crunched": 0,
            "start": 8308526,
            "end": 8319360,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/shinyv.png",
            "crunched": 0,
            "start": 8319360,
            "end": 8328051,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/sleeve_cry_glowing.png",
            "crunched": 0,
            "start": 8328051,
            "end": 8356592,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/stake_cry.png",
            "crunched": 0,
            "start": 8356592,
            "end": 8372679,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/sticker_cry.png",
            "crunched": 0,
            "start": 8372679,
            "end": 8377334,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/1x/tag_cry.png",
            "crunched": 0,
            "start": 8377334,
            "end": 8392612,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasdeck.png",
            "crunched": 0,
            "start": 8392612,
            "end": 8711349,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlaseditiondeck.png",
            "crunched": 0,
            "start": 8711349,
            "end": 8792610,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasepic.png",
            "crunched": 0,
            "start": 8792610,
            "end": 8935612,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasexotic.png",
            "crunched": 0,
            "start": 8935612,
            "end": 9172949,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasnotjokers.png",
            "crunched": 0,
            "start": 9172949,
            "end": 9393965,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasone.png",
            "crunched": 0,
            "start": 9393965,
            "end": 9556023,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasSleeves.png",
            "crunched": 0,
            "start": 9556023,
            "end": 9616591,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasspooky.png",
            "crunched": 0,
            "start": 9616591,
            "end": 9703269,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasthree.png",
            "crunched": 0,
            "start": 9703269,
            "end": 9994959,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlastwo.png",
            "crunched": 0,
            "start": 9994959,
            "end": 10180931,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/atlasvoucher.png",
            "crunched": 0,
            "start": 10180931,
            "end": 10398443,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/b_cry_glowing.png",
            "crunched": 0,
            "start": 10398443,
            "end": 10445502,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_cry_two.png",
            "crunched": 0,
            "start": 10445502,
            "end": 10457810,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_cry.png",
            "crunched": 0,
            "start": 10457810,
            "end": 10530039,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/bl_nostalgia.png",
            "crunched": 0,
            "start": 10530039,
            "end": 10596530,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_achievements.png",
            "crunched": 0,
            "start": 10596530,
            "end": 10611482,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_gameset.png",
            "crunched": 0,
            "start": 10611482,
            "end": 10613700,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_icon.png",
            "crunched": 0,
            "start": 10613700,
            "end": 10614403,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/cry_misc.png",
            "crunched": 0,
            "start": 10614403,
            "end": 10662632,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/goofy.png",
            "crunched": 0,
            "start": 10662632,
            "end": 10688741,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/hands.png",
            "crunched": 0,
            "start": 10688741,
            "end": 10689196,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/intercept_sprite.aseprite",
            "crunched": 0,
            "start": 10689196,
            "end": 10693745,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/j_cry_jimball.png",
            "crunched": 0,
            "start": 10693745,
            "end": 10753322,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/jolly.png",
            "crunched": 0,
            "start": 10753322,
            "end": 11513255,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/old.png",
            "crunched": 0,
            "start": 11513255,
            "end": 11639203,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/pack_cry.png",
            "crunched": 0,
            "start": 11639203,
            "end": 11685769,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/placeholders.png",
            "crunched": 0,
            "start": 11685769,
            "end": 11702613,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/resize.py",
            "crunched": 0,
            "start": 11702613,
            "end": 11703446,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/shinyc.png",
            "crunched": 0,
            "start": 11703446,
            "end": 11719511,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/shinyv.png",
            "crunched": 0,
            "start": 11719511,
            "end": 11734577,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/sleeve_cry_glowing.png",
            "crunched": 0,
            "start": 11734577,
            "end": 11774481,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/stake_cry.png",
            "crunched": 0,
            "start": 11774481,
            "end": 11795169,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/sticker_cry.png",
            "crunched": 0,
            "start": 11795169,
            "end": 11802759,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/2x/tag_cry.png",
            "crunched": 0,
            "start": 11802759,
            "end": 11826809,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/astral.fs",
            "crunched": 0,
            "start": 11826809,
            "end": 11836179,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/blur.fs",
            "crunched": 0,
            "start": 11836179,
            "end": 11842864,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glass.fs",
            "crunched": 0,
            "start": 11842864,
            "end": 11847373,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glitched_b.fs",
            "crunched": 0,
            "start": 11847373,
            "end": 11856515,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/glitched.fs",
            "crunched": 0,
            "start": 11856515,
            "end": 11861919,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/gold.fs",
            "crunched": 0,
            "start": 11861919,
            "end": 11866561,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/m.fs",
            "crunched": 0,
            "start": 11866561,
            "end": 11871675,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/mosaic.fs",
            "crunched": 0,
            "start": 11871675,
            "end": 11877405,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/noisy.fs",
            "crunched": 0,
            "start": 11877405,
            "end": 11881340,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/oversat.fs",
            "crunched": 0,
            "start": 11881340,
            "end": 11888795,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/shaders/ultrafoil.fs",
            "crunched": 0,
            "start": 11888795,
            "end": 11895451,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/demitrigger.ogg",
            "crunched": 0,
            "start": 11895451,
            "end": 11944327,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_blur.ogg",
            "crunched": 0,
            "start": 11944327,
            "end": 11950832,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_double_sided.ogg",
            "crunched": 0,
            "start": 11950832,
            "end": 12082237,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_fragile.ogg",
            "crunched": 0,
            "start": 12082237,
            "end": 12108310,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_glitched.ogg",
            "crunched": 0,
            "start": 12108310,
            "end": 12126764,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_golden.ogg",
            "crunched": 0,
            "start": 12126764,
            "end": 12208407,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_jolly.ogg",
            "crunched": 0,
            "start": 12208407,
            "end": 12236598,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_mosaic.ogg",
            "crunched": 0,
            "start": 12236598,
            "end": 12298686,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_noisy.ogg",
            "crunched": 0,
            "start": 12298686,
            "end": 12370581,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/e_oversaturated.ogg",
            "crunched": 0,
            "start": 12370581,
            "end": 12450682,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/forcetrigger.ogg",
            "crunched": 0,
            "start": 12450682,
            "end": 12488127,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow1.ogg",
            "crunched": 0,
            "start": 12488127,
            "end": 12508769,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow2.ogg",
            "crunched": 0,
            "start": 12508769,
            "end": 12528981,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow3.ogg",
            "crunched": 0,
            "start": 12528981,
            "end": 12549976,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/meow4.ogg",
            "crunched": 0,
            "start": 12549976,
            "end": 12569947,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_big.ogg",
            "crunched": 0,
            "start": 12569947,
            "end": 14934197,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_code.ogg",
            "crunched": 0,
            "start": 14934197,
            "end": 17384396,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_exotic.ogg",
            "crunched": 0,
            "start": 17384396,
            "end": 19569646,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_jimball.ogg",
            "crunched": 0,
            "start": 19569646,
            "end": 20762777,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_madness.ogg",
            "crunched": 0,
            "start": 20762777,
            "end": 22847176,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_mainline.ogg",
            "crunched": 0,
            "start": 22847176,
            "end": 24984615,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/music_modest.ogg",
            "crunched": 0,
            "start": 24984615,
            "end": 27084085,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/speed.py",
            "crunched": 0,
            "start": 27084085,
            "end": 27084792,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/studiofromhelsinki.ogg",
            "crunched": 0,
            "start": 27084792,
            "end": 27111887,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/assets/sounds/whapoosh.ogg",
            "crunched": 0,
            "start": 27111887,
            "end": 27141461,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/config.lua",
            "crunched": 0,
            "start": 27141461,
            "end": 27142129,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/Cryptid.json",
            "crunched": 0,
            "start": 27142129,
            "end": 27142656,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/Cryptid.lua",
            "crunched": 0,
            "start": 27142656,
            "end": 27159321,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/achievement.lua",
            "crunched": 0,
            "start": 27159321,
            "end": 27171956,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/blind.lua",
            "crunched": 0,
            "start": 27171956,
            "end": 27215217,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/challenge.lua",
            "crunched": 0,
            "start": 27215217,
            "end": 27226348,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/code.lua",
            "crunched": 0,
            "start": 27226348,
            "end": 27383582,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/deck.lua",
            "crunched": 0,
            "start": 27383582,
            "end": 27415411,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/enhanced.lua",
            "crunched": 0,
            "start": 27415411,
            "end": 27430786,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/epic.lua",
            "crunched": 0,
            "start": 27430786,
            "end": 27497415,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/exotic.lua",
            "crunched": 0,
            "start": 27497415,
            "end": 27542112,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/joker_display.lua",
            "crunched": 0,
            "start": 27542112,
            "end": 27603715,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/m.lua",
            "crunched": 0,
            "start": 27603715,
            "end": 27652990,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/misc_joker.lua",
            "crunched": 0,
            "start": 27652990,
            "end": 27905442,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/misc.lua",
            "crunched": 0,
            "start": 27905442,
            "end": 27969285,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/planet.lua",
            "crunched": 0,
            "start": 27969285,
            "end": 28019021,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/pointer.lua",
            "crunched": 0,
            "start": 28019021,
            "end": 28073314,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/sleeve.lua",
            "crunched": 0,
            "start": 28073314,
            "end": 28121954,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/spectral.lua",
            "crunched": 0,
            "start": 28121954,
            "end": 28158901,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/spooky.lua",
            "crunched": 0,
            "start": 28158901,
            "end": 28217993,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/stake.lua",
            "crunched": 0,
            "start": 28217993,
            "end": 28232576,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/tag.lua",
            "crunched": 0,
            "start": 28232576,
            "end": 28272296,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/test.lua",
            "crunched": 0,
            "start": 28272296,
            "end": 28278458,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/items/voucher.lua",
            "crunched": 0,
            "start": 28278458,
            "end": 28313957,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/ascended.lua",
            "crunched": 0,
            "start": 28313957,
            "end": 28325224,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/attributes.lua",
            "crunched": 0,
            "start": 28325224,
            "end": 28326019,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/calculate.lua",
            "crunched": 0,
            "start": 28326019,
            "end": 28331563,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/content.lua",
            "crunched": 0,
            "start": 28331563,
            "end": 28350150,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/cross-mod.lua",
            "crunched": 0,
            "start": 28350150,
            "end": 28355693,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/d20.lua",
            "crunched": 0,
            "start": 28355693,
            "end": 28356068,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/event.lua",
            "crunched": 0,
            "start": 28356068,
            "end": 28357216,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/forcetrigger.lua",
            "crunched": 0,
            "start": 28357216,
            "end": 28397164,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/gameset.lua",
            "crunched": 0,
            "start": 28397164,
            "end": 28451549,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/https.lua",
            "crunched": 0,
            "start": 28451549,
            "end": 28452558,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/misc.lua",
            "crunched": 0,
            "start": 28452558,
            "end": 28492653,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/misprintize.lua",
            "crunched": 0,
            "start": 28492653,
            "end": 28510613,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/modifiers.lua",
            "crunched": 0,
            "start": 28510613,
            "end": 28538293,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/notifications.lua",
            "crunched": 0,
            "start": 28538293,
            "end": 28543474,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/overrides.lua",
            "crunched": 0,
            "start": 28543474,
            "end": 28612495,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/pointerlib.lua",
            "crunched": 0,
            "start": 28612495,
            "end": 28617801,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lib/ui.lua",
            "crunched": 0,
            "start": 28617801,
            "end": 28630152,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/LICENSE",
            "crunched": 0,
            "start": 28630152,
            "end": 28665301,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/de.lua",
            "crunched": 0,
            "start": 28665301,
            "end": 28824999,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/en-us.lua",
            "crunched": 0,
            "start": 28824999,
            "end": 28979650,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/es_419.lua",
            "crunched": 0,
            "start": 28979650,
            "end": 29093186,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/es_ES.lua",
            "crunched": 0,
            "start": 29093186,
            "end": 29237388,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/fr.lua",
            "crunched": 0,
            "start": 29237388,
            "end": 29400021,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/id.lua",
            "crunched": 0,
            "start": 29400021,
            "end": 29490768,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ja.lua",
            "crunched": 0,
            "start": 29490768,
            "end": 29663487,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ko.lua",
            "crunched": 0,
            "start": 29663487,
            "end": 29824917,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/nl.lua",
            "crunched": 0,
            "start": 29824917,
            "end": 29914909,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/pl.lua",
            "crunched": 0,
            "start": 29914909,
            "end": 30032163,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/pt_BR.lua",
            "crunched": 0,
            "start": 30032163,
            "end": 30172116,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/ru.lua",
            "crunched": 0,
            "start": 30172116,
            "end": 30345671,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/tools/find_missing_adv.py",
            "crunched": 0,
            "start": 30345671,
            "end": 30347051,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/tools/find_missing.py",
            "crunched": 0,
            "start": 30347051,
            "end": 30347735,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/vi.lua",
            "crunched": 0,
            "start": 30347735,
            "end": 30489305,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/zh_CN.lua",
            "crunched": 0,
            "start": 30489305,
            "end": 30644752,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/localization/zh_TW.lua",
            "crunched": 0,
            "start": 30644752,
            "end": 30735465,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/abstracted.toml",
            "crunched": 0,
            "start": 30735465,
            "end": 30740222,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/achievement.toml",
            "crunched": 0,
            "start": 30740222,
            "end": 30741687,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Ascended.toml",
            "crunched": 0,
            "start": 30741687,
            "end": 30747859,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/blind.toml",
            "crunched": 0,
            "start": 30747859,
            "end": 30755505,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/cat.toml",
            "crunched": 0,
            "start": 30755505,
            "end": 30764457,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/ccd.toml",
            "crunched": 0,
            "start": 30764457,
            "end": 30769679,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/challenges.toml",
            "crunched": 0,
            "start": 30769679,
            "end": 30770451,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/code.toml",
            "crunched": 0,
            "start": 30770451,
            "end": 30791132,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/conveyor.toml",
            "crunched": 0,
            "start": 30791132,
            "end": 30792311,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/equilibrium.toml",
            "crunched": 0,
            "start": 30792311,
            "end": 30793021,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_gameset.toml",
            "crunched": 0,
            "start": 30793021,
            "end": 30800550,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_https.toml",
            "crunched": 0,
            "start": 30800550,
            "end": 30800871,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_misc.toml",
            "crunched": 0,
            "start": 30800871,
            "end": 30808576,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_modifiers.toml",
            "crunched": 0,
            "start": 30808576,
            "end": 30811616,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/lib_ui.toml",
            "crunched": 0,
            "start": 30811616,
            "end": 30816069,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/misc.toml",
            "crunched": 0,
            "start": 30816069,
            "end": 30836063,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/misprint.toml",
            "crunched": 0,
            "start": 30836063,
            "end": 30855051,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/none.toml",
            "crunched": 0,
            "start": 30855051,
            "end": 30865217,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/planet.toml",
            "crunched": 0,
            "start": 30865217,
            "end": 30866433,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Probability.toml",
            "crunched": 0,
            "start": 30866433,
            "end": 30868139,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/seal.toml",
            "crunched": 0,
            "start": 30868139,
            "end": 30868608,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/spooky.toml",
            "crunched": 0,
            "start": 30868608,
            "end": 30870290,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/stake.toml",
            "crunched": 0,
            "start": 30870290,
            "end": 30884522,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/sticker.toml",
            "crunched": 0,
            "start": 30884522,
            "end": 30888882,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/very_fair.toml",
            "crunched": 0,
            "start": 30888882,
            "end": 30891061,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/lovely/Voucher.toml",
            "crunched": 0,
            "start": 30891061,
            "end": 30897766,
            "audio": false
        },
        {
            "filename": "/Mods/Cryptid/README.md",
            "crunched": 0,
            "start": 30897766,
            "end": 30901322,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/blacklist.txt",
            "crunched": 0,
            "start": 30901322,
            "end": 30901331,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/back.lua",
            "crunched": 0,
            "start": 30901331,
            "end": 30916772,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/back.lua.json",
            "crunched": 0,
            "start": 30916772,
            "end": 30922151,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/blind.lua",
            "crunched": 0,
            "start": 30922151,
            "end": 30956467,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/blind.lua.json",
            "crunched": 0,
            "start": 30956467,
            "end": 30975296,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/card_character.lua",
            "crunched": 0,
            "start": 30975296,
            "end": 30982139,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/card_character.lua.json",
            "crunched": 0,
            "start": 30982139,
            "end": 30986387,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/card.lua",
            "crunched": 0,
            "start": 30986387,
            "end": 31297230,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/card.lua.json",
            "crunched": 0,
            "start": 31297230,
            "end": 31431652,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/cardarea.lua",
            "crunched": 0,
            "start": 31431652,
            "end": 31469449,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/cardarea.lua.json",
            "crunched": 0,
            "start": 31469449,
            "end": 31482230,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/animatedsprite.lua",
            "crunched": 0,
            "start": 31482230,
            "end": 31485562,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/animatedsprite.lua.json",
            "crunched": 0,
            "start": 31485562,
            "end": 31486853,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/controller.lua",
            "crunched": 0,
            "start": 31486853,
            "end": 31551744,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/controller.lua.json",
            "crunched": 0,
            "start": 31551744,
            "end": 31555045,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/event.lua",
            "crunched": 0,
            "start": 31555045,
            "end": 31562104,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/event.lua.json",
            "crunched": 0,
            "start": 31562104,
            "end": 31564427,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/moveable.lua",
            "crunched": 0,
            "start": 31564427,
            "end": 31585892,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/moveable.lua.json",
            "crunched": 0,
            "start": 31585892,
            "end": 31587150,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/node.lua",
            "crunched": 0,
            "start": 31587150,
            "end": 31603325,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/node.lua.json",
            "crunched": 0,
            "start": 31603325,
            "end": 31603962,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/save_manager.lua",
            "crunched": 0,
            "start": 31603962,
            "end": 31608567,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/save_manager.lua.json",
            "crunched": 0,
            "start": 31608567,
            "end": 31609503,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/sound_manager.lua",
            "crunched": 0,
            "start": 31609503,
            "end": 31616962,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/sound_manager.lua.json",
            "crunched": 0,
            "start": 31616962,
            "end": 31619633,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/sprite.lua",
            "crunched": 0,
            "start": 31619633,
            "end": 31629227,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/sprite.lua.json",
            "crunched": 0,
            "start": 31629227,
            "end": 31631232,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/string_packer.lua",
            "crunched": 0,
            "start": 31631232,
            "end": 31634318,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/string_packer.lua.json",
            "crunched": 0,
            "start": 31634318,
            "end": 31634930,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/text.lua",
            "crunched": 0,
            "start": 31634930,
            "end": 31657212,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/text.lua.json",
            "crunched": 0,
            "start": 31657212,
            "end": 31667895,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/ui.lua",
            "crunched": 0,
            "start": 31667895,
            "end": 31717974,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/engine/ui.lua.json",
            "crunched": 0,
            "start": 31717974,
            "end": 31726169,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/button_callbacks.lua",
            "crunched": 0,
            "start": 31726169,
            "end": 31851112,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/button_callbacks.lua.json",
            "crunched": 0,
            "start": 31851112,
            "end": 31885350,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/common_events.lua",
            "crunched": 0,
            "start": 31885350,
            "end": 32087453,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/common_events.lua.json",
            "crunched": 0,
            "start": 32087453,
            "end": 32181758,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/misc_functions.lua",
            "crunched": 0,
            "start": 32181758,
            "end": 32264423,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/misc_functions.lua.json",
            "crunched": 0,
            "start": 32264423,
            "end": 32299399,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/state_events.lua",
            "crunched": 0,
            "start": 32299399,
            "end": 32383478,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/state_events.lua.json",
            "crunched": 0,
            "start": 32383478,
            "end": 32440308,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/UI_definitions.lua",
            "crunched": 0,
            "start": 32440308,
            "end": 32819841,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/functions/UI_definitions.lua.json",
            "crunched": 0,
            "start": 32819841,
            "end": 32892049,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/game.lua",
            "crunched": 0,
            "start": 32892049,
            "end": 33147259,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/game.lua.json",
            "crunched": 0,
            "start": 33147259,
            "end": 33191875,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/globals.lua",
            "crunched": 0,
            "start": 33191875,
            "end": 33213838,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/globals.lua.json",
            "crunched": 0,
            "start": 33213838,
            "end": 33215262,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/lovely/SMODS/preflight/core/src/preflight/core.lua",
            "crunched": 0,
            "start": 33215262,
            "end": 33220851,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/lovely/SMODS/preflight/core/src/preflight/core.lua.json",
            "crunched": 0,
            "start": 33220851,
            "end": 33221267,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/main.lua",
            "crunched": 0,
            "start": 33221267,
            "end": 33334139,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/main.lua.json",
            "crunched": 0,
            "start": 33334139,
            "end": 33340322,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/card_draw.lua",
            "crunched": 0,
            "start": 33340322,
            "end": 33368633,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/card_draw.lua.json",
            "crunched": 0,
            "start": 33368633,
            "end": 33370336,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/game_object.lua",
            "crunched": 0,
            "start": 33370336,
            "end": 33542912,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/game_object.lua.json",
            "crunched": 0,
            "start": 33542912,
            "end": 33544595,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/overrides.lua",
            "crunched": 0,
            "start": 33544595,
            "end": 33661920,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/overrides.lua.json",
            "crunched": 0,
            "start": 33661920,
            "end": 33665300,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/ui.lua",
            "crunched": 0,
            "start": 33665300,
            "end": 33797844,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/ui.lua.json",
            "crunched": 0,
            "start": 33797844,
            "end": 33798430,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/utils.lua",
            "crunched": 0,
            "start": 33798430,
            "end": 33971138,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/_/src/utils.lua.json",
            "crunched": 0,
            "start": 33971138,
            "end": 33978207,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/Cryptid/items/code.lua",
            "crunched": 0,
            "start": 33978207,
            "end": 34135487,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/SMODS/Cryptid/items/code.lua.json",
            "crunched": 0,
            "start": 34135487,
            "end": 34135884,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/tag.lua",
            "crunched": 0,
            "start": 34135884,
            "end": 34167235,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/dump/tag.lua.json",
            "crunched": 0,
            "start": 34167235,
            "end": 34173908,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/back.lua",
            "crunched": 0,
            "start": 34173908,
            "end": 34189349,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/back.lua.json",
            "crunched": 0,
            "start": 34189349,
            "end": 34189398,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/blind.lua",
            "crunched": 0,
            "start": 34189398,
            "end": 34223714,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/blind.lua.json",
            "crunched": 0,
            "start": 34223714,
            "end": 34223764,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/card_character.lua",
            "crunched": 0,
            "start": 34223764,
            "end": 34230607,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/card_character.lua.json",
            "crunched": 0,
            "start": 34230607,
            "end": 34230666,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/card.lua",
            "crunched": 0,
            "start": 34230666,
            "end": 34541509,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/card.lua.json",
            "crunched": 0,
            "start": 34541509,
            "end": 34541558,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/cardarea.lua",
            "crunched": 0,
            "start": 34541558,
            "end": 34579355,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/cardarea.lua.json",
            "crunched": 0,
            "start": 34579355,
            "end": 34579408,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/animatedsprite.lua",
            "crunched": 0,
            "start": 34579408,
            "end": 34582740,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/animatedsprite.lua.json",
            "crunched": 0,
            "start": 34582740,
            "end": 34582806,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/controller.lua",
            "crunched": 0,
            "start": 34582806,
            "end": 34647697,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/controller.lua.json",
            "crunched": 0,
            "start": 34647697,
            "end": 34647759,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/event.lua",
            "crunched": 0,
            "start": 34647759,
            "end": 34654818,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/event.lua.json",
            "crunched": 0,
            "start": 34654818,
            "end": 34654875,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/moveable.lua",
            "crunched": 0,
            "start": 34654875,
            "end": 34676340,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/moveable.lua.json",
            "crunched": 0,
            "start": 34676340,
            "end": 34676400,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/node.lua",
            "crunched": 0,
            "start": 34676400,
            "end": 34692575,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/node.lua.json",
            "crunched": 0,
            "start": 34692575,
            "end": 34692631,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/save_manager.lua",
            "crunched": 0,
            "start": 34692631,
            "end": 34697236,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/save_manager.lua.json",
            "crunched": 0,
            "start": 34697236,
            "end": 34697300,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/sound_manager.lua",
            "crunched": 0,
            "start": 34697300,
            "end": 34704759,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/sound_manager.lua.json",
            "crunched": 0,
            "start": 34704759,
            "end": 34704824,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/sprite.lua",
            "crunched": 0,
            "start": 34704824,
            "end": 34714418,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/sprite.lua.json",
            "crunched": 0,
            "start": 34714418,
            "end": 34714476,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/string_packer.lua",
            "crunched": 0,
            "start": 34714476,
            "end": 34717562,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/string_packer.lua.json",
            "crunched": 0,
            "start": 34717562,
            "end": 34717627,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/text.lua",
            "crunched": 0,
            "start": 34717627,
            "end": 34739909,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/text.lua.json",
            "crunched": 0,
            "start": 34739909,
            "end": 34739965,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/ui.lua",
            "crunched": 0,
            "start": 34739965,
            "end": 34790044,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/engine/ui.lua.json",
            "crunched": 0,
            "start": 34790044,
            "end": 34790098,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/button_callbacks.lua",
            "crunched": 0,
            "start": 34790098,
            "end": 34915041,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/button_callbacks.lua.json",
            "crunched": 0,
            "start": 34915041,
            "end": 34915112,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/common_events.lua",
            "crunched": 0,
            "start": 34915112,
            "end": 35117215,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/common_events.lua.json",
            "crunched": 0,
            "start": 35117215,
            "end": 35117283,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/misc_functions.lua",
            "crunched": 0,
            "start": 35117283,
            "end": 35199948,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/misc_functions.lua.json",
            "crunched": 0,
            "start": 35199948,
            "end": 35200017,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/state_events.lua",
            "crunched": 0,
            "start": 35200017,
            "end": 35284096,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/state_events.lua.json",
            "crunched": 0,
            "start": 35284096,
            "end": 35284163,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/UI_definitions.lua",
            "crunched": 0,
            "start": 35284163,
            "end": 35663696,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/functions/UI_definitions.lua.json",
            "crunched": 0,
            "start": 35663696,
            "end": 35663765,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/game.lua",
            "crunched": 0,
            "start": 35663765,
            "end": 35918975,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/game.lua.json",
            "crunched": 0,
            "start": 35918975,
            "end": 35919024,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/globals.lua",
            "crunched": 0,
            "start": 35919024,
            "end": 35940987,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/globals.lua.json",
            "crunched": 0,
            "start": 35940987,
            "end": 35941039,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/lovely/SMODS/preflight/core/src/preflight/core.lua",
            "crunched": 0,
            "start": 35941039,
            "end": 35946628,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/lovely/SMODS/preflight/core/src/preflight/core.lua.json",
            "crunched": 0,
            "start": 35946628,
            "end": 35946725,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/main.lua",
            "crunched": 0,
            "start": 35946725,
            "end": 36059597,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/main.lua.json",
            "crunched": 0,
            "start": 36059597,
            "end": 36059646,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/card_draw.lua",
            "crunched": 0,
            "start": 36059646,
            "end": 36087957,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/card_draw.lua.json",
            "crunched": 0,
            "start": 36087957,
            "end": 36088029,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/game_object.lua",
            "crunched": 0,
            "start": 36088029,
            "end": 36260605,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/game_object.lua.json",
            "crunched": 0,
            "start": 36260605,
            "end": 36260679,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/overrides.lua",
            "crunched": 0,
            "start": 36260679,
            "end": 36378004,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/overrides.lua.json",
            "crunched": 0,
            "start": 36378004,
            "end": 36378076,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/ui.lua",
            "crunched": 0,
            "start": 36378076,
            "end": 36510620,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/ui.lua.json",
            "crunched": 0,
            "start": 36510620,
            "end": 36510685,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/utils.lua",
            "crunched": 0,
            "start": 36510685,
            "end": 36683393,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/_/src/utils.lua.json",
            "crunched": 0,
            "start": 36683393,
            "end": 36683461,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/Cryptid/items/code.lua",
            "crunched": 0,
            "start": 36683461,
            "end": 36840741,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/SMODS/Cryptid/items/code.lua.json",
            "crunched": 0,
            "start": 36840741,
            "end": 36840816,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/tag.lua",
            "crunched": 0,
            "start": 36840816,
            "end": 36872167,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/game-dump/tag.lua.json",
            "crunched": 0,
            "start": 36872167,
            "end": 36872215,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.40.18.log",
            "crunched": 0,
            "start": 36872215,
            "end": 36872571,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.40.51.log",
            "crunched": 0,
            "start": 36872571,
            "end": 36875350,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.41.18.log",
            "crunched": 0,
            "start": 36875350,
            "end": 36887467,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.42.50.log",
            "crunched": 0,
            "start": 36887467,
            "end": 36899515,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.44.17.log",
            "crunched": 0,
            "start": 36899515,
            "end": 36907125,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-20.47.04.log",
            "crunched": 0,
            "start": 36907125,
            "end": 36916476,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-21.48.42.log",
            "crunched": 0,
            "start": 36916476,
            "end": 36925743,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-21.48.59.log",
            "crunched": 0,
            "start": 36925743,
            "end": 36935002,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-21.53.01.log",
            "crunched": 0,
            "start": 36935002,
            "end": 36944262,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.09.52.log",
            "crunched": 0,
            "start": 36944262,
            "end": 36970713,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.14.35.log",
            "crunched": 0,
            "start": 36970713,
            "end": 36997160,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.16.36.log",
            "crunched": 0,
            "start": 36997160,
            "end": 37023610,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.17.34.log",
            "crunched": 0,
            "start": 37023610,
            "end": 37050061,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.18.20.log",
            "crunched": 0,
            "start": 37050061,
            "end": 37076515,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.21.50.log",
            "crunched": 0,
            "start": 37076515,
            "end": 37102962,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.24.37.log",
            "crunched": 0,
            "start": 37102962,
            "end": 37129409,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.25.26.log",
            "crunched": 0,
            "start": 37129409,
            "end": 37155856,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.27.55.log",
            "crunched": 0,
            "start": 37155856,
            "end": 37182311,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.29.59.log",
            "crunched": 0,
            "start": 37182311,
            "end": 37209042,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.30.10.log",
            "crunched": 0,
            "start": 37209042,
            "end": 37235772,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.31.32.log",
            "crunched": 0,
            "start": 37235772,
            "end": 37262503,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.35.25.log",
            "crunched": 0,
            "start": 37262503,
            "end": 37289241,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.36.59.log",
            "crunched": 0,
            "start": 37289241,
            "end": 37298508,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.37.18.log",
            "crunched": 0,
            "start": 37298508,
            "end": 37313517,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.37.54.log",
            "crunched": 0,
            "start": 37313517,
            "end": 37328156,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.38.56.log",
            "crunched": 0,
            "start": 37328156,
            "end": 37354599,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.42.49.log",
            "crunched": 0,
            "start": 37354599,
            "end": 37381046,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.45.38.log",
            "crunched": 0,
            "start": 37381046,
            "end": 37405763,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.46.06.log",
            "crunched": 0,
            "start": 37405763,
            "end": 37430477,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.46.50.log",
            "crunched": 0,
            "start": 37430477,
            "end": 37455183,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.49.39.log",
            "crunched": 0,
            "start": 37455183,
            "end": 37479894,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-22.56.15.log",
            "crunched": 0,
            "start": 37479894,
            "end": 37504604,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.09-23.05.04.log",
            "crunched": 0,
            "start": 37504604,
            "end": 37529614,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-15.56.18.log",
            "crunched": 0,
            "start": 37529614,
            "end": 37554627,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.02.31.log",
            "crunched": 0,
            "start": 37554627,
            "end": 37579639,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.05.44.log",
            "crunched": 0,
            "start": 37579639,
            "end": 37604648,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.08.24.log",
            "crunched": 0,
            "start": 37604648,
            "end": 37629657,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.18.41.log",
            "crunched": 0,
            "start": 37629657,
            "end": 37654768,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.24.13.log",
            "crunched": 0,
            "start": 37654768,
            "end": 37679655,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.27.53.log",
            "crunched": 0,
            "start": 37679655,
            "end": 37704535,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.31.40.log",
            "crunched": 0,
            "start": 37704535,
            "end": 37729414,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.37.17.log",
            "crunched": 0,
            "start": 37729414,
            "end": 37754295,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.41.14.log",
            "crunched": 0,
            "start": 37754295,
            "end": 37779172,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.45.16.log",
            "crunched": 0,
            "start": 37779172,
            "end": 37804053,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.46.05.log",
            "crunched": 0,
            "start": 37804053,
            "end": 37828936,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.47.19.log",
            "crunched": 0,
            "start": 37828936,
            "end": 37853813,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.48.04.log",
            "crunched": 0,
            "start": 37853813,
            "end": 37878693,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.48.55.log",
            "crunched": 0,
            "start": 37878693,
            "end": 37903569,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.49.53.log",
            "crunched": 0,
            "start": 37903569,
            "end": 37928452,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-16.50.28.log",
            "crunched": 0,
            "start": 37928452,
            "end": 37953333,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-17.03.01.log",
            "crunched": 0,
            "start": 37953333,
            "end": 37978217,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-17.43.42.log",
            "crunched": 0,
            "start": 37978217,
            "end": 38003100,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-17.50.33.log",
            "crunched": 0,
            "start": 38003100,
            "end": 38027977,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-17.56.51.log",
            "crunched": 0,
            "start": 38027977,
            "end": 38052860,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-18.31.32.log",
            "crunched": 0,
            "start": 38052860,
            "end": 38078482,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-18.32.09.log",
            "crunched": 0,
            "start": 38078482,
            "end": 38096489,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-18.33.20.log",
            "crunched": 0,
            "start": 38096489,
            "end": 38105711,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-18.33.29.log",
            "crunched": 0,
            "start": 38105711,
            "end": 38114849,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.10-18.38.17.log",
            "crunched": 0,
            "start": 38114849,
            "end": 38125726,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.18-18.00.22.log",
            "crunched": 0,
            "start": 38125726,
            "end": 38145836,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.18-20.50.43.log",
            "crunched": 0,
            "start": 38145836,
            "end": 38155290,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.18-22.17.21.log",
            "crunched": 0,
            "start": 38155290,
            "end": 38175172,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-10.48.04.log",
            "crunched": 0,
            "start": 38175172,
            "end": 38195053,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-13.54.06.log",
            "crunched": 0,
            "start": 38195053,
            "end": 38204507,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-18.04.58.log",
            "crunched": 0,
            "start": 38204507,
            "end": 38213961,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-20.28.32.log",
            "crunched": 0,
            "start": 38213961,
            "end": 38223412,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-20.34.31.log",
            "crunched": 0,
            "start": 38223412,
            "end": 38232866,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.19-22.15.51.log",
            "crunched": 0,
            "start": 38232866,
            "end": 38242452,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-10.52.33.log",
            "crunched": 0,
            "start": 38242452,
            "end": 38253336,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-10.54.12.log",
            "crunched": 0,
            "start": 38253336,
            "end": 38264176,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-10.58.42.log",
            "crunched": 0,
            "start": 38264176,
            "end": 38275140,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-14.26.09.log",
            "crunched": 0,
            "start": 38275140,
            "end": 38280164,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-14.27.31.log",
            "crunched": 0,
            "start": 38280164,
            "end": 38296995,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-14.43.35.log",
            "crunched": 0,
            "start": 38296995,
            "end": 38487505,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-15.16.09.log",
            "crunched": 0,
            "start": 38487505,
            "end": 39470889,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-20.32.11.log",
            "crunched": 0,
            "start": 39470889,
            "end": 39514549,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.20-20.41.29.log",
            "crunched": 0,
            "start": 39514549,
            "end": 40208907,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-16.41.30.log",
            "crunched": 0,
            "start": 40208907,
            "end": 40218038,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-16.41.40.log",
            "crunched": 0,
            "start": 40218038,
            "end": 40227168,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-16.42.37.log",
            "crunched": 0,
            "start": 40227168,
            "end": 40243035,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-17.46.10.log",
            "crunched": 0,
            "start": 40243035,
            "end": 40256672,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-17.48.12.log",
            "crunched": 0,
            "start": 40256672,
            "end": 40267986,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.34.21.log",
            "crunched": 0,
            "start": 40267986,
            "end": 40279300,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.37.25.log",
            "crunched": 0,
            "start": 40279300,
            "end": 40290622,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.42.17.log",
            "crunched": 0,
            "start": 40290622,
            "end": 40301937,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.46.00.log",
            "crunched": 0,
            "start": 40301937,
            "end": 40313252,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.50.36.log",
            "crunched": 0,
            "start": 40313252,
            "end": 40324567,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.54.50.log",
            "crunched": 0,
            "start": 40324567,
            "end": 40336134,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-20.58.05.log",
            "crunched": 0,
            "start": 40336134,
            "end": 40347448,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.02.14.log",
            "crunched": 0,
            "start": 40347448,
            "end": 40358763,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.05.36.log",
            "crunched": 0,
            "start": 40358763,
            "end": 40370077,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.10.50.log",
            "crunched": 0,
            "start": 40370077,
            "end": 40381392,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.16.57.log",
            "crunched": 0,
            "start": 40381392,
            "end": 40392714,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.21.15.log",
            "crunched": 0,
            "start": 40392714,
            "end": 40404036,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.26.38.log",
            "crunched": 0,
            "start": 40404036,
            "end": 40415351,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.31.59.log",
            "crunched": 0,
            "start": 40415351,
            "end": 40426666,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.40.41.log",
            "crunched": 0,
            "start": 40426666,
            "end": 40437987,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.44.53.log",
            "crunched": 0,
            "start": 40437987,
            "end": 40445381,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.45.37.log",
            "crunched": 0,
            "start": 40445381,
            "end": 40452775,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.47.04.log",
            "crunched": 0,
            "start": 40452775,
            "end": 40460169,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.48.17.log",
            "crunched": 0,
            "start": 40460169,
            "end": 40467562,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.51.54.log",
            "crunched": 0,
            "start": 40467562,
            "end": 40478884,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.57.17.log",
            "crunched": 0,
            "start": 40478884,
            "end": 40490199,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-21.58.38.log",
            "crunched": 0,
            "start": 40490199,
            "end": 40501521,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.01.38.log",
            "crunched": 0,
            "start": 40501521,
            "end": 40512843,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.03.16.log",
            "crunched": 0,
            "start": 40512843,
            "end": 40524164,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.17.01.log",
            "crunched": 0,
            "start": 40524164,
            "end": 40535486,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.18.28.log",
            "crunched": 0,
            "start": 40535486,
            "end": 40546807,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.21.36.log",
            "crunched": 0,
            "start": 40546807,
            "end": 40558122,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.34.46.log",
            "crunched": 0,
            "start": 40558122,
            "end": 40569443,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.38.01.log",
            "crunched": 0,
            "start": 40569443,
            "end": 40580758,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.39.23.log",
            "crunched": 0,
            "start": 40580758,
            "end": 40592080,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.47.29.log",
            "crunched": 0,
            "start": 40592080,
            "end": 40603394,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.52.21.log",
            "crunched": 0,
            "start": 40603394,
            "end": 40614709,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.53.45.log",
            "crunched": 0,
            "start": 40614709,
            "end": 40626024,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.56.44.log",
            "crunched": 0,
            "start": 40626024,
            "end": 40637339,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-22.58.04.log",
            "crunched": 0,
            "start": 40637339,
            "end": 40644724,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-23.02.36.log",
            "crunched": 0,
            "start": 40644724,
            "end": 40656046,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.21-23.05.59.log",
            "crunched": 0,
            "start": 40656046,
            "end": 40667367,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.23-15.58.48.log",
            "crunched": 0,
            "start": 40667367,
            "end": 40677208,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-16.34.54.log",
            "crunched": 0,
            "start": 40677208,
            "end": 40688668,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-16.48.36.log",
            "crunched": 0,
            "start": 40688668,
            "end": 40702510,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-16.49.47.log",
            "crunched": 0,
            "start": 40702510,
            "end": 40716088,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-16.50.08.log",
            "crunched": 0,
            "start": 40716088,
            "end": 40729666,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-16.53.19.log",
            "crunched": 0,
            "start": 40729666,
            "end": 40741140,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.24-17.02.41.log",
            "crunched": 0,
            "start": 40741140,
            "end": 40752614,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-16.37.00.log",
            "crunched": 0,
            "start": 40752614,
            "end": 40764080,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-16.44.07.log",
            "crunched": 0,
            "start": 40764080,
            "end": 40775553,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-16.46.29.log",
            "crunched": 0,
            "start": 40775553,
            "end": 40787026,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-17.01.40.log",
            "crunched": 0,
            "start": 40787026,
            "end": 40798492,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-19.54.18.log",
            "crunched": 0,
            "start": 40798492,
            "end": 40809958,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.10.43.log",
            "crunched": 0,
            "start": 40809958,
            "end": 40821424,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.12.32.log",
            "crunched": 0,
            "start": 40821424,
            "end": 40832890,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.17.20.log",
            "crunched": 0,
            "start": 40832890,
            "end": 40844356,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.18.22.log",
            "crunched": 0,
            "start": 40844356,
            "end": 40857925,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.21.11.log",
            "crunched": 0,
            "start": 40857925,
            "end": 40869391,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.38.05.log",
            "crunched": 0,
            "start": 40869391,
            "end": 40880857,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.40.26.log",
            "crunched": 0,
            "start": 40880857,
            "end": 40892891,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.43.36.log",
            "crunched": 0,
            "start": 40892891,
            "end": 40904926,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.44.25.log",
            "crunched": 0,
            "start": 40904926,
            "end": 40916399,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.57.57.log",
            "crunched": 0,
            "start": 40916399,
            "end": 40927865,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.27-20.59.33.log",
            "crunched": 0,
            "start": 40927865,
            "end": 40939338,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-18.54.20.log",
            "crunched": 0,
            "start": 40939338,
            "end": 40950805,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.02.26.log",
            "crunched": 0,
            "start": 40950805,
            "end": 40960713,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.05.22.log",
            "crunched": 0,
            "start": 40960713,
            "end": 40970621,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.10.02.log",
            "crunched": 0,
            "start": 40970621,
            "end": 40980529,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.16.06.log",
            "crunched": 0,
            "start": 40980529,
            "end": 40990444,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.22.54.log",
            "crunched": 0,
            "start": 40990444,
            "end": 41000359,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.27.27.log",
            "crunched": 0,
            "start": 41000359,
            "end": 41010273,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.31.00.log",
            "crunched": 0,
            "start": 41010273,
            "end": 41020181,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.32.04.log",
            "crunched": 0,
            "start": 41020181,
            "end": 41046541,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.36.17.log",
            "crunched": 0,
            "start": 41046541,
            "end": 41056449,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.40.27.log",
            "crunched": 0,
            "start": 41056449,
            "end": 41066364,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.43.41.log",
            "crunched": 0,
            "start": 41066364,
            "end": 41076279,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.45.42.log",
            "crunched": 0,
            "start": 41076279,
            "end": 41086185,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.46.59.log",
            "crunched": 0,
            "start": 41086185,
            "end": 41096093,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.53.59.log",
            "crunched": 0,
            "start": 41096093,
            "end": 41106001,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.55.49.log",
            "crunched": 0,
            "start": 41106001,
            "end": 41115916,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-19.58.07.log",
            "crunched": 0,
            "start": 41115916,
            "end": 41125824,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.05.39.log",
            "crunched": 0,
            "start": 41125824,
            "end": 41135731,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.12.27.log",
            "crunched": 0,
            "start": 41135731,
            "end": 41145639,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.13.35.log",
            "crunched": 0,
            "start": 41145639,
            "end": 41155547,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.22.22.log",
            "crunched": 0,
            "start": 41155547,
            "end": 41165455,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.24.50.log",
            "crunched": 0,
            "start": 41165455,
            "end": 41175363,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.28.36.log",
            "crunched": 0,
            "start": 41175363,
            "end": 41185278,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-20.42.02.log",
            "crunched": 0,
            "start": 41185278,
            "end": 41195186,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.47.08.log",
            "crunched": 0,
            "start": 41195186,
            "end": 41197835,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.47.36.log",
            "crunched": 0,
            "start": 41197835,
            "end": 41200482,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.48.03.log",
            "crunched": 0,
            "start": 41200482,
            "end": 41212763,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.48.40.log",
            "crunched": 0,
            "start": 41212763,
            "end": 41237329,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.56.56.log",
            "crunched": 0,
            "start": 41237329,
            "end": 41255511,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-21.59.06.log",
            "crunched": 0,
            "start": 41255511,
            "end": 41282917,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.01.21.log",
            "crunched": 0,
            "start": 41282917,
            "end": 41310323,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.02.03.log",
            "crunched": 0,
            "start": 41310323,
            "end": 41337729,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.06.35.log",
            "crunched": 0,
            "start": 41337729,
            "end": 41365135,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.09.06.log",
            "crunched": 0,
            "start": 41365135,
            "end": 41392541,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.13.44.log",
            "crunched": 0,
            "start": 41392541,
            "end": 41419946,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.15.01.log",
            "crunched": 0,
            "start": 41419946,
            "end": 41447352,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.20.24.log",
            "crunched": 0,
            "start": 41447352,
            "end": 41474758,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.23.43.log",
            "crunched": 0,
            "start": 41474758,
            "end": 41502164,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.29.55.log",
            "crunched": 0,
            "start": 41502164,
            "end": 41529570,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.32.43.log",
            "crunched": 0,
            "start": 41529570,
            "end": 41556976,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.37.00.log",
            "crunched": 0,
            "start": 41556976,
            "end": 41584382,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.39.42.log",
            "crunched": 0,
            "start": 41584382,
            "end": 41611788,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.09.30-22.43.09.log",
            "crunched": 0,
            "start": 41611788,
            "end": 41639194,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.10.01-15.52.47.log",
            "crunched": 0,
            "start": 41639194,
            "end": 41666601,
            "audio": false
        },
        {
            "filename": "/Mods/lovely/log/lovely-2026.10.01-15.54.12.log",
            "crunched": 0,
            "start": 41666601,
            "end": 41694006,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/.env.example",
            "crunched": 0,
            "start": 41694006,
            "end": 41694238,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/.gitignore",
            "crunched": 0,
            "start": 41694238,
            "end": 41694356,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/agents.md",
            "crunched": 0,
            "start": 41694356,
            "end": 41714903,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 41714903,
            "end": 41719151,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/alt_stickers.png",
            "crunched": 0,
            "start": 41719151,
            "end": 41720705,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/b_heidelberg.png",
            "crunched": 0,
            "start": 41720705,
            "end": 41721912,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/blind_col.png",
            "crunched": 0,
            "start": 41721912,
            "end": 41827248,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 41827248,
            "end": 41852493,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/c_asteroid.png",
            "crunched": 0,
            "start": 41852493,
            "end": 41859545,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/c_ouija_2.png",
            "crunched": 0,
            "start": 41859545,
            "end": 41860944,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/deck_stickers.png",
            "crunched": 0,
            "start": 41860944,
            "end": 41887570,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/decks.png",
            "crunched": 0,
            "start": 41887570,
            "end": 41914569,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 41914569,
            "end": 42112867,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 42112867,
            "end": 42218244,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 42218244,
            "end": 42229112,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 42229112,
            "end": 42236146,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 42236146,
            "end": 42246360,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 42246360,
            "end": 42255053,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 42255053,
            "end": 42257975,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 42257975,
            "end": 42268712,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_copycat.png",
            "crunched": 0,
            "start": 42268712,
            "end": 42275433,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_defensive_joker.png",
            "crunched": 0,
            "start": 42275433,
            "end": 42277401,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 42277401,
            "end": 42278217,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 42278217,
            "end": 42284636,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 42284636,
            "end": 42296621,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 42296621,
            "end": 42299342,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 42299342,
            "end": 42304509,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 42304509,
            "end": 42313046,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 42313046,
            "end": 42316659,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 42316659,
            "end": 42326608,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 42326608,
            "end": 42339109,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_magnet.png",
            "crunched": 0,
            "start": 42339109,
            "end": 42343904,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 42343904,
            "end": 42353032,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 42353032,
            "end": 42357520,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_order_sandbox.png",
            "crunched": 0,
            "start": 42357520,
            "end": 42366131,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_pacifist.png",
            "crunched": 0,
            "start": 42366131,
            "end": 42368116,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_penny_pincher.png",
            "crunched": 0,
            "start": 42368116,
            "end": 42370411,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 42370411,
            "end": 42380551,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_pizza.png",
            "crunched": 0,
            "start": 42380551,
            "end": 42383949,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 42383949,
            "end": 42385693,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 42385693,
            "end": 42392457,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 42392457,
            "end": 42399610,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_skip_off.png",
            "crunched": 0,
            "start": 42399610,
            "end": 42401406,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_speedrun.png",
            "crunched": 0,
            "start": 42401406,
            "end": 42402021,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_square_sandbox.png",
            "crunched": 0,
            "start": 42402021,
            "end": 42406253,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 42406253,
            "end": 42412295,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_taxes.png",
            "crunched": 0,
            "start": 42412295,
            "end": 42419336,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 42419336,
            "end": 42429121,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 42429121,
            "end": 42436225,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/modicon.png",
            "crunched": 0,
            "start": 42436225,
            "end": 42436695,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/player_blind_row.png",
            "crunched": 0,
            "start": 42436695,
            "end": 42438265,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/release_jokers.png",
            "crunched": 0,
            "start": 42438265,
            "end": 43027563,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/stakes-chips.png",
            "crunched": 0,
            "start": 43027563,
            "end": 43029593,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/standard_giga.png",
            "crunched": 0,
            "start": 43029593,
            "end": 43033577,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/sticker_balanced.png",
            "crunched": 0,
            "start": 43033577,
            "end": 43038070,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/sticker_nemesis.png",
            "crunched": 0,
            "start": 43038070,
            "end": 43038632,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/stickers.png",
            "crunched": 0,
            "start": 43038632,
            "end": 43043016,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/1x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 43043016,
            "end": 43044809,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/alt_mp_stakes.png",
            "crunched": 0,
            "start": 43044809,
            "end": 43066839,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/alt_stickers.png",
            "crunched": 0,
            "start": 43066839,
            "end": 43070307,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/b_heidelberg.png",
            "crunched": 0,
            "start": 43070307,
            "end": 43072810,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/blind_col.png",
            "crunched": 0,
            "start": 43072810,
            "end": 43265071,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/c_asteroid_ru.png",
            "crunched": 0,
            "start": 43265071,
            "end": 43272783,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/c_asteroid.png",
            "crunched": 0,
            "start": 43272783,
            "end": 43281001,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/c_ouija_2.png",
            "crunched": 0,
            "start": 43281001,
            "end": 43283940,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/deck_stickers.png",
            "crunched": 0,
            "start": 43283940,
            "end": 43325349,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/decks.png",
            "crunched": 0,
            "start": 43325349,
            "end": 43376148,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/ec_jokers_sandbox.png",
            "crunched": 0,
            "start": 43376148,
            "end": 43637406,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/ec_other_sandbox.png",
            "crunched": 0,
            "start": 43637406,
            "end": 43695206,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_baseball_sandbox.png",
            "crunched": 0,
            "start": 43695206,
            "end": 43722328,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_bloodstone_sandbox.png",
            "crunched": 0,
            "start": 43722328,
            "end": 43735670,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_castle_sandbox.png",
            "crunched": 0,
            "start": 43735670,
            "end": 43760768,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_cloud_9_sandbox.png",
            "crunched": 0,
            "start": 43760768,
            "end": 43783724,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_conjoined_joker.png",
            "crunched": 0,
            "start": 43783724,
            "end": 43786926,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_constellation_sandbox.png",
            "crunched": 0,
            "start": 43786926,
            "end": 43812413,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_copycat.png",
            "crunched": 0,
            "start": 43812413,
            "end": 43819942,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_defensive_joker.png",
            "crunched": 0,
            "start": 43819942,
            "end": 43822344,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_ERROR_sandbox.png",
            "crunched": 0,
            "start": 43822344,
            "end": 43823998,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_faceless_sandbox.png",
            "crunched": 0,
            "start": 43823998,
            "end": 43839063,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_hit_the_road_sandbox.png",
            "crunched": 0,
            "start": 43839063,
            "end": 43868888,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_idol_sandbox_bw.png",
            "crunched": 0,
            "start": 43868888,
            "end": 43879343,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_idol_sandbox_color.png",
            "crunched": 0,
            "start": 43879343,
            "end": 43890105,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_juggler_sandbox.png",
            "crunched": 0,
            "start": 43890105,
            "end": 43909359,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_lets_go_gambling.png",
            "crunched": 0,
            "start": 43909359,
            "end": 43913344,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_loyalty_card_sandbox.png",
            "crunched": 0,
            "start": 43913344,
            "end": 43936606,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_lucky_cat_sandbox.png",
            "crunched": 0,
            "start": 43936606,
            "end": 43977823,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_magnet.png",
            "crunched": 0,
            "start": 43977823,
            "end": 43983995,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_mail_sandbox.png",
            "crunched": 0,
            "start": 43983995,
            "end": 44005961,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_misprint_sandbox.png",
            "crunched": 0,
            "start": 44005961,
            "end": 44028098,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_order_sandbox.png",
            "crunched": 0,
            "start": 44028098,
            "end": 44048470,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_pacifist.png",
            "crunched": 0,
            "start": 44048470,
            "end": 44050971,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_penny_pincher.png",
            "crunched": 0,
            "start": 44050971,
            "end": 44053772,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_photograph_sandbox.png",
            "crunched": 0,
            "start": 44053772,
            "end": 44079131,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_pizza.png",
            "crunched": 0,
            "start": 44079131,
            "end": 44083138,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_ride_the_bus_sandbox.png",
            "crunched": 0,
            "start": 44083138,
            "end": 44088577,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_runner_sandbox.png",
            "crunched": 0,
            "start": 44088577,
            "end": 44103484,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_satellite_sandbox.png",
            "crunched": 0,
            "start": 44103484,
            "end": 44119566,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_skip_off.png",
            "crunched": 0,
            "start": 44119566,
            "end": 44121742,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_speedrun.png",
            "crunched": 0,
            "start": 44121742,
            "end": 44123026,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_square_sandbox.png",
            "crunched": 0,
            "start": 44123026,
            "end": 44132379,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_steel_joker_sandbox.png",
            "crunched": 0,
            "start": 44132379,
            "end": 44145588,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_taxes.png",
            "crunched": 0,
            "start": 44145588,
            "end": 44149681,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_throwback_sandbox.png",
            "crunched": 0,
            "start": 44149681,
            "end": 44173170,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/j_vampire_sandbox.png",
            "crunched": 0,
            "start": 44173170,
            "end": 44190478,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/modicon.png",
            "crunched": 0,
            "start": 44190478,
            "end": 44191181,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/player_blind_row.png",
            "crunched": 0,
            "start": 44191181,
            "end": 44195459,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/release_jokers.png",
            "crunched": 0,
            "start": 44195459,
            "end": 45060369,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/stakes-chips.png",
            "crunched": 0,
            "start": 45060369,
            "end": 45069144,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/standard_giga.png",
            "crunched": 0,
            "start": 45069144,
            "end": 45077582,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/sticker_balanced.png",
            "crunched": 0,
            "start": 45077582,
            "end": 45078601,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/sticker_nemesis.png",
            "crunched": 0,
            "start": 45078601,
            "end": 45079493,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/assets/2x/tag_gambling_sandbox.png",
            "crunched": 0,
            "start": 45079493,
            "end": 45080196,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/CHANGELOG.md",
            "crunched": 0,
            "start": 45080196,
            "end": 45082318,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/_compatibility.lua",
            "crunched": 0,
            "start": 45082318,
            "end": 45084313,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/AntePreview.lua",
            "crunched": 0,
            "start": 45084313,
            "end": 45084704,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/CodexArcanum.lua",
            "crunched": 0,
            "start": 45084704,
            "end": 45084930,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Cryptid.lua",
            "crunched": 0,
            "start": 45084930,
            "end": 45086831,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Distro.lua",
            "crunched": 0,
            "start": 45086831,
            "end": 45089567,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/ExtraCredit.lua",
            "crunched": 0,
            "start": 45089567,
            "end": 45089766,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Handy.lua",
            "crunched": 0,
            "start": 45089766,
            "end": 45094908,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/HotPotato.lua",
            "crunched": 0,
            "start": 45094908,
            "end": 45098721,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Jen.lua",
            "crunched": 0,
            "start": 45098721,
            "end": 45098992,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/JokerDisplay.lua",
            "crunched": 0,
            "start": 45098992,
            "end": 45107854,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Ortalab.lua",
            "crunched": 0,
            "start": 45107854,
            "end": 45108158,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Pokermon.lua",
            "crunched": 0,
            "start": 45108158,
            "end": 45108405,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/CorePreview.lua",
            "crunched": 0,
            "start": 45108405,
            "end": 45117775,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/EngineSimulate.lua",
            "crunched": 0,
            "start": 45117775,
            "end": 45134333,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/InitPreview.lua",
            "crunched": 0,
            "start": 45134333,
            "end": 45138566,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/InitSimulate.lua",
            "crunched": 0,
            "start": 45138566,
            "end": 45139578,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/InterfacePreview.lua",
            "crunched": 0,
            "start": 45139578,
            "end": 45144524,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/Jokers/_Vanilla.lua",
            "crunched": 0,
            "start": 45144524,
            "end": 45180373,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/Jokers/Multiplayer.lua",
            "crunched": 0,
            "start": 45180373,
            "end": 45182751,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/UtilsPreview.lua",
            "crunched": 0,
            "start": 45182751,
            "end": 45183619,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Preview/UtilsSimulate.lua",
            "crunched": 0,
            "start": 45183619,
            "end": 45190846,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/StrangePencil.lua",
            "crunched": 0,
            "start": 45190846,
            "end": 45191473,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/Talisman.lua",
            "crunched": 0,
            "start": 45191473,
            "end": 45191521,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/TheOrder.lua",
            "crunched": 0,
            "start": 45191521,
            "end": 45215767,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/TooManyJokers.lua",
            "crunched": 0,
            "start": 45215767,
            "end": 45216175,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/compatibility/UpgradeMod.lua",
            "crunched": 0,
            "start": 45216175,
            "end": 45217036,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/config.lua",
            "crunched": 0,
            "start": 45217036,
            "end": 45217400,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/CONTRIBUTING.md",
            "crunched": 0,
            "start": 45217400,
            "end": 45221633,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/core.lua",
            "crunched": 0,
            "start": 45221633,
            "end": 45230932,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/gamemodes/_gamemodes.lua",
            "crunched": 0,
            "start": 45230932,
            "end": 45231838,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/gamemodes/attrition.lua",
            "crunched": 0,
            "start": 45231838,
            "end": 45236122,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/gamemodes/showdown.lua",
            "crunched": 0,
            "start": 45236122,
            "end": 45240331,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/gamemodes/survival.lua",
            "crunched": 0,
            "start": 45240331,
            "end": 45243092,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/_layers.lua",
            "crunched": 0,
            "start": 45243092,
            "end": 45252134,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/ban_mutators.lua",
            "crunched": 0,
            "start": 45252134,
            "end": 45252785,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/classic.lua",
            "crunched": 0,
            "start": 45252785,
            "end": 45252884,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/economy_mutators.lua",
            "crunched": 0,
            "start": 45252884,
            "end": 45253952,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/eeeee.lua",
            "crunched": 0,
            "start": 45253952,
            "end": 45254828,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/esoteric_mutators.lua",
            "crunched": 0,
            "start": 45254828,
            "end": 45255227,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/experimental.lua",
            "crunched": 0,
            "start": 45255227,
            "end": 45257238,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/glass_cannon.lua",
            "crunched": 0,
            "start": 45257238,
            "end": 45258026,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/glass_variants.lua",
            "crunched": 0,
            "start": 45258026,
            "end": 45258236,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/mutator_stubs.lua",
            "crunched": 0,
            "start": 45258236,
            "end": 45258490,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/no_anim_timer.lua",
            "crunched": 0,
            "start": 45258490,
            "end": 45258628,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/no_red_seals.lua",
            "crunched": 0,
            "start": 45258628,
            "end": 45259574,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/polymorph_spam.lua",
            "crunched": 0,
            "start": 45259574,
            "end": 45263753,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/pressure_timer.lua",
            "crunched": 0,
            "start": 45263753,
            "end": 45264285,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/pvp_timer.lua",
            "crunched": 0,
            "start": 45264285,
            "end": 45264389,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/ranked.lua",
            "crunched": 0,
            "start": 45264389,
            "end": 45264650,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/release.lua",
            "crunched": 0,
            "start": 45264650,
            "end": 45264741,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/sandbox.lua",
            "crunched": 0,
            "start": 45264741,
            "end": 45273479,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/score_instability.lua",
            "crunched": 0,
            "start": 45273479,
            "end": 45275526,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/shared_pockets.lua",
            "crunched": 0,
            "start": 45275526,
            "end": 45278169,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/shop_mutators.lua",
            "crunched": 0,
            "start": 45278169,
            "end": 45278254,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/smallworld.lua",
            "crunched": 0,
            "start": 45278254,
            "end": 45283361,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/speedlatro_timer.lua",
            "crunched": 0,
            "start": 45283361,
            "end": 45288593,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/standard.lua",
            "crunched": 0,
            "start": 45288593,
            "end": 45289149,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/layers/wraith_rework.lua",
            "crunched": 0,
            "start": 45289149,
            "end": 45289343,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/_init.lua",
            "crunched": 0,
            "start": 45289343,
            "end": 45289357,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/_table_utils.lua",
            "crunched": 0,
            "start": 45289357,
            "end": 45290931,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/blind_utils.lua",
            "crunched": 0,
            "start": 45290931,
            "end": 45291555,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/card_utils.lua",
            "crunched": 0,
            "start": 45291555,
            "end": 45298339,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/crypto.lua",
            "crunched": 0,
            "start": 45298339,
            "end": 45300507,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/debug_utils.lua",
            "crunched": 0,
            "start": 45300507,
            "end": 45301255,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/ghost_replay.lua",
            "crunched": 0,
            "start": 45301255,
            "end": 45313472,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/insane_int.lua",
            "crunched": 0,
            "start": 45313472,
            "end": 45317651,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/joker_stats.lua",
            "crunched": 0,
            "start": 45317651,
            "end": 45318922,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/log_parser.lua",
            "crunched": 0,
            "start": 45318922,
            "end": 45332165,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/matchmaking.lua",
            "crunched": 0,
            "start": 45332165,
            "end": 45341263,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/practice_mode.lua",
            "crunched": 0,
            "start": 45341263,
            "end": 45343353,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/replay_log.lua",
            "crunched": 0,
            "start": 45343353,
            "end": 45352878,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/ruleset_utils.lua",
            "crunched": 0,
            "start": 45352878,
            "end": 45355020,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/serialization.lua",
            "crunched": 0,
            "start": 45355020,
            "end": 45357819,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/settings_utils.lua",
            "crunched": 0,
            "start": 45357819,
            "end": 45357819,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/string_utils.lua",
            "crunched": 0,
            "start": 45357819,
            "end": 45358603,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lib/ui.lua",
            "crunched": 0,
            "start": 45358603,
            "end": 45361657,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/LICENSE.md",
            "crunched": 0,
            "start": 45361657,
            "end": 45396806,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/de.lua",
            "crunched": 0,
            "start": 45396806,
            "end": 45405824,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/en-us.lua",
            "crunched": 0,
            "start": 45405824,
            "end": 45456933,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/es_419.lua",
            "crunched": 0,
            "start": 45456933,
            "end": 45493087,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/es_ES.lua",
            "crunched": 0,
            "start": 45493087,
            "end": 45505871,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/fr.lua",
            "crunched": 0,
            "start": 45505871,
            "end": 45519620,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/it.lua",
            "crunched": 0,
            "start": 45519620,
            "end": 45547413,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/ja.lua",
            "crunched": 0,
            "start": 45547413,
            "end": 45581669,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/ko.lua",
            "crunched": 0,
            "start": 45581669,
            "end": 45615075,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/mi.lua",
            "crunched": 0,
            "start": 45615075,
            "end": 45625203,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/nl.lua",
            "crunched": 0,
            "start": 45625203,
            "end": 45638803,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/pl.lua",
            "crunched": 0,
            "start": 45638803,
            "end": 45651702,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/pt_BR.lua",
            "crunched": 0,
            "start": 45651702,
            "end": 45666686,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/ru.lua",
            "crunched": 0,
            "start": 45666686,
            "end": 45735722,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/stylua.toml",
            "crunched": 0,
            "start": 45735722,
            "end": 45735856,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/vi.lua",
            "crunched": 0,
            "start": 45735856,
            "end": 45781499,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/zh_CN.lua",
            "crunched": 0,
            "start": 45781499,
            "end": 45798890,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/localization/zh_TW.lua",
            "crunched": 0,
            "start": 45798890,
            "end": 45801812,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/cards.toml",
            "crunched": 0,
            "start": 45801812,
            "end": 45804399,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/ce.toml",
            "crunched": 0,
            "start": 45804399,
            "end": 45805366,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/challenges.toml",
            "crunched": 0,
            "start": 45805366,
            "end": 45806200,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/compatibility.toml",
            "crunched": 0,
            "start": 45806200,
            "end": 45806811,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/deck_select.toml",
            "crunched": 0,
            "start": 45806811,
            "end": 45809637,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/decks.toml",
            "crunched": 0,
            "start": 45809637,
            "end": 45810594,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/double_emplace.toml",
            "crunched": 0,
            "start": 45810594,
            "end": 45811866,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/end_round.toml",
            "crunched": 0,
            "start": 45811866,
            "end": 45817216,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/game.toml",
            "crunched": 0,
            "start": 45817216,
            "end": 45822791,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/hud.toml",
            "crunched": 0,
            "start": 45822791,
            "end": 45825959,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/misc.toml",
            "crunched": 0,
            "start": 45825959,
            "end": 45832495,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/pause.toml",
            "crunched": 0,
            "start": 45832495,
            "end": 45834245,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/practice.toml",
            "crunched": 0,
            "start": 45834245,
            "end": 45837245,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/preview.toml",
            "crunched": 0,
            "start": 45837245,
            "end": 45838174,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/rework-center.toml",
            "crunched": 0,
            "start": 45838174,
            "end": 45839519,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/shared_area.toml",
            "crunched": 0,
            "start": 45839519,
            "end": 45840369,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/stakes.toml",
            "crunched": 0,
            "start": 45840369,
            "end": 45842695,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/TheOrder.toml",
            "crunched": 0,
            "start": 45842695,
            "end": 45850610,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/timer.toml",
            "crunched": 0,
            "start": 45850610,
            "end": 45851120,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/lovely/view_deck.toml",
            "crunched": 0,
            "start": 45851120,
            "end": 45852037,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/Multiplayer.json",
            "crunched": 0,
            "start": 45852037,
            "end": 45852667,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/networking/action_handlers.lua",
            "crunched": 0,
            "start": 45852667,
            "end": 45899548,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/networking/socket.lua",
            "crunched": 0,
            "start": 45899548,
            "end": 45906048,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/blinds/nemesis.lua",
            "crunched": 0,
            "start": 45906048,
            "end": 45906801,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/boosters/standard_giga.lua",
            "crunched": 0,
            "start": 45906801,
            "end": 45907986,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/all_must_go.lua",
            "crunched": 0,
            "start": 45907986,
            "end": 45908174,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/bacon.lua",
            "crunched": 0,
            "start": 45908174,
            "end": 45909316,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/balancing_act.lua",
            "crunched": 0,
            "start": 45909316,
            "end": 45909823,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/chore_list.lua",
            "crunched": 0,
            "start": 45909823,
            "end": 45910608,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/divination.lua",
            "crunched": 0,
            "start": 45910608,
            "end": 45910754,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/eeeee.lua",
            "crunched": 0,
            "start": 45910754,
            "end": 45910980,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/high_hand.lua",
            "crunched": 0,
            "start": 45910980,
            "end": 45911279,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/in_the_red.lua",
            "crunched": 0,
            "start": 45911279,
            "end": 45911673,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/legendaries.lua",
            "crunched": 0,
            "start": 45911673,
            "end": 45912288,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/lets_go_gambling.lua",
            "crunched": 0,
            "start": 45912288,
            "end": 45913289,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/misprint_deck.lua",
            "crunched": 0,
            "start": 45913289,
            "end": 45913526,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/oops_all_jokers.lua",
            "crunched": 0,
            "start": 45913526,
            "end": 45914728,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/planet_tycoon.lua",
            "crunched": 0,
            "start": 45914728,
            "end": 45915129,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/polymorph_spam.lua",
            "crunched": 0,
            "start": 45915129,
            "end": 45915802,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/psychosis.lua",
            "crunched": 0,
            "start": 45915802,
            "end": 45915946,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/salvaged_sibyl.lua",
            "crunched": 0,
            "start": 45915946,
            "end": 45918026,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/scratch.lua",
            "crunched": 0,
            "start": 45918026,
            "end": 45918293,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/shared_pockets.lua",
            "crunched": 0,
            "start": 45918293,
            "end": 45918667,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/skip_off.lua",
            "crunched": 0,
            "start": 45918667,
            "end": 45918856,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/speed.lua",
            "crunched": 0,
            "start": 45918856,
            "end": 45919095,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/twin_towers.lua",
            "crunched": 0,
            "start": 45919095,
            "end": 45919281,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/challenges/vantablack.lua",
            "crunched": 0,
            "start": 45919281,
            "end": 45919649,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/consumables/asteroid.lua",
            "crunched": 0,
            "start": 45919649,
            "end": 45921099,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/consumables/judgement.lua",
            "crunched": 0,
            "start": 45921099,
            "end": 45923565,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/consumables/ouija.lua",
            "crunched": 0,
            "start": 45923565,
            "end": 45926084,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/consumables/sandbox/ectoplasm.lua",
            "crunched": 0,
            "start": 45926084,
            "end": 45927778,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/consumables/wraith.lua",
            "crunched": 0,
            "start": 45927778,
            "end": 45928684,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/_decks.lua",
            "crunched": 0,
            "start": 45928684,
            "end": 45929714,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/00_violet.lua",
            "crunched": 0,
            "start": 45929714,
            "end": 45930545,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/01_indigo.lua",
            "crunched": 0,
            "start": 45930545,
            "end": 45933600,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/02_orange.lua",
            "crunched": 0,
            "start": 45933600,
            "end": 45934871,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/09_white.lua",
            "crunched": 0,
            "start": 45934871,
            "end": 45935857,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/AA_oracle.lua",
            "crunched": 0,
            "start": 45935857,
            "end": 45936654,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/BB_gradient.lua",
            "crunched": 0,
            "start": 45936654,
            "end": 45942192,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/CC_heidelberg.lua",
            "crunched": 0,
            "start": 45942192,
            "end": 45942912,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/EC_echo_deck.lua",
            "crunched": 0,
            "start": 45942912,
            "end": 45944261,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/decks/ZZ_cocktail.lua",
            "crunched": 0,
            "start": 45944261,
            "end": 45963625,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/editions/phantom.lua",
            "crunched": 0,
            "start": 45963625,
            "end": 45964772,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/enhancements/mp_glass.lua",
            "crunched": 0,
            "start": 45964772,
            "end": 45964979,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/conjoined_joker.lua",
            "crunched": 0,
            "start": 45964979,
            "end": 45966782,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/defensive_joker.lua",
            "crunched": 0,
            "start": 45966782,
            "end": 45968179,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/experimental/baron_uncommon.lua",
            "crunched": 0,
            "start": 45968179,
            "end": 45968906,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/experimental/idol_rare.lua",
            "crunched": 0,
            "start": 45968906,
            "end": 45969840,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/experimental/mime_rare.lua",
            "crunched": 0,
            "start": 45969840,
            "end": 45970328,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/experimental/todo_list.lua",
            "crunched": 0,
            "start": 45970328,
            "end": 45971941,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/lets_go_gambling.lua",
            "crunched": 0,
            "start": 45971941,
            "end": 45974226,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/pacifist.lua",
            "crunched": 0,
            "start": 45974226,
            "end": 45975038,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/penny_pincher.lua",
            "crunched": 0,
            "start": 45975038,
            "end": 45976164,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/pizza.lua",
            "crunched": 0,
            "start": 45976164,
            "end": 45977866,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/baseball.lua",
            "crunched": 0,
            "start": 45977866,
            "end": 45978718,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/bloodstone.lua",
            "crunched": 0,
            "start": 45978718,
            "end": 45979825,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/castle.lua",
            "crunched": 0,
            "start": 45979825,
            "end": 45981300,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/cloud_9.lua",
            "crunched": 0,
            "start": 45981300,
            "end": 45983012,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/constellation.lua",
            "crunched": 0,
            "start": 45983012,
            "end": 45984627,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/error.lua",
            "crunched": 0,
            "start": 45984627,
            "end": 45989355,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/_ec_atlas.lua",
            "crunched": 0,
            "start": 45989355,
            "end": 45989718,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/_ec_utils.lua",
            "crunched": 0,
            "start": 45989718,
            "end": 45993050,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/alloy.lua",
            "crunched": 0,
            "start": 45993050,
            "end": 45993950,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/ambrosia.lua",
            "crunched": 0,
            "start": 45993950,
            "end": 45996178,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/bobby.lua",
            "crunched": 0,
            "start": 45996178,
            "end": 45997933,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/candynecklace.lua",
            "crunched": 0,
            "start": 45997933,
            "end": 45999740,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/chainlightning.lua",
            "crunched": 0,
            "start": 45999740,
            "end": 46001224,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/clowncar.lua",
            "crunched": 0,
            "start": 46001224,
            "end": 46002222,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/clowncollege.lua",
            "crunched": 0,
            "start": 46002222,
            "end": 46003907,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/couponsheet.lua",
            "crunched": 0,
            "start": 46003907,
            "end": 46005630,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/doublerainbow.lua",
            "crunched": 0,
            "start": 46005630,
            "end": 46006957,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/espresso.lua",
            "crunched": 0,
            "start": 46006957,
            "end": 46009517,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/farmer.lua",
            "crunched": 0,
            "start": 46009517,
            "end": 46010655,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/forklift.lua",
            "crunched": 0,
            "start": 46010655,
            "end": 46011814,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/gofish.lua",
            "crunched": 0,
            "start": 46011814,
            "end": 46013475,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/hoarder.lua",
            "crunched": 0,
            "start": 46013475,
            "end": 46014063,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/jokalisa.lua",
            "crunched": 0,
            "start": 46014063,
            "end": 46015801,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/jokeroftheyear.lua",
            "crunched": 0,
            "start": 46015801,
            "end": 46016634,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/lucky7.lua",
            "crunched": 0,
            "start": 46016634,
            "end": 46018168,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/montehaul.lua",
            "crunched": 0,
            "start": 46018168,
            "end": 46020300,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/pocketaces.lua",
            "crunched": 0,
            "start": 46020300,
            "end": 46021520,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/pyromancer.lua",
            "crunched": 0,
            "start": 46021520,
            "end": 46022480,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/shipoftheseus.lua",
            "crunched": 0,
            "start": 46022480,
            "end": 46024697,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/starfruit.lua",
            "crunched": 0,
            "start": 46024697,
            "end": 46027088,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/trafficlight.lua",
            "crunched": 0,
            "start": 46027088,
            "end": 46028860,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/tuxedo.lua",
            "crunched": 0,
            "start": 46028860,
            "end": 46030266,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/warlock.lua",
            "crunched": 0,
            "start": 46030266,
            "end": 46032741,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/extra-credit/werewolf.lua",
            "crunched": 0,
            "start": 46032741,
            "end": 46034079,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/faceless.lua",
            "crunched": 0,
            "start": 46034079,
            "end": 46035486,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/golden_ticket.lua",
            "crunched": 0,
            "start": 46035486,
            "end": 46036846,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/hit_the_road.lua",
            "crunched": 0,
            "start": 46036846,
            "end": 46038016,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/idol.lua",
            "crunched": 0,
            "start": 46038016,
            "end": 46044423,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/juggler.lua",
            "crunched": 0,
            "start": 46044423,
            "end": 46046244,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/loyalty_card.lua",
            "crunched": 0,
            "start": 46046244,
            "end": 46048439,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/lucky_cat.lua",
            "crunched": 0,
            "start": 46048439,
            "end": 46049765,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/magnet_sandbox.lua",
            "crunched": 0,
            "start": 46049765,
            "end": 46052681,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/mail.lua",
            "crunched": 0,
            "start": 46052681,
            "end": 46054240,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/misprint.lua",
            "crunched": 0,
            "start": 46054240,
            "end": 46055394,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/order.lua",
            "crunched": 0,
            "start": 46055394,
            "end": 46056753,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/photograph.lua",
            "crunched": 0,
            "start": 46056753,
            "end": 46057762,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/ride_the_bus.lua",
            "crunched": 0,
            "start": 46057762,
            "end": 46059643,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/runner.lua",
            "crunched": 0,
            "start": 46059643,
            "end": 46060727,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/satellite.lua",
            "crunched": 0,
            "start": 46060727,
            "end": 46062258,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/square.lua",
            "crunched": 0,
            "start": 46062258,
            "end": 46063382,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/steel_joker.lua",
            "crunched": 0,
            "start": 46063382,
            "end": 46064233,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/throwback.lua",
            "crunched": 0,
            "start": 46064233,
            "end": 46066545,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/sandbox/vampire.lua",
            "crunched": 0,
            "start": 46066545,
            "end": 46068737,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/skip_off.lua",
            "crunched": 0,
            "start": 46068737,
            "end": 46070608,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/speedrun.lua",
            "crunched": 0,
            "start": 46070608,
            "end": 46072332,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/bloodstone.lua",
            "crunched": 0,
            "start": 46072332,
            "end": 46074447,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/hanging_chad.lua",
            "crunched": 0,
            "start": 46074447,
            "end": 46075292,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/ice_cream.lua",
            "crunched": 0,
            "start": 46075292,
            "end": 46076412,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/seltzer.lua",
            "crunched": 0,
            "start": 46076412,
            "end": 46078629,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/ticket.lua",
            "crunched": 0,
            "start": 46078629,
            "end": 46080516,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/standard/turtle_bean.lua",
            "crunched": 0,
            "start": 46080516,
            "end": 46081820,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/jokers/taxes.lua",
            "crunched": 0,
            "start": 46081820,
            "end": 46083410,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/seals/mp_gold_seal.lua",
            "crunched": 0,
            "start": 46083410,
            "end": 46083709,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/00_planet.lua",
            "crunched": 0,
            "start": 46083709,
            "end": 46084390,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/01_spectral.lua",
            "crunched": 0,
            "start": 46084390,
            "end": 46084799,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/02_spectralplus.lua",
            "crunched": 0,
            "start": 46084799,
            "end": 46085165,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/1_plastic.lua",
            "crunched": 0,
            "start": 46085165,
            "end": 46087907,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/2_pebble.lua",
            "crunched": 0,
            "start": 46087907,
            "end": 46088341,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/3_ferrite.lua",
            "crunched": 0,
            "start": 46088341,
            "end": 46088764,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/4_pyrite.lua",
            "crunched": 0,
            "start": 46088764,
            "end": 46089754,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/5_jade.lua",
            "crunched": 0,
            "start": 46089754,
            "end": 46090182,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/6_crystal.lua",
            "crunched": 0,
            "start": 46090182,
            "end": 46090598,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/7_antimatter.lua",
            "crunched": 0,
            "start": 46090598,
            "end": 46091024,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stakes/atlas.lua",
            "crunched": 0,
            "start": 46091024,
            "end": 46091205,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/_stickers.lua",
            "crunched": 0,
            "start": 46091205,
            "end": 46093864,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/1_persistent.lua",
            "crunched": 0,
            "start": 46093864,
            "end": 46098542,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/2_unreliable.lua",
            "crunched": 0,
            "start": 46098542,
            "end": 46099024,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/3_draining.lua",
            "crunched": 0,
            "start": 46099024,
            "end": 46099397,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/balanced.lua",
            "crunched": 0,
            "start": 46099397,
            "end": 46099880,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/extra_credit.lua",
            "crunched": 0,
            "start": 46099880,
            "end": 46100094,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/stickers/nemesis.lua",
            "crunched": 0,
            "start": 46100094,
            "end": 46100367,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/tags/gambling_sandbox.lua",
            "crunched": 0,
            "start": 46100367,
            "end": 46102169,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/tags/investment_sandbox.lua",
            "crunched": 0,
            "start": 46102169,
            "end": 46103273,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/objects/tags/juggle_sandbox.lua",
            "crunched": 0,
            "start": 46103273,
            "end": 46103909,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/overrides/disable_restart.lua",
            "crunched": 0,
            "start": 46103909,
            "end": 46104079,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/overrides/game.lua",
            "crunched": 0,
            "start": 46104079,
            "end": 46110175,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/overrides/hide_content.lua",
            "crunched": 0,
            "start": 46110175,
            "end": 46112397,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/overrides/mod_badges.lua",
            "crunched": 0,
            "start": 46112397,
            "end": 46115333,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/README.md",
            "crunched": 0,
            "start": 46115333,
            "end": 46118678,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/replays/.gitkeep",
            "crunched": 0,
            "start": 46118678,
            "end": 46118678,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/_rulesets.lua",
            "crunched": 0,
            "start": 46118678,
            "end": 46130213,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/badlatro.lua",
            "crunched": 0,
            "start": 46130213,
            "end": 46131416,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/blitz.lua",
            "crunched": 0,
            "start": 46131416,
            "end": 46131483,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/chaos.lua",
            "crunched": 0,
            "start": 46131483,
            "end": 46131599,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/experimental/experimental_legacy.lua",
            "crunched": 0,
            "start": 46131599,
            "end": 46132244,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/experimental/experimental.lua",
            "crunched": 0,
            "start": 46132244,
            "end": 46132516,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/legacy_ranked.lua",
            "crunched": 0,
            "start": 46132516,
            "end": 46132644,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/majorleague.lua",
            "crunched": 0,
            "start": 46132644,
            "end": 46133504,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/minorleague.lua",
            "crunched": 0,
            "start": 46133504,
            "end": 46134117,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/ranked.lua",
            "crunched": 0,
            "start": 46134117,
            "end": 46134261,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/release.lua",
            "crunched": 0,
            "start": 46134261,
            "end": 46156042,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/sandbox.lua",
            "crunched": 0,
            "start": 46156042,
            "end": 46156315,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/smallworld.lua",
            "crunched": 0,
            "start": 46156315,
            "end": 46156401,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/speedlatro.lua",
            "crunched": 0,
            "start": 46156401,
            "end": 46156537,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/traditional.lua",
            "crunched": 0,
            "start": 46156537,
            "end": 46156769,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/vanilla.lua",
            "crunched": 0,
            "start": 46156769,
            "end": 46157128,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/rulesets/wsob.lua",
            "crunched": 0,
            "start": 46157128,
            "end": 46157900,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/scripts/release.sh",
            "crunched": 0,
            "start": 46157900,
            "end": 46163773,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/stylua.toml",
            "crunched": 0,
            "start": 46163773,
            "end": 46164126,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/readme.md",
            "crunched": 0,
            "start": 46164126,
            "end": 46167348,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/ruleset_shape.snapshot.lua",
            "crunched": 0,
            "start": 46167348,
            "end": 46185140,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/test_rlog_checksum.lua",
            "crunched": 0,
            "start": 46185140,
            "end": 46187452,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/test_rlog_roundtrip.lua",
            "crunched": 0,
            "start": 46187452,
            "end": 46192762,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/test_rlog_stream.lua",
            "crunched": 0,
            "start": 46192762,
            "end": 46196187,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/test_ruleset_shape.lua",
            "crunched": 0,
            "start": 46196187,
            "end": 46207184,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/tests/test_serialization_guard.lua",
            "crunched": 0,
            "start": 46207184,
            "end": 46210157,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/_common/background_grouping.lua",
            "crunched": 0,
            "start": 46210157,
            "end": 46210732,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/_common/disableable_button.lua",
            "crunched": 0,
            "start": 46210732,
            "end": 46211609,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/_common/disableable_option_cycle.lua",
            "crunched": 0,
            "start": 46211609,
            "end": 46211952,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/_common/disableable_toggle.lua",
            "crunched": 0,
            "start": 46211952,
            "end": 46212614,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/_common/spacer.lua",
            "crunched": 0,
            "start": 46212614,
            "end": 46212887,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/blind_chip_sprite.lua",
            "crunched": 0,
            "start": 46212887,
            "end": 46213555,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/blind_choice.lua",
            "crunched": 0,
            "start": 46213555,
            "end": 46227963,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/blind_hud.lua",
            "crunched": 0,
            "start": 46227963,
            "end": 46238454,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/confirmation.lua",
            "crunched": 0,
            "start": 46238454,
            "end": 46239374,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/enemy_location.lua",
            "crunched": 0,
            "start": 46239374,
            "end": 46246165,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/functions.lua",
            "crunched": 0,
            "start": 46246165,
            "end": 46260928,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/game_end.lua",
            "crunched": 0,
            "start": 46260928,
            "end": 46278824,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/game_state.lua",
            "crunched": 0,
            "start": 46278824,
            "end": 46298596,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/lobby_info.lua",
            "crunched": 0,
            "start": 46298596,
            "end": 46306421,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/round.lua",
            "crunched": 0,
            "start": 46306421,
            "end": 46309510,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/ruleset_info_menu.lua",
            "crunched": 0,
            "start": 46309510,
            "end": 46313708,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/game/timer.lua",
            "crunched": 0,
            "start": 46313708,
            "end": 46333641,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/_lobby_options/advanced_tab.lua",
            "crunched": 0,
            "start": 46333641,
            "end": 46338293,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/_lobby_options/gameplay_tab.lua",
            "crunched": 0,
            "start": 46338293,
            "end": 46338933,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/_lobby_options/main_options.lua",
            "crunched": 0,
            "start": 46338933,
            "end": 46342789,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/_lobby_options/modifiers_tab.lua",
            "crunched": 0,
            "start": 46342789,
            "end": 46345860,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/_lobby_options/options_tab.lua",
            "crunched": 0,
            "start": 46345860,
            "end": 46348473,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/deck_stake_button.lua",
            "crunched": 0,
            "start": 46348473,
            "end": 46349640,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/leave_button.lua",
            "crunched": 0,
            "start": 46349640,
            "end": 46349943,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/lobby_code_buttons.lua",
            "crunched": 0,
            "start": 46349943,
            "end": 46350536,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/lobby.lua",
            "crunched": 0,
            "start": 46350536,
            "end": 46367374,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/players_display.lua",
            "crunched": 0,
            "start": 46367374,
            "end": 46368654,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/start_ready_button.lua",
            "crunched": 0,
            "start": 46368654,
            "end": 46373080,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/lobby/version_mismatch_warning.lua",
            "crunched": 0,
            "start": 46373080,
            "end": 46376650,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/dev_warning.lua",
            "crunched": 0,
            "start": 46376650,
            "end": 46378890,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/main_menu.lua",
            "crunched": 0,
            "start": 46378890,
            "end": 46381575,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/_modifiers_overlay.lua",
            "crunched": 0,
            "start": 46381575,
            "end": 46383775,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/_mutators_wall.lua",
            "crunched": 0,
            "start": 46383775,
            "end": 46398933,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/_practice_options_overlay.lua",
            "crunched": 0,
            "start": 46398933,
            "end": 46401143,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/custom_ruleset_editor.lua",
            "crunched": 0,
            "start": 46401143,
            "end": 46410482,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/gamemode_selection.lua",
            "crunched": 0,
            "start": 46410482,
            "end": 46415301,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/ghost_replay_picker.lua",
            "crunched": 0,
            "start": 46415301,
            "end": 46434827,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/join_lobby_button.lua",
            "crunched": 0,
            "start": 46434827,
            "end": 46435665,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/play_button_callbacks.lua",
            "crunched": 0,
            "start": 46435665,
            "end": 46439941,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/play_button.lua",
            "crunched": 0,
            "start": 46439941,
            "end": 46441876,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/ruleset_selection.lua",
            "crunched": 0,
            "start": 46441876,
            "end": 46462350,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/play_button/weekly_interrupt.lua",
            "crunched": 0,
            "start": 46462350,
            "end": 46463322,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/title_card.lua",
            "crunched": 0,
            "start": 46463322,
            "end": 46467311,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/main_menu/version_display.lua",
            "crunched": 0,
            "start": 46467311,
            "end": 46467865,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/shortcuts_menu.lua",
            "crunched": 0,
            "start": 46467865,
            "end": 46473468,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/smods_menu/config_tab.lua",
            "crunched": 0,
            "start": 46473468,
            "end": 46477044,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/smods_menu/credits_tab.lua",
            "crunched": 0,
            "start": 46477044,
            "end": 46478515,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/smods_menu/customization_tab.lua",
            "crunched": 0,
            "start": 46478515,
            "end": 46483209,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/smods_menu/smods_menu.lua",
            "crunched": 0,
            "start": 46483209,
            "end": 46484650,
            "audio": false
        },
        {
            "filename": "/Mods/multiplayer/ui/utils.lua",
            "crunched": 0,
            "start": 46484650,
            "end": 46488004,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/👀.png",
            "crunched": 0,
            "start": 46488004,
            "end": 46489089,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/all_in.png",
            "crunched": 0,
            "start": 46489089,
            "end": 46500898,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/alphonse.png",
            "crunched": 0,
            "start": 46500898,
            "end": 46512931,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/arrowace.png",
            "crunched": 0,
            "start": 46512931,
            "end": 46513847,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/backpack.png",
            "crunched": 0,
            "start": 46513847,
            "end": 46515833,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/bad_apple.png",
            "crunched": 0,
            "start": 46515833,
            "end": 46516837,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/bea.png",
            "crunched": 0,
            "start": 46516837,
            "end": 46528353,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/bluegem.png",
            "crunched": 0,
            "start": 46528353,
            "end": 46532001,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/bro_has_the_key.png",
            "crunched": 0,
            "start": 46532001,
            "end": 46533146,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/caixinha.png",
            "crunched": 0,
            "start": 46533146,
            "end": 46538617,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/calculator.png",
            "crunched": 0,
            "start": 46538617,
            "end": 46541887,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/calculator2.png",
            "crunched": 0,
            "start": 46541887,
            "end": 46542956,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/chatgpt.png",
            "crunched": 0,
            "start": 46542956,
            "end": 46550128,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/cinder_block.png",
            "crunched": 0,
            "start": 46550128,
            "end": 46551324,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/coloring_book.png",
            "crunched": 0,
            "start": 46551324,
            "end": 46556648,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/concrete.png",
            "crunched": 0,
            "start": 46556648,
            "end": 46558421,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/crafting_table.png",
            "crunched": 0,
            "start": 46558421,
            "end": 46560768,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/crafting_voucher.png",
            "crunched": 0,
            "start": 46560768,
            "end": 46561632,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/creditcard_inbuffonpack.png",
            "crunched": 0,
            "start": 46561632,
            "end": 46564233,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/cryptid_reference.png",
            "crunched": 0,
            "start": 46564233,
            "end": 46567317,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/d100.png",
            "crunched": 0,
            "start": 46567317,
            "end": 46576449,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/diamond_tester.png",
            "crunched": 0,
            "start": 46576449,
            "end": 46577273,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/diamond.png",
            "crunched": 0,
            "start": 46577273,
            "end": 46579928,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/disco.png",
            "crunched": 0,
            "start": 46579928,
            "end": 46589342,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/dubai_chocolate.png",
            "crunched": 0,
            "start": 46589342,
            "end": 46590640,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/embed_fail_card.png",
            "crunched": 0,
            "start": 46590640,
            "end": 46591233,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/embed_fail.png",
            "crunched": 0,
            "start": 46591233,
            "end": 46592069,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/epic_games.png",
            "crunched": 0,
            "start": 46592069,
            "end": 46592804,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/error.png",
            "crunched": 0,
            "start": 46592804,
            "end": 46594228,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/fake_png.png",
            "crunched": 0,
            "start": 46594228,
            "end": 46595492,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/formula.png",
            "crunched": 0,
            "start": 46595492,
            "end": 46596662,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/fortnite.png",
            "crunched": 0,
            "start": 46596662,
            "end": 46603170,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/foto.png",
            "crunched": 0,
            "start": 46603170,
            "end": 46604383,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/foto2.png",
            "crunched": 0,
            "start": 46604383,
            "end": 46616838,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/free_wifi.png",
            "crunched": 0,
            "start": 46616838,
            "end": 46617751,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/frutiger_aero.png",
            "crunched": 0,
            "start": 46617751,
            "end": 46632362,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/fuckass_dog.png",
            "crunched": 0,
            "start": 46632362,
            "end": 46648929,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/gambling.png",
            "crunched": 0,
            "start": 46648929,
            "end": 46651057,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/gaster.png",
            "crunched": 0,
            "start": 46651057,
            "end": 46657336,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/golden_cookie.png",
            "crunched": 0,
            "start": 46657336,
            "end": 46670413,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/goodbelisk.png",
            "crunched": 0,
            "start": 46670413,
            "end": 46676495,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/gravestone.png",
            "crunched": 0,
            "start": 46676495,
            "end": 46687226,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/greg_materials.png",
            "crunched": 0,
            "start": 46687226,
            "end": 46699438,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/greg_pack.png",
            "crunched": 0,
            "start": 46699438,
            "end": 46706930,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/gregdeck.png",
            "crunched": 0,
            "start": 46706930,
            "end": 46712734,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/gregorius.png",
            "crunched": 0,
            "start": 46712734,
            "end": 46713795,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/h&s.png",
            "crunched": 0,
            "start": 46713795,
            "end": 46715603,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/HTML_pro.png",
            "crunched": 0,
            "start": 46715603,
            "end": 46716821,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/icon.png",
            "crunched": 0,
            "start": 46716821,
            "end": 46717553,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/infinity.png",
            "crunched": 0,
            "start": 46717553,
            "end": 46719583,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/job.png",
            "crunched": 0,
            "start": 46719583,
            "end": 46722147,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/jumbo_omega_pack.png",
            "crunched": 0,
            "start": 46722147,
            "end": 46725598,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/jv.png",
            "crunched": 0,
            "start": 46725598,
            "end": 46735007,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/keep_gambling.png",
            "crunched": 0,
            "start": 46735007,
            "end": 46747914,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/labubu_joker.png",
            "crunched": 0,
            "start": 46747914,
            "end": 46758841,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/le_triangle.png",
            "crunched": 0,
            "start": 46758841,
            "end": 46771001,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/local58.png",
            "crunched": 0,
            "start": 46771001,
            "end": 46780110,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/loss.png",
            "crunched": 0,
            "start": 46780110,
            "end": 46780705,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/mega_omega_pack.png",
            "crunched": 0,
            "start": 46780705,
            "end": 46784448,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/minecraft.png",
            "crunched": 0,
            "start": 46784448,
            "end": 46786138,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/mmorpg.png",
            "crunched": 0,
            "start": 46786138,
            "end": 46787348,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/moche.png",
            "crunched": 0,
            "start": 46787348,
            "end": 46801814,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/ms_paint.png",
            "crunched": 0,
            "start": 46801814,
            "end": 46806383,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/multiple_choice.png",
            "crunched": 0,
            "start": 46806383,
            "end": 46807619,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/negation.png",
            "crunched": 0,
            "start": 46807619,
            "end": 46808856,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/netherite.png",
            "crunched": 0,
            "start": 46808856,
            "end": 46809772,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/nft.png",
            "crunched": 0,
            "start": 46809772,
            "end": 46811160,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/nuke.png",
            "crunched": 0,
            "start": 46811160,
            "end": 46816197,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/obsidian.png",
            "crunched": 0,
            "start": 46816197,
            "end": 46824040,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_deck.png",
            "crunched": 0,
            "start": 46824040,
            "end": 46826153,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_joker.png",
            "crunched": 0,
            "start": 46826153,
            "end": 46831962,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_pack.png",
            "crunched": 0,
            "start": 46831962,
            "end": 46834972,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_suit.png",
            "crunched": 0,
            "start": 46834972,
            "end": 46853222,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_ui.png",
            "crunched": 0,
            "start": 46853222,
            "end": 46853741,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/omega_voucher.png",
            "crunched": 0,
            "start": 46853741,
            "end": 46855200,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/optimally_packed.png",
            "crunched": 0,
            "start": 46855200,
            "end": 46856141,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/os_maias.png",
            "crunched": 0,
            "start": 46856141,
            "end": 46857605,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/pass.png",
            "crunched": 0,
            "start": 46857605,
            "end": 46858372,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/pegi18.png",
            "crunched": 0,
            "start": 46858372,
            "end": 46859065,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/petrification_device.png",
            "crunched": 0,
            "start": 46859065,
            "end": 46865827,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/phone.png",
            "crunched": 0,
            "start": 46865827,
            "end": 46913679,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/photograph_fixed.png",
            "crunched": 0,
            "start": 46913679,
            "end": 46922547,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/pi.png",
            "crunched": 0,
            "start": 46922547,
            "end": 46928085,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/prophecy.png",
            "crunched": 0,
            "start": 46928085,
            "end": 46938975,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/rabbit_clock.png",
            "crunched": 0,
            "start": 46938975,
            "end": 46940365,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/rainbow.png",
            "crunched": 0,
            "start": 46940365,
            "end": 46941516,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/reboot_card.png",
            "crunched": 0,
            "start": 46941516,
            "end": 46945670,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/redacted.png",
            "crunched": 0,
            "start": 46945670,
            "end": 46946576,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/reinforced.png",
            "crunched": 0,
            "start": 46946576,
            "end": 46947565,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/rigged.png",
            "crunched": 0,
            "start": 46947565,
            "end": 46955370,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/rixy.png",
            "crunched": 0,
            "start": 46955370,
            "end": 46966356,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/rtl.png",
            "crunched": 0,
            "start": 46966356,
            "end": 46967596,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/scaling.png",
            "crunched": 0,
            "start": 46967596,
            "end": 46968907,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/sigil_joker.png",
            "crunched": 0,
            "start": 46968907,
            "end": 46969856,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/sigil.png",
            "crunched": 0,
            "start": 46969856,
            "end": 46970741,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/simp.png",
            "crunched": 0,
            "start": 46970741,
            "end": 46976357,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/slothful.png",
            "crunched": 0,
            "start": 46976357,
            "end": 46980864,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/squared.png",
            "crunched": 0,
            "start": 46980864,
            "end": 46986794,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/star_sticker.png",
            "crunched": 0,
            "start": 46986794,
            "end": 46987356,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/swapping.png",
            "crunched": 0,
            "start": 46987356,
            "end": 46990462,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/template thunder.png",
            "crunched": 0,
            "start": 46990462,
            "end": 46991943,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/thatcher.png",
            "crunched": 0,
            "start": 46991943,
            "end": 46993127,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/the_gathering.png",
            "crunched": 0,
            "start": 46993127,
            "end": 46994647,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/the_solo.png",
            "crunched": 0,
            "start": 46994647,
            "end": 46996136,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/the_squad.png",
            "crunched": 0,
            "start": 46996136,
            "end": 46997641,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/the_twins.png",
            "crunched": 0,
            "start": 46997641,
            "end": 46999165,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/titlescreen.png",
            "crunched": 0,
            "start": 46999165,
            "end": 47000850,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/toilet_paper.png",
            "crunched": 0,
            "start": 47000850,
            "end": 47006525,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/tycoon.png",
            "crunched": 0,
            "start": 47006525,
            "end": 47007566,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/unope_pack.png",
            "crunched": 0,
            "start": 47007566,
            "end": 47009269,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/upgrade.png",
            "crunched": 0,
            "start": 47009269,
            "end": 47010571,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/upgraded_deck.png",
            "crunched": 0,
            "start": 47010571,
            "end": 47012827,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/verity_mad.png",
            "crunched": 0,
            "start": 47012827,
            "end": 47016334,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/verity.png",
            "crunched": 0,
            "start": 47016334,
            "end": 47019828,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/waffle.png",
            "crunched": 0,
            "start": 47019828,
            "end": 47033410,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/webdriver.png",
            "crunched": 0,
            "start": 47033410,
            "end": 47034023,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/wild.png",
            "crunched": 0,
            "start": 47034023,
            "end": 47040717,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/wind.png",
            "crunched": 0,
            "start": 47040717,
            "end": 47049616,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/windtrackball.png",
            "crunched": 0,
            "start": 47049616,
            "end": 47050569,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/wordle.png",
            "crunched": 0,
            "start": 47050569,
            "end": 47051609,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/1x/yeah.png",
            "crunched": 0,
            "start": 47051609,
            "end": 47055460,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/👀.png",
            "crunched": 0,
            "start": 47055460,
            "end": 47056917,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/all_in.png",
            "crunched": 0,
            "start": 47056917,
            "end": 47071513,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/alphonse.png",
            "crunched": 0,
            "start": 47071513,
            "end": 47087011,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/arrowace.png",
            "crunched": 0,
            "start": 47087011,
            "end": 47088136,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/backpack.png",
            "crunched": 0,
            "start": 47088136,
            "end": 47091914,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/bea.png",
            "crunched": 0,
            "start": 47091914,
            "end": 47106860,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/bluegem.png",
            "crunched": 0,
            "start": 47106860,
            "end": 47113532,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/bro_has_the_key.png",
            "crunched": 0,
            "start": 47113532,
            "end": 47114927,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/caixinha.png",
            "crunched": 0,
            "start": 47114927,
            "end": 47122337,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/calculator.png",
            "crunched": 0,
            "start": 47122337,
            "end": 47126303,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/calculator2.png",
            "crunched": 0,
            "start": 47126303,
            "end": 47127754,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/chatgpt.png",
            "crunched": 0,
            "start": 47127754,
            "end": 47137403,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/cinder_block.png",
            "crunched": 0,
            "start": 47137403,
            "end": 47138889,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/coloring_book.png",
            "crunched": 0,
            "start": 47138889,
            "end": 47145782,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/concrete.png",
            "crunched": 0,
            "start": 47145782,
            "end": 47148164,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/crafting_table.png",
            "crunched": 0,
            "start": 47148164,
            "end": 47152740,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/crafting_voucher.png",
            "crunched": 0,
            "start": 47152740,
            "end": 47153853,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/creditcard_inbuffonpack.png",
            "crunched": 0,
            "start": 47153853,
            "end": 47157002,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/cryptid_reference.png",
            "crunched": 0,
            "start": 47157002,
            "end": 47172124,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/d100.png",
            "crunched": 0,
            "start": 47172124,
            "end": 47201144,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/diamond.png",
            "crunched": 0,
            "start": 47201144,
            "end": 47204970,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/disco.png",
            "crunched": 0,
            "start": 47204970,
            "end": 47237535,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/dubai_chocolate.png",
            "crunched": 0,
            "start": 47237535,
            "end": 47239199,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/embed_fail_card.png",
            "crunched": 0,
            "start": 47239199,
            "end": 47239937,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/embed_fail.png",
            "crunched": 0,
            "start": 47239937,
            "end": 47240990,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/epic_games.png",
            "crunched": 0,
            "start": 47240990,
            "end": 47242048,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/error.png",
            "crunched": 0,
            "start": 47242048,
            "end": 47245088,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/formula.png",
            "crunched": 0,
            "start": 47245088,
            "end": 47246513,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/fortnite.png",
            "crunched": 0,
            "start": 47246513,
            "end": 47255140,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/foto.png",
            "crunched": 0,
            "start": 47255140,
            "end": 47256606,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/foto2.png",
            "crunched": 0,
            "start": 47256606,
            "end": 47273753,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/free_wifi.png",
            "crunched": 0,
            "start": 47273753,
            "end": 47274896,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/frutiger_aero.png",
            "crunched": 0,
            "start": 47274896,
            "end": 47294214,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/fuckass_dog.png",
            "crunched": 0,
            "start": 47294214,
            "end": 47351059,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/gambling.png",
            "crunched": 0,
            "start": 47351059,
            "end": 47353528,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/gaster.png",
            "crunched": 0,
            "start": 47353528,
            "end": 47362192,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/golden_cookie.png",
            "crunched": 0,
            "start": 47362192,
            "end": 47380761,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/goodbelisk.png",
            "crunched": 0,
            "start": 47380761,
            "end": 47388863,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/gravestone.png",
            "crunched": 0,
            "start": 47388863,
            "end": 47406947,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/greg_materials.png",
            "crunched": 0,
            "start": 47406947,
            "end": 47425992,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/greg_pack.png",
            "crunched": 0,
            "start": 47425992,
            "end": 47436438,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/gregdeck.png",
            "crunched": 0,
            "start": 47436438,
            "end": 47444768,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/gregorius.png",
            "crunched": 0,
            "start": 47444768,
            "end": 47446119,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/h&s.png",
            "crunched": 0,
            "start": 47446119,
            "end": 47448745,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/HTML_pro.png",
            "crunched": 0,
            "start": 47448745,
            "end": 47450426,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/icon.png",
            "crunched": 0,
            "start": 47450426,
            "end": 47451223,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/infinity.png",
            "crunched": 0,
            "start": 47451223,
            "end": 47453702,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/job.png",
            "crunched": 0,
            "start": 47453702,
            "end": 47456909,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/jumbo_omega_pack.png",
            "crunched": 0,
            "start": 47456909,
            "end": 47461618,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/jv.png",
            "crunched": 0,
            "start": 47461618,
            "end": 47474416,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/keep_gambling.png",
            "crunched": 0,
            "start": 47474416,
            "end": 47517223,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/labubu_joker.png",
            "crunched": 0,
            "start": 47517223,
            "end": 47553216,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/le_triangle.png",
            "crunched": 0,
            "start": 47553216,
            "end": 47570529,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/local58.png",
            "crunched": 0,
            "start": 47570529,
            "end": 47583208,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/loss.png",
            "crunched": 0,
            "start": 47583208,
            "end": 47583981,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/mega_omega_pack.png",
            "crunched": 0,
            "start": 47583981,
            "end": 47589206,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/minecraft.png",
            "crunched": 0,
            "start": 47589206,
            "end": 47591482,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/mmorpg.png",
            "crunched": 0,
            "start": 47591482,
            "end": 47593099,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/moche.png",
            "crunched": 0,
            "start": 47593099,
            "end": 47644112,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/ms_paint.png",
            "crunched": 0,
            "start": 47644112,
            "end": 47649955,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/multiple_choice.png",
            "crunched": 0,
            "start": 47649955,
            "end": 47651585,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/negation.png",
            "crunched": 0,
            "start": 47651585,
            "end": 47653176,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/nft.png",
            "crunched": 0,
            "start": 47653176,
            "end": 47654885,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/nuke.png",
            "crunched": 0,
            "start": 47654885,
            "end": 47661740,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/obsidian.png",
            "crunched": 0,
            "start": 47661740,
            "end": 47668742,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_deck.png",
            "crunched": 0,
            "start": 47668742,
            "end": 47671167,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_joker.png",
            "crunched": 0,
            "start": 47671167,
            "end": 47678674,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_pack.png",
            "crunched": 0,
            "start": 47678674,
            "end": 47682501,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_suit.png",
            "crunched": 0,
            "start": 47682501,
            "end": 47707272,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_ui.png",
            "crunched": 0,
            "start": 47707272,
            "end": 47707830,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/omega_voucher.png",
            "crunched": 0,
            "start": 47707830,
            "end": 47709701,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/optimally_packed.png",
            "crunched": 0,
            "start": 47709701,
            "end": 47710886,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/os_maias.png",
            "crunched": 0,
            "start": 47710886,
            "end": 47712724,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/pass.png",
            "crunched": 0,
            "start": 47712724,
            "end": 47713685,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/pegi18.png",
            "crunched": 0,
            "start": 47713685,
            "end": 47714607,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/petrification_device.png",
            "crunched": 0,
            "start": 47714607,
            "end": 47723237,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/phone.png",
            "crunched": 0,
            "start": 47723237,
            "end": 47789268,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/photograph_fixed.png",
            "crunched": 0,
            "start": 47789268,
            "end": 47800591,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/pi.png",
            "crunched": 0,
            "start": 47800591,
            "end": 47808576,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/prophecy.png",
            "crunched": 0,
            "start": 47808576,
            "end": 47821654,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/rabbit_clock.png",
            "crunched": 0,
            "start": 47821654,
            "end": 47823413,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/rainbow.png",
            "crunched": 0,
            "start": 47823413,
            "end": 47824786,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/reboot_card.png",
            "crunched": 0,
            "start": 47824786,
            "end": 47829768,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/redacted.png",
            "crunched": 0,
            "start": 47829768,
            "end": 47830903,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/reinforced.png",
            "crunched": 0,
            "start": 47830903,
            "end": 47832564,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/rigged.png",
            "crunched": 0,
            "start": 47832564,
            "end": 47843823,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/rixy.png",
            "crunched": 0,
            "start": 47843823,
            "end": 47858513,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/rtl.png",
            "crunched": 0,
            "start": 47858513,
            "end": 47860030,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/scaling.png",
            "crunched": 0,
            "start": 47860030,
            "end": 47861742,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/sigil_joker.png",
            "crunched": 0,
            "start": 47861742,
            "end": 47875737,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/sigil.png",
            "crunched": 0,
            "start": 47875737,
            "end": 47886508,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/simp.png",
            "crunched": 0,
            "start": 47886508,
            "end": 47894442,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/slothful.png",
            "crunched": 0,
            "start": 47894442,
            "end": 47900317,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/squared.png",
            "crunched": 0,
            "start": 47900317,
            "end": 47908792,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/star_sticker.png",
            "crunched": 0,
            "start": 47908792,
            "end": 47909528,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/swapping.png",
            "crunched": 0,
            "start": 47909528,
            "end": 47913935,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/thatcher.png",
            "crunched": 0,
            "start": 47913935,
            "end": 47915390,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/the_gathering.png",
            "crunched": 0,
            "start": 47915390,
            "end": 47917291,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/the_solo.png",
            "crunched": 0,
            "start": 47917291,
            "end": 47919168,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/the_squad.png",
            "crunched": 0,
            "start": 47919168,
            "end": 47921065,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/the_twins.png",
            "crunched": 0,
            "start": 47921065,
            "end": 47922964,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/titlescreen.png",
            "crunched": 0,
            "start": 47922964,
            "end": 47925032,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/toilet_paper.png",
            "crunched": 0,
            "start": 47925032,
            "end": 47942136,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/tycoon.png",
            "crunched": 0,
            "start": 47942136,
            "end": 47943426,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/unope_pack.png",
            "crunched": 0,
            "start": 47943426,
            "end": 47945524,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/upgrade.png",
            "crunched": 0,
            "start": 47945524,
            "end": 47947410,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/upgraded_deck.png",
            "crunched": 0,
            "start": 47947410,
            "end": 47949993,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/verity_mad.png",
            "crunched": 0,
            "start": 47949993,
            "end": 47953858,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/verity.png",
            "crunched": 0,
            "start": 47953858,
            "end": 47957717,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/waffle.png",
            "crunched": 0,
            "start": 47957717,
            "end": 48001075,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/webdriver.png",
            "crunched": 0,
            "start": 48001075,
            "end": 48001860,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/wild.png",
            "crunched": 0,
            "start": 48001860,
            "end": 48011499,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/wind.png",
            "crunched": 0,
            "start": 48011499,
            "end": 48037344,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/windtrackball.png",
            "crunched": 0,
            "start": 48037344,
            "end": 48038507,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/2x/wordle.png",
            "crunched": 0,
            "start": 48038507,
            "end": 48039899,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Birthlong.ttf",
            "crunched": 0,
            "start": 48039899,
            "end": 48074187,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Comic Sans.ttf",
            "crunched": 0,
            "start": 48074187,
            "end": 48319787,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/LuckiestGuy.ttf",
            "crunched": 0,
            "start": 48319787,
            "end": 48378111,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/PUSAB.ttf",
            "crunched": 0,
            "start": 48378111,
            "end": 48435107,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Renogare.ttf",
            "crunched": 0,
            "start": 48435107,
            "end": 48575179,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Satisfontory.ttf",
            "crunched": 0,
            "start": 48575179,
            "end": 48581367,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Symbola.ttf",
            "crunched": 0,
            "start": 48581367,
            "end": 50821467,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/times.ttf",
            "crunched": 0,
            "start": 50821467,
            "end": 51169455,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/fonts/Wingdings.ttf",
            "crunched": 0,
            "start": 51169455,
            "end": 51237547,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/sounds/d100.ogg",
            "crunched": 0,
            "start": 51237547,
            "end": 51253205,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/sounds/holdup.ogg",
            "crunched": 0,
            "start": 51253205,
            "end": 51282637,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/sounds/music_labubu.ogg",
            "crunched": 0,
            "start": 51282637,
            "end": 52399128,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/assets/sounds/ok.ogg",
            "crunched": 0,
            "start": 52399128,
            "end": 52420147,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/crashes.txt",
            "crunched": 0,
            "start": 52420147,
            "end": 52420150,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/boosters.lua",
            "crunched": 0,
            "start": 52420150,
            "end": 52426263,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/consumables.lua",
            "crunched": 0,
            "start": 52426263,
            "end": 52443201,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/decks.lua",
            "crunched": 0,
            "start": 52443201,
            "end": 52445371,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/enchancers.lua",
            "crunched": 0,
            "start": 52445371,
            "end": 52456476,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/jokers.lua",
            "crunched": 0,
            "start": 52456476,
            "end": 52564807,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/menu.lua",
            "crunched": 0,
            "start": 52564807,
            "end": 52567423,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/suit_and_rarity.lua",
            "crunched": 0,
            "start": 52567423,
            "end": 52568354,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/items/vouchers.lua",
            "crunched": 0,
            "start": 52568354,
            "end": 52569443,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/main.lua",
            "crunched": 0,
            "start": 52569443,
            "end": 52574757,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/mod.json",
            "crunched": 0,
            "start": 52574757,
            "end": 52575176,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/rtl_posts.txt",
            "crunched": 0,
            "start": 52575176,
            "end": 52575180,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/sounds/gold_click.ogg",
            "crunched": 0,
            "start": 52575180,
            "end": 52587017,
            "audio": false
        },
        {
            "filename": "/Mods/OMEGATRO/sounds/ok.ogg",
            "crunched": 0,
            "start": 52587017,
            "end": 52608036,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitattributes",
            "crunched": 0,
            "start": 52608036,
            "end": 52608054,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/.gitignore",
            "crunched": 0,
            "start": 52608054,
            "end": 52611957,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/default_achievements.png",
            "crunched": 0,
            "start": 52611957,
            "end": 52614893,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/dropdown_arrow.png",
            "crunched": 0,
            "start": 52614893,
            "end": 52615647,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/1x/mod_tags.png",
            "crunched": 0,
            "start": 52615647,
            "end": 52618681,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/default_achievements.png",
            "crunched": 0,
            "start": 52618681,
            "end": 52622445,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/dropdown_arrow.png",
            "crunched": 0,
            "start": 52622445,
            "end": 52624023,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/2x/mod_tags.png",
            "crunched": 0,
            "start": 52624023,
            "end": 52627951,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/cat.png",
            "crunched": 0,
            "start": 52627951,
            "end": 52646888,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xblindsize.ogg",
            "crunched": 0,
            "start": 52646888,
            "end": 52660249,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xchips.ogg",
            "crunched": 0,
            "start": 52660249,
            "end": 52685275,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/assets/sounds/xscore.ogg",
            "crunched": 0,
            "start": 52685275,
            "end": 52732752,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/config.lua",
            "crunched": 0,
            "start": 52732752,
            "end": 52732940,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/icon.png",
            "crunched": 0,
            "start": 52732940,
            "end": 52765421,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/luajit-curl.lua",
            "crunched": 0,
            "start": 52765421,
            "end": 52794160,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/https/smods-https.lua",
            "crunched": 0,
            "start": 52794160,
            "end": 52802638,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/init.lua",
            "crunched": 0,
            "start": 52802638,
            "end": 52802670,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/json/json.lua",
            "crunched": 0,
            "start": 52802670,
            "end": 52812307,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/icon.png",
            "crunched": 0,
            "start": 52812307,
            "end": 52954103,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/init.lua",
            "crunched": 0,
            "start": 52954103,
            "end": 52954140,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/LICENSE",
            "crunched": 0,
            "start": 52954140,
            "end": 52955195,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/manifest.json",
            "crunched": 0,
            "start": 52955195,
            "end": 52955486,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/nativefs.lua",
            "crunched": 0,
            "start": 52955486,
            "end": 52973700,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/libs/nativefs/README.md",
            "crunched": 0,
            "start": 52973700,
            "end": 52979088,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/LICENSE",
            "crunched": 0,
            "start": 52979088,
            "end": 53014237,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/de.lua",
            "crunched": 0,
            "start": 53014237,
            "end": 53028201,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/en-us.lua",
            "crunched": 0,
            "start": 53028201,
            "end": 53040727,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_419.lua",
            "crunched": 0,
            "start": 53040727,
            "end": 53053991,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/es_ES.lua",
            "crunched": 0,
            "start": 53053991,
            "end": 53067254,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/fr.lua",
            "crunched": 0,
            "start": 53067254,
            "end": 53075284,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/id.lua",
            "crunched": 0,
            "start": 53075284,
            "end": 53076302,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/it.lua",
            "crunched": 0,
            "start": 53076302,
            "end": 53082729,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ja.lua",
            "crunched": 0,
            "start": 53082729,
            "end": 53083827,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ko.lua",
            "crunched": 0,
            "start": 53083827,
            "end": 53091276,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/nl.lua",
            "crunched": 0,
            "start": 53091276,
            "end": 53092308,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pl.lua",
            "crunched": 0,
            "start": 53092308,
            "end": 53093337,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/pt_BR.lua",
            "crunched": 0,
            "start": 53093337,
            "end": 53098692,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/ru.lua",
            "crunched": 0,
            "start": 53098692,
            "end": 53108071,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_CN.lua",
            "crunched": 0,
            "start": 53108071,
            "end": 53117438,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/localization/zh_TW.lua",
            "crunched": 0,
            "start": 53117438,
            "end": 53118446,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/achievements.toml",
            "crunched": 0,
            "start": 53118446,
            "end": 53121991,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/atlas.toml",
            "crunched": 0,
            "start": 53121991,
            "end": 53123126,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/back.toml",
            "crunched": 0,
            "start": 53123126,
            "end": 53128710,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/better_calc_fixes.toml",
            "crunched": 0,
            "start": 53128710,
            "end": 53129710,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/better_calc.toml",
            "crunched": 0,
            "start": 53129710,
            "end": 53200053,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind_score_mod.toml",
            "crunched": 0,
            "start": 53200053,
            "end": 53201453,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind_ui.toml",
            "crunched": 0,
            "start": 53201453,
            "end": 53208144,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/blind.toml",
            "crunched": 0,
            "start": 53208144,
            "end": 53227224,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/booster.toml",
            "crunched": 0,
            "start": 53227224,
            "end": 53240429,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/calc_returns.toml",
            "crunched": 0,
            "start": 53240429,
            "end": 53241588,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/calculate_card_added.toml",
            "crunched": 0,
            "start": 53241588,
            "end": 53242342,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/can_calculate.toml",
            "crunched": 0,
            "start": 53242342,
            "end": 53243767,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/card_limit.toml",
            "crunched": 0,
            "start": 53243767,
            "end": 53255210,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/cardarea.toml",
            "crunched": 0,
            "start": 53255210,
            "end": 53256401,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/cardareas.toml",
            "crunched": 0,
            "start": 53256401,
            "end": 53257610,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/center.toml",
            "crunched": 0,
            "start": 53257610,
            "end": 53280544,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/challenge.toml",
            "crunched": 0,
            "start": 53280544,
            "end": 53284669,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/compact_cashout.toml",
            "crunched": 0,
            "start": 53284669,
            "end": 53286263,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/compat_0_9_8.toml",
            "crunched": 0,
            "start": 53286263,
            "end": 53287316,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/core.toml",
            "crunched": 0,
            "start": 53287316,
            "end": 53287807,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/crash_handler.toml",
            "crunched": 0,
            "start": 53287807,
            "end": 53288398,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/create_sprite.toml",
            "crunched": 0,
            "start": 53288398,
            "end": 53291551,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/deck_skins.toml",
            "crunched": 0,
            "start": 53291551,
            "end": 53294296,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/dollar_row.toml",
            "crunched": 0,
            "start": 53294296,
            "end": 53297192,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/dynatext_conditionals.toml",
            "crunched": 0,
            "start": 53297192,
            "end": 53299318,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/easings.toml",
            "crunched": 0,
            "start": 53299318,
            "end": 53301419,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/edition.toml",
            "crunched": 0,
            "start": 53301419,
            "end": 53308841,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/enhancement.toml",
            "crunched": 0,
            "start": 53308841,
            "end": 53319101,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/event.toml",
            "crunched": 0,
            "start": 53319101,
            "end": 53320453,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/fixes.toml",
            "crunched": 0,
            "start": 53320453,
            "end": 53347944,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/gradient.toml",
            "crunched": 0,
            "start": 53347944,
            "end": 53349393,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/hand_limit.toml",
            "crunched": 0,
            "start": 53349393,
            "end": 53352209,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/jimboquip.toml",
            "crunched": 0,
            "start": 53352209,
            "end": 53357927,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/joker_retriggers.toml",
            "crunched": 0,
            "start": 53357927,
            "end": 53364923,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/joker_size.toml",
            "crunched": 0,
            "start": 53364923,
            "end": 53367330,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/keybind.toml",
            "crunched": 0,
            "start": 53367330,
            "end": 53369521,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/language.toml",
            "crunched": 0,
            "start": 53369521,
            "end": 53371518,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/libs.toml",
            "crunched": 0,
            "start": 53371518,
            "end": 53372125,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/listed_probabilities.toml",
            "crunched": 0,
            "start": 53372125,
            "end": 53378424,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/loader.toml",
            "crunched": 0,
            "start": 53378424,
            "end": 53378942,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/menu.toml",
            "crunched": 0,
            "start": 53378942,
            "end": 53381121,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/mobile_patches.toml",
            "crunched": 0,
            "start": 53381121,
            "end": 53383523,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/mod.toml",
            "crunched": 0,
            "start": 53383523,
            "end": 53385278,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/multi_box_descriptions.toml",
            "crunched": 0,
            "start": 53385278,
            "end": 53391005,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/number_formatting.toml",
            "crunched": 0,
            "start": 53391005,
            "end": 53395746,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/override_notice.toml",
            "crunched": 0,
            "start": 53395746,
            "end": 53403682,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/perma_bonus.toml",
            "crunched": 0,
            "start": 53403682,
            "end": 53416842,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/playing_card.toml",
            "crunched": 0,
            "start": 53416842,
            "end": 53428147,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand_screen.toml",
            "crunched": 0,
            "start": 53428147,
            "end": 53430248,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand_text.toml",
            "crunched": 0,
            "start": 53430248,
            "end": 53431510,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/poker_hand.toml",
            "crunched": 0,
            "start": 53431510,
            "end": 53434839,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/pool.toml",
            "crunched": 0,
            "start": 53434839,
            "end": 53440970,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/preflight.toml",
            "crunched": 0,
            "start": 53440970,
            "end": 53442196,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/rarity.toml",
            "crunched": 0,
            "start": 53442196,
            "end": 53444543,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/scaling.toml",
            "crunched": 0,
            "start": 53444543,
            "end": 53461271,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/score_mod.toml",
            "crunched": 0,
            "start": 53461271,
            "end": 53462774,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/scoring_calculation.toml",
            "crunched": 0,
            "start": 53462774,
            "end": 53474090,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/screenshader_rendering.toml",
            "crunched": 0,
            "start": 53474090,
            "end": 53476409,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/seal.toml",
            "crunched": 0,
            "start": 53476409,
            "end": 53483224,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/shaders.toml",
            "crunched": 0,
            "start": 53483224,
            "end": 53484143,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/shop.toml",
            "crunched": 0,
            "start": 53484143,
            "end": 53491472,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/sound.toml",
            "crunched": 0,
            "start": 53491472,
            "end": 53496632,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/stake.toml",
            "crunched": 0,
            "start": 53496632,
            "end": 53506838,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/sticker.toml",
            "crunched": 0,
            "start": 53506838,
            "end": 53510793,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/tag.toml",
            "crunched": 0,
            "start": 53510793,
            "end": 53515885,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/text_effect.toml",
            "crunched": 0,
            "start": 53515885,
            "end": 53521734,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/threads.toml",
            "crunched": 0,
            "start": 53521734,
            "end": 53522416,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_additional_text_props.toml",
            "crunched": 0,
            "start": 53522416,
            "end": 53532807,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_elements.toml",
            "crunched": 0,
            "start": 53532807,
            "end": 53545062,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui_overflow.toml",
            "crunched": 0,
            "start": 53545062,
            "end": 53547616,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/ui.toml",
            "crunched": 0,
            "start": 53547616,
            "end": 53564477,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/lovely/weights.toml",
            "crunched": 0,
            "start": 53564477,
            "end": 53567203,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/manifest.json",
            "crunched": 0,
            "start": 53567203,
            "end": 53567436,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/README.md",
            "crunched": 0,
            "start": 53567436,
            "end": 53569238,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/release.lua",
            "crunched": 0,
            "start": 53569238,
            "end": 53569275,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/card_draw.lua",
            "crunched": 0,
            "start": 53569275,
            "end": 53594042,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/compat_0_9_8.lua",
            "crunched": 0,
            "start": 53594042,
            "end": 53612112,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/core.lua",
            "crunched": 0,
            "start": 53612112,
            "end": 53613981,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/crash_handler.lua",
            "crunched": 0,
            "start": 53613981,
            "end": 53651242,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_object.lua",
            "crunched": 0,
            "start": 53651242,
            "end": 53822623,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/game_objects/attributes.lua",
            "crunched": 0,
            "start": 53822623,
            "end": 53835036,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/index.lua",
            "crunched": 0,
            "start": 53835036,
            "end": 53836449,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/overrides.lua",
            "crunched": 0,
            "start": 53836449,
            "end": 53949465,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/core.lua",
            "crunched": 0,
            "start": 53949465,
            "end": 53955049,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/loader.lua",
            "crunched": 0,
            "start": 53955049,
            "end": 53994657,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/logging.lua",
            "crunched": 0,
            "start": 53994657,
            "end": 53996569,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/main.lua",
            "crunched": 0,
            "start": 53996569,
            "end": 53999364,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 53999364,
            "end": 54005290,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 54005290,
            "end": 54008588,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/ui.lua",
            "crunched": 0,
            "start": 54008588,
            "end": 54140881,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils.lua",
            "crunched": 0,
            "start": 54140881,
            "end": 54312918,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/src/utils/weights.lua",
            "crunched": 0,
            "start": 54312918,
            "end": 54332048,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/tk_debug_window.py",
            "crunched": 0,
            "start": 54332048,
            "end": 54357877,
            "audio": false
        },
        {
            "filename": "/Mods/Steamodded/version.lua",
            "crunched": 0,
            "start": 54357877,
            "end": 54357914,
            "audio": false
        },
        {
            "filename": "/nativefs.lua",
            "crunched": 0,
            "start": 54357914,
            "end": 54361136,
            "audio": false
        },
        {
            "filename": "/resources/fonts/GoNotoCJKCore.ttf",
            "crunched": 0,
            "start": 54361136,
            "end": 72861108,
            "audio": false
        },
        {
            "filename": "/resources/fonts/GoNotoCurrent-Bold.ttf",
            "crunched": 0,
            "start": 72861108,
            "end": 87395152,
            "audio": false
        },
        {
            "filename": "/resources/fonts/m6x11plus.ttf",
            "crunched": 0,
            "start": 87395152,
            "end": 87430217,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSans-Bold.ttf",
            "crunched": 0,
            "start": 87430217,
            "end": 88012821,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansJP-Bold.ttf",
            "crunched": 0,
            "start": 88012821,
            "end": 93740649,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansKR-Bold.ttf",
            "crunched": 0,
            "start": 93740649,
            "end": 99931473,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansSC-Bold.ttf",
            "crunched": 0,
            "start": 99931473,
            "end": 110481589,
            "audio": false
        },
        {
            "filename": "/resources/fonts/NotoSansTC-Bold.ttf",
            "crunched": 0,
            "start": 110481589,
            "end": 117586901,
            "audio": false
        },
        {
            "filename": "/resources/gamecontrollerdb.txt",
            "crunched": 0,
            "start": 117586901,
            "end": 117984725,
            "audio": false
        },
        {
            "filename": "/resources/shaders/background.fs",
            "crunched": 0,
            "start": 117984725,
            "end": 117987245,
            "audio": false
        },
        {
            "filename": "/resources/shaders/booster.fs",
            "crunched": 0,
            "start": 117987245,
            "end": 117992568,
            "audio": false
        },
        {
            "filename": "/resources/shaders/CRT.fs",
            "crunched": 0,
            "start": 117992568,
            "end": 117999838,
            "audio": false
        },
        {
            "filename": "/resources/shaders/debuff.fs",
            "crunched": 0,
            "start": 117999838,
            "end": 118005002,
            "audio": false
        },
        {
            "filename": "/resources/shaders/dissolve.fs",
            "crunched": 0,
            "start": 118005002,
            "end": 118009271,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flame.fs",
            "crunched": 0,
            "start": 118009271,
            "end": 118012120,
            "audio": false
        },
        {
            "filename": "/resources/shaders/flash.fs",
            "crunched": 0,
            "start": 118012120,
            "end": 118013021,
            "audio": false
        },
        {
            "filename": "/resources/shaders/foil.fs",
            "crunched": 0,
            "start": 118013021,
            "end": 118018956,
            "audio": false
        },
        {
            "filename": "/resources/shaders/gold_seal.fs",
            "crunched": 0,
            "start": 118018956,
            "end": 118019757,
            "audio": false
        },
        {
            "filename": "/resources/shaders/holo.fs",
            "crunched": 0,
            "start": 118019757,
            "end": 118025764,
            "audio": false
        },
        {
            "filename": "/resources/shaders/hologram.fs",
            "crunched": 0,
            "start": 118025764,
            "end": 118031520,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative_shine.fs",
            "crunched": 0,
            "start": 118031520,
            "end": 118036430,
            "audio": false
        },
        {
            "filename": "/resources/shaders/negative.fs",
            "crunched": 0,
            "start": 118036430,
            "end": 118041324,
            "audio": false
        },
        {
            "filename": "/resources/shaders/played.fs",
            "crunched": 0,
            "start": 118041324,
            "end": 118046114,
            "audio": false
        },
        {
            "filename": "/resources/shaders/polychrome.fs",
            "crunched": 0,
            "start": 118046114,
            "end": 118051940,
            "audio": false
        },
        {
            "filename": "/resources/shaders/skew.fs",
            "crunched": 0,
            "start": 118051940,
            "end": 118052611,
            "audio": false
        },
        {
            "filename": "/resources/shaders/splash.fs",
            "crunched": 0,
            "start": 118052611,
            "end": 118055218,
            "audio": false
        },
        {
            "filename": "/resources/shaders/vortex.fs",
            "crunched": 0,
            "start": 118055218,
            "end": 118056029,
            "audio": false
        },
        {
            "filename": "/resources/shaders/voucher.fs",
            "crunched": 0,
            "start": 118056029,
            "end": 118060858,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire1.ogg",
            "crunched": 0,
            "start": 118060858,
            "end": 118539189,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire2.ogg",
            "crunched": 0,
            "start": 118539189,
            "end": 119047686,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientFire3.ogg",
            "crunched": 0,
            "start": 119047686,
            "end": 119551243,
            "audio": false
        },
        {
            "filename": "/resources/sounds/ambientOrgan1.ogg",
            "crunched": 0,
            "start": 119551243,
            "end": 119932196,
            "audio": false
        },
        {
            "filename": "/resources/sounds/button.ogg",
            "crunched": 0,
            "start": 119932196,
            "end": 119940329,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cancel.ogg",
            "crunched": 0,
            "start": 119940329,
            "end": 119950409,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card1.ogg",
            "crunched": 0,
            "start": 119950409,
            "end": 119964347,
            "audio": false
        },
        {
            "filename": "/resources/sounds/card3.ogg",
            "crunched": 0,
            "start": 119964347,
            "end": 119976219,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardFan2.ogg",
            "crunched": 0,
            "start": 119976219,
            "end": 119992688,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide1.ogg",
            "crunched": 0,
            "start": 119992688,
            "end": 120003616,
            "audio": false
        },
        {
            "filename": "/resources/sounds/cardSlide2.ogg",
            "crunched": 0,
            "start": 120003616,
            "end": 120013499,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips1.ogg",
            "crunched": 0,
            "start": 120013499,
            "end": 120022483,
            "audio": false
        },
        {
            "filename": "/resources/sounds/chips2.ogg",
            "crunched": 0,
            "start": 120022483,
            "end": 120034600,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin1.ogg",
            "crunched": 0,
            "start": 120034600,
            "end": 120045909,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin2.ogg",
            "crunched": 0,
            "start": 120045909,
            "end": 120055635,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin3.ogg",
            "crunched": 0,
            "start": 120055635,
            "end": 120067298,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin4.ogg",
            "crunched": 0,
            "start": 120067298,
            "end": 120077823,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin5.ogg",
            "crunched": 0,
            "start": 120077823,
            "end": 120090925,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin6.ogg",
            "crunched": 0,
            "start": 120090925,
            "end": 120108976,
            "audio": false
        },
        {
            "filename": "/resources/sounds/coin7.ogg",
            "crunched": 0,
            "start": 120108976,
            "end": 120120291,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple1.ogg",
            "crunched": 0,
            "start": 120120291,
            "end": 120134475,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple2.ogg",
            "crunched": 0,
            "start": 120134475,
            "end": 120148811,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple3.ogg",
            "crunched": 0,
            "start": 120148811,
            "end": 120162095,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple4.ogg",
            "crunched": 0,
            "start": 120162095,
            "end": 120175227,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumple5.ogg",
            "crunched": 0,
            "start": 120175227,
            "end": 120189033,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong1.ogg",
            "crunched": 0,
            "start": 120189033,
            "end": 120240171,
            "audio": false
        },
        {
            "filename": "/resources/sounds/crumpleLong2.ogg",
            "crunched": 0,
            "start": 120240171,
            "end": 120294913,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_buildup1.ogg",
            "crunched": 0,
            "start": 120294913,
            "end": 120326764,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion_release1.ogg",
            "crunched": 0,
            "start": 120326764,
            "end": 120358762,
            "audio": false
        },
        {
            "filename": "/resources/sounds/explosion1.ogg",
            "crunched": 0,
            "start": 120358762,
            "end": 120407188,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil1.ogg",
            "crunched": 0,
            "start": 120407188,
            "end": 120415954,
            "audio": false
        },
        {
            "filename": "/resources/sounds/foil2.ogg",
            "crunched": 0,
            "start": 120415954,
            "end": 120425496,
            "audio": false
        },
        {
            "filename": "/resources/sounds/generic1.ogg",
            "crunched": 0,
            "start": 120425496,
            "end": 120432631,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass1.ogg",
            "crunched": 0,
            "start": 120432631,
            "end": 120449585,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass2.ogg",
            "crunched": 0,
            "start": 120449585,
            "end": 120466382,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass3.ogg",
            "crunched": 0,
            "start": 120466382,
            "end": 120482954,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass4.ogg",
            "crunched": 0,
            "start": 120482954,
            "end": 120500458,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass5.ogg",
            "crunched": 0,
            "start": 120500458,
            "end": 120517593,
            "audio": false
        },
        {
            "filename": "/resources/sounds/glass6.ogg",
            "crunched": 0,
            "start": 120517593,
            "end": 120535638,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gold_seal.ogg",
            "crunched": 0,
            "start": 120535638,
            "end": 120548922,
            "audio": false
        },
        {
            "filename": "/resources/sounds/gong.ogg",
            "crunched": 0,
            "start": 120548922,
            "end": 120567067,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight1.ogg",
            "crunched": 0,
            "start": 120567067,
            "end": 120574254,
            "audio": false
        },
        {
            "filename": "/resources/sounds/highlight2.ogg",
            "crunched": 0,
            "start": 120574254,
            "end": 120587638,
            "audio": false
        },
        {
            "filename": "/resources/sounds/holo1.ogg",
            "crunched": 0,
            "start": 120587638,
            "end": 120600193,
            "audio": false
        },
        {
            "filename": "/resources/sounds/introPad1.ogg",
            "crunched": 0,
            "start": 120600193,
            "end": 120934211,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple.ogg",
            "crunched": 0,
            "start": 120934211,
            "end": 121020340,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple2.ogg",
            "crunched": 0,
            "start": 121020340,
            "end": 121055670,
            "audio": false
        },
        {
            "filename": "/resources/sounds/magic_crumple3.ogg",
            "crunched": 0,
            "start": 121055670,
            "end": 121080100,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit1.ogg",
            "crunched": 0,
            "start": 121080100,
            "end": 121092182,
            "audio": false
        },
        {
            "filename": "/resources/sounds/multhit2.ogg",
            "crunched": 0,
            "start": 121092182,
            "end": 121107134,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music1.ogg",
            "crunched": 0,
            "start": 121107134,
            "end": 124045876,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music2.ogg",
            "crunched": 0,
            "start": 124045876,
            "end": 126661145,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music3.ogg",
            "crunched": 0,
            "start": 126661145,
            "end": 129172203,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music4.ogg",
            "crunched": 0,
            "start": 129172203,
            "end": 131980600,
            "audio": false
        },
        {
            "filename": "/resources/sounds/music5.ogg",
            "crunched": 0,
            "start": 131980600,
            "end": 134826428,
            "audio": false
        },
        {
            "filename": "/resources/sounds/negative.ogg",
            "crunched": 0,
            "start": 134826428,
            "end": 134839626,
            "audio": false
        },
        {
            "filename": "/resources/sounds/other1.ogg",
            "crunched": 0,
            "start": 134839626,
            "end": 134851774,
            "audio": false
        },
        {
            "filename": "/resources/sounds/paper1.ogg",
            "crunched": 0,
            "start": 134851774,
            "end": 134857046,
            "audio": false
        },
        {
            "filename": "/resources/sounds/polychrome1.ogg",
            "crunched": 0,
            "start": 134857046,
            "end": 134887067,
            "audio": false
        },
        {
            "filename": "/resources/sounds/slice1.ogg",
            "crunched": 0,
            "start": 134887067,
            "end": 134895564,
            "audio": false
        },
        {
            "filename": "/resources/sounds/splash_buildup.ogg",
            "crunched": 0,
            "start": 134895564,
            "end": 135235123,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot1.ogg",
            "crunched": 0,
            "start": 135235123,
            "end": 135244244,
            "audio": false
        },
        {
            "filename": "/resources/sounds/tarot2.ogg",
            "crunched": 0,
            "start": 135244244,
            "end": 135255066,
            "audio": false
        },
        {
            "filename": "/resources/sounds/timpani.ogg",
            "crunched": 0,
            "start": 135255066,
            "end": 135269257,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice1.ogg",
            "crunched": 0,
            "start": 135269257,
            "end": 135276341,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice10.ogg",
            "crunched": 0,
            "start": 135276341,
            "end": 135283432,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice11.ogg",
            "crunched": 0,
            "start": 135283432,
            "end": 135290421,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice2.ogg",
            "crunched": 0,
            "start": 135290421,
            "end": 135297441,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice3.ogg",
            "crunched": 0,
            "start": 135297441,
            "end": 135304540,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice4.ogg",
            "crunched": 0,
            "start": 135304540,
            "end": 135311903,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice5.ogg",
            "crunched": 0,
            "start": 135311903,
            "end": 135319098,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice6.ogg",
            "crunched": 0,
            "start": 135319098,
            "end": 135326217,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice7.ogg",
            "crunched": 0,
            "start": 135326217,
            "end": 135333278,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice8.ogg",
            "crunched": 0,
            "start": 135333278,
            "end": 135340442,
            "audio": false
        },
        {
            "filename": "/resources/sounds/voice9.ogg",
            "crunched": 0,
            "start": 135340442,
            "end": 135347608,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh_long.ogg",
            "crunched": 0,
            "start": 135347608,
            "end": 135461789,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh.ogg",
            "crunched": 0,
            "start": 135461789,
            "end": 135471701,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh1.ogg",
            "crunched": 0,
            "start": 135471701,
            "end": 135484603,
            "audio": false
        },
        {
            "filename": "/resources/sounds/whoosh2.ogg",
            "crunched": 0,
            "start": 135484603,
            "end": 135497451,
            "audio": false
        },
        {
            "filename": "/resources/sounds/win.ogg",
            "crunched": 0,
            "start": 135497451,
            "end": 135534017,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 135534017,
            "end": 135596154,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/8BitDeck.png",
            "crunched": 0,
            "start": 135596154,
            "end": 135643032,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro_alt.png",
            "crunched": 0,
            "start": 135643032,
            "end": 135663858,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/balatro.png",
            "crunched": 0,
            "start": 135663858,
            "end": 135690735,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/BlindChips.png",
            "crunched": 0,
            "start": 135690735,
            "end": 135774547,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/boosters.png",
            "crunched": 0,
            "start": 135774547,
            "end": 135945165,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/chips.png",
            "crunched": 0,
            "start": 135945165,
            "end": 135953420,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 135953420,
            "end": 135961799,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 135961799,
            "end": 135970114,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 135970114,
            "end": 135975146,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 135975146,
            "end": 135982450,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 135982450,
            "end": 135993602,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 135993602,
            "end": 136006322,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 136006322,
            "end": 136016125,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 136016125,
            "end": 136025804,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 136025804,
            "end": 136032287,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 136032287,
            "end": 136040549,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 136040549,
            "end": 136048716,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 136048716,
            "end": 136057717,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 136057717,
            "end": 136064981,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 136064981,
            "end": 136072303,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 136072303,
            "end": 136080017,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 136080017,
            "end": 136088858,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 136088858,
            "end": 136097545,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 136097545,
            "end": 136106634,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 136106634,
            "end": 136114432,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 136114432,
            "end": 136122163,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 136122163,
            "end": 136129597,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 136129597,
            "end": 136135559,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 136135559,
            "end": 136140292,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 136140292,
            "end": 136145491,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 136145491,
            "end": 136154736,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 136154736,
            "end": 136164294,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 136164294,
            "end": 136171964,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 136171964,
            "end": 136179461,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 136179461,
            "end": 136191169,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 136191169,
            "end": 136203970,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 136203970,
            "end": 136215854,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 136215854,
            "end": 136227495,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 136227495,
            "end": 136235933,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 136235933,
            "end": 136244358,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 136244358,
            "end": 136253519,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 136253519,
            "end": 136263618,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 136263618,
            "end": 136271496,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 136271496,
            "end": 136280078,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 136280078,
            "end": 136287515,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 136287515,
            "end": 136294987,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 136294987,
            "end": 136302554,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 136302554,
            "end": 136309901,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 136309901,
            "end": 136314893,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 136314893,
            "end": 136322699,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 136322699,
            "end": 136329329,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 136329329,
            "end": 136336758,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 136336758,
            "end": 136348904,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 136348904,
            "end": 136359524,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Enhancers.png",
            "crunched": 0,
            "start": 136359524,
            "end": 136435476,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/gamepad_ui.png",
            "crunched": 0,
            "start": 136435476,
            "end": 136455403,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/icons.png",
            "crunched": 0,
            "start": 136455403,
            "end": 136463959,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Jokers.png",
            "crunched": 0,
            "start": 136463959,
            "end": 136968646,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/localthunk-logo.png",
            "crunched": 0,
            "start": 136968646,
            "end": 136978273,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/playstack-logo.png",
            "crunched": 0,
            "start": 136978273,
            "end": 137050999,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 137050999,
            "end": 137061797,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/stickers.png",
            "crunched": 0,
            "start": 137061797,
            "end": 137066181,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/tags.png",
            "crunched": 0,
            "start": 137066181,
            "end": 137073516,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Tarots.png",
            "crunched": 0,
            "start": 137073516,
            "end": 137169847,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 137169847,
            "end": 137171299,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/ui_assets.png",
            "crunched": 0,
            "start": 137171299,
            "end": 137172767,
            "audio": false
        },
        {
            "filename": "/resources/textures/1x/Vouchers.png",
            "crunched": 0,
            "start": 137172767,
            "end": 137243476,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck_opt2.png",
            "crunched": 0,
            "start": 137243476,
            "end": 137324046,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/8BitDeck.png",
            "crunched": 0,
            "start": 137324046,
            "end": 137388444,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro_alt.png",
            "crunched": 0,
            "start": 137388444,
            "end": 137415512,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/balatro.png",
            "crunched": 0,
            "start": 137415512,
            "end": 137450846,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/BlindChips.png",
            "crunched": 0,
            "start": 137450846,
            "end": 137585352,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/boosters.png",
            "crunched": 0,
            "start": 137585352,
            "end": 137797015,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/chips.png",
            "crunched": 0,
            "start": 137797015,
            "end": 137806897,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_1.png",
            "crunched": 0,
            "start": 137806897,
            "end": 137816802,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AC_2.png",
            "crunched": 0,
            "start": 137816802,
            "end": 137826670,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_1.png",
            "crunched": 0,
            "start": 137826670,
            "end": 137834644,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_AU_2.png",
            "crunched": 0,
            "start": 137834644,
            "end": 137844939,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_1.png",
            "crunched": 0,
            "start": 137844939,
            "end": 137858337,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_BUG_2.png",
            "crunched": 0,
            "start": 137858337,
            "end": 137873067,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_1.png",
            "crunched": 0,
            "start": 137873067,
            "end": 137884787,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_C7_2.png",
            "crunched": 0,
            "start": 137884787,
            "end": 137896519,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_1.png",
            "crunched": 0,
            "start": 137896519,
            "end": 137907012,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CL_2.png",
            "crunched": 0,
            "start": 137907012,
            "end": 137916778,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_1.png",
            "crunched": 0,
            "start": 137916778,
            "end": 137926629,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CR_2.png",
            "crunched": 0,
            "start": 137926629,
            "end": 137937369,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_1.png",
            "crunched": 0,
            "start": 137937369,
            "end": 137948861,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_CYP_2.png",
            "crunched": 0,
            "start": 137948861,
            "end": 137960427,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_1.png",
            "crunched": 0,
            "start": 137960427,
            "end": 137970933,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_D2_2.png",
            "crunched": 0,
            "start": 137970933,
            "end": 137981502,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_1.png",
            "crunched": 0,
            "start": 137981502,
            "end": 137991680,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DBD_2.png",
            "crunched": 0,
            "start": 137991680,
            "end": 138002424,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_1.png",
            "crunched": 0,
            "start": 138002424,
            "end": 138012048,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DS_2.png",
            "crunched": 0,
            "start": 138012048,
            "end": 138021633,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_1.png",
            "crunched": 0,
            "start": 138021633,
            "end": 138031199,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_DTD_2.png",
            "crunched": 0,
            "start": 138031199,
            "end": 138038616,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_1.png",
            "crunched": 0,
            "start": 138038616,
            "end": 138044457,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_EG_2.png",
            "crunched": 0,
            "start": 138044457,
            "end": 138050855,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_1.png",
            "crunched": 0,
            "start": 138050855,
            "end": 138061777,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_FO_2.png",
            "crunched": 0,
            "start": 138061777,
            "end": 138073058,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_1.png",
            "crunched": 0,
            "start": 138073058,
            "end": 138082145,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_PC_2.png",
            "crunched": 0,
            "start": 138082145,
            "end": 138091180,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_1.png",
            "crunched": 0,
            "start": 138091180,
            "end": 138104994,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_R_2.png",
            "crunched": 0,
            "start": 138104994,
            "end": 138120052,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_1.png",
            "crunched": 0,
            "start": 138120052,
            "end": 138133776,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SK_2.png",
            "crunched": 0,
            "start": 138133776,
            "end": 138147165,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_1.png",
            "crunched": 0,
            "start": 138147165,
            "end": 138157207,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STP_2.png",
            "crunched": 0,
            "start": 138157207,
            "end": 138167205,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_1.png",
            "crunched": 0,
            "start": 138167205,
            "end": 138178264,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_STS_2.png",
            "crunched": 0,
            "start": 138178264,
            "end": 138190418,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_1.png",
            "crunched": 0,
            "start": 138190418,
            "end": 138202031,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_SV_2.png",
            "crunched": 0,
            "start": 138202031,
            "end": 138214628,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_1.png",
            "crunched": 0,
            "start": 138214628,
            "end": 138225352,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TBoI_2.png",
            "crunched": 0,
            "start": 138225352,
            "end": 138236075,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_1.png",
            "crunched": 0,
            "start": 138236075,
            "end": 138247302,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_TW_2.png",
            "crunched": 0,
            "start": 138247302,
            "end": 138258228,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_1.png",
            "crunched": 0,
            "start": 138258228,
            "end": 138265647,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_VS_2.png",
            "crunched": 0,
            "start": 138265647,
            "end": 138274913,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_1.png",
            "crunched": 0,
            "start": 138274913,
            "end": 138286196,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_WF_2.png",
            "crunched": 0,
            "start": 138286196,
            "end": 138298958,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_1.png",
            "crunched": 0,
            "start": 138298958,
            "end": 138313187,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/collabs/collab_XR_2.png",
            "crunched": 0,
            "start": 138313187,
            "end": 138326079,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Enhancers.png",
            "crunched": 0,
            "start": 138326079,
            "end": 138419964,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/gamepad_ui.png",
            "crunched": 0,
            "start": 138419964,
            "end": 138444829,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/icons.png",
            "crunched": 0,
            "start": 138444829,
            "end": 138456399,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Jokers.png",
            "crunched": 0,
            "start": 138456399,
            "end": 139068923,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/localthunk-logo.png",
            "crunched": 0,
            "start": 139068923,
            "end": 139089486,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/playstack-logo.png",
            "crunched": 0,
            "start": 139089486,
            "end": 139196874,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ShopSignAnimation.png",
            "crunched": 0,
            "start": 139196874,
            "end": 139212529,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/stickers.png",
            "crunched": 0,
            "start": 139212529,
            "end": 139219267,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/tags.png",
            "crunched": 0,
            "start": 139219267,
            "end": 139230118,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Tarots.png",
            "crunched": 0,
            "start": 139230118,
            "end": 139349780,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets_opt2.png",
            "crunched": 0,
            "start": 139349780,
            "end": 139351534,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/ui_assets.png",
            "crunched": 0,
            "start": 139351534,
            "end": 139353291,
            "audio": false
        },
        {
            "filename": "/resources/textures/2x/Vouchers.png",
            "crunched": 0,
            "start": 139353291,
            "end": 139437892,
            "audio": false
        },
        {
            "filename": "/SMODS/lovely_regex.lua",
            "crunched": 0,
            "start": 139437892,
            "end": 139468484,
            "audio": false
        },
        {
            "filename": "/SMODS/nativefs.lua",
            "crunched": 0,
            "start": 139468484,
            "end": 139471706,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/loader.lua",
            "crunched": 0,
            "start": 139471706,
            "end": 139511314,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/logging.lua",
            "crunched": 0,
            "start": 139511314,
            "end": 139511960,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUI.lua",
            "crunched": 0,
            "start": 139511960,
            "end": 139517886,
            "audio": false
        },
        {
            "filename": "/SMODS/preflight/sharedUtil.lua",
            "crunched": 0,
            "start": 139517886,
            "end": 139521184,
            "audio": false
        },
        {
            "filename": "/SMODS/release.lua",
            "crunched": 0,
            "start": 139521184,
            "end": 139521221,
            "audio": false
        },
        {
            "filename": "/SMODS/version.lua",
            "crunched": 0,
            "start": 139521221,
            "end": 139521258,
            "audio": false
        },
        {
            "filename": "/SMODS/web_bootstrap.lua",
            "crunched": 0,
            "start": 139521258,
            "end": 139560878,
            "audio": false
        },
        {
            "filename": "/SMODS/web_compare.lua",
            "crunched": 0,
            "start": 139560878,
            "end": 139574201,
            "audio": false
        },
        {
            "filename": "/SMODS/web_shaders.lua",
            "crunched": 0,
            "start": 139574201,
            "end": 139579294,
            "audio": false
        },
        {
            "filename": "/SMODS/web_threads.lua",
            "crunched": 0,
            "start": 139579294,
            "end": 139583772,
            "audio": false
        },
        {
            "filename": "/tag.lua",
            "crunched": 0,
            "start": 139583772,
            "end": 139608911,
            "audio": false
        },
        {
            "filename": "/version.jkr",
            "crunched": 0,
            "start": 139608911,
            "end": 139608945,
            "audio": false
        }
    ]
});
})();
