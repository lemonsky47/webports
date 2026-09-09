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
    var CHUNK_SIZE = 19900000;
    var TOTAL_CHUNKS = 5; // game.data.000 through game.data.004
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
      Module['FS_createPath']('/', 'engine', true, true);
      Module['FS_createPath']('/', 'functions', true, true);
      Module['FS_createPath']('/', 'localization', true, true);
      Module['FS_createPath']('/', 'resources', true, true);
      Module['FS_createPath']('/resources', 'fonts', true, true);
      Module['FS_createPath']('/resources', 'shaders', true, true);
      Module['FS_createPath']('/resources', 'sounds', true, true);
      Module['FS_createPath']('/resources', 'textures', true, true);
      Module['FS_createPath']('/resources/textures', '1x', true, true);
      Module['FS_createPath']('/resources/textures/1x', 'collabs', true, true);
      Module['FS_createPath']('/resources/textures', '2x', true, true);
      Module['FS_createPath']('/resources/textures/2x', 'collabs', true, true);

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
    "package_uuid": "f44a7fd8-38f3-4e7c-becc-3a94ae2cf90a",
    "remote_package_size": 92947939,
    "files": [{
      "filename": "/back.lua",
      "crunched": 0,
      "start": 0,
      "end": 12555,
      "audio": false
    }, {
      "filename": "/blind.lua",
      "crunched": 0,
      "start": 12555,
      "end": 40089,
      "audio": false
    }, {
      "filename": "/card.lua",
      "crunched": 0,
      "start": 40089,
      "end": 282640,
      "audio": false
    }, {
      "filename": "/card_character.lua",
      "crunched": 0,
      "start": 282640,
      "end": 287998,
      "audio": false
    }, {
      "filename": "/cardarea.lua",
      "crunched": 0,
      "start": 287998,
      "end": 320080,
      "audio": false
    }, {
      "filename": "/challenges.lua",
      "crunched": 0,
      "start": 320080,
      "end": 344012,
      "audio": false
    }, {
      "filename": "/conf.lua",
      "crunched": 0,
      "start": 344012,
      "end": 344296,
      "audio": false
    }, {
      "filename": "/engine/animatedsprite.lua",
      "crunched": 0,
      "start": 344296,
      "end": 347568,
      "audio": false
    }, {
      "filename": "/engine/controller.lua",
      "crunched": 0,
      "start": 347568,
      "end": 408222,
      "audio": false
    }, {
      "filename": "/engine/event.lua",
      "crunched": 0,
      "start": 408222,
      "end": 415256,
      "audio": false
    }, {
      "filename": "/engine/http_manager.lua",
      "crunched": 0,
      "start": 415256,
      "end": 415926,
      "audio": false
    }, {
      "filename": "/engine/moveable.lua",
      "crunched": 0,
      "start": 415926,
      "end": 436457,
      "audio": false
    }, {
      "filename": "/engine/node.lua",
      "crunched": 0,
      "start": 436457,
      "end": 452174,
      "audio": false
    }, {
      "filename": "/engine/object.lua",
      "crunched": 0,
      "start": 452174,
      "end": 452840,
      "audio": false
    }, {
      "filename": "/engine/particles.lua",
      "crunched": 0,
      "start": 452840,
      "end": 459435,
      "audio": false
    }, {
      "filename": "/engine/profile.lua",
      "crunched": 0,
      "start": 459435,
      "end": 464008,
      "audio": false
    }, {
      "filename": "/engine/save_manager.lua",
      "crunched": 0,
      "start": 464008,
      "end": 467802,
      "audio": false
    }, {
      "filename": "/engine/sound_manager.lua",
      "crunched": 0,
      "start": 467802,
      "end": 474730,
      "audio": false
    }, {
      "filename": "/engine/sprite.lua",
      "crunched": 0,
      "start": 474730,
      "end": 482696,
      "audio": false
    }, {
      "filename": "/engine/string_packer.lua",
      "crunched": 0,
      "start": 482696,
      "end": 485476,
      "audio": false
    }, {
      "filename": "/engine/text.lua",
      "crunched": 0,
      "start": 485476,
      "end": 500432,
      "audio": false
    }, {
      "filename": "/engine/ui.lua",
      "crunched": 0,
      "start": 500432,
      "end": 545729,
      "audio": false
    }, {
      "filename": "/functions/UI_definitions.lua",
      "crunched": 0,
      "start": 545729,
      "end": 897972,
      "audio": false
    }, {
      "filename": "/functions/button_callbacks.lua",
      "crunched": 0,
      "start": 897972,
      "end": 1015462,
      "audio": false
    }, {
      "filename": "/functions/common_events.lua",
      "crunched": 0,
      "start": 1015462,
      "end": 1146616,
      "audio": false
    }, {
      "filename": "/functions/misc_functions.lua",
      "crunched": 0,
      "start": 1146616,
      "end": 1220488,
      "audio": false
    }, {
      "filename": "/functions/state_events.lua",
      "crunched": 0,
      "start": 1220488,
      "end": 1296644,
      "audio": false
    }, {
      "filename": "/functions/test_functions.lua",
      "crunched": 0,
      "start": 1296644,
      "end": 1304793,
      "audio": false
    }, {
      "filename": "/game.lua",
      "crunched": 0,
      "start": 1304793,
      "end": 1542914,
      "audio": false
    }, {
      "filename": "/globals.lua",
      "crunched": 0,
      "start": 1542914,
      "end": 1559611,
      "audio": false
    }, {
      "filename": "/localization/de.lua",
      "crunched": 0,
      "start": 1559611,
      "end": 1714292,
      "audio": false
    }, {
      "filename": "/localization/en-us.lua",
      "crunched": 0,
      "start": 1714292,
      "end": 1861099,
      "audio": false
    }, {
      "filename": "/localization/es_419.lua",
      "crunched": 0,
      "start": 1861099,
      "end": 2014661,
      "audio": false
    }, {
      "filename": "/localization/es_ES.lua",
      "crunched": 0,
      "start": 2014661,
      "end": 2168331,
      "audio": false
    }, {
      "filename": "/localization/fr.lua",
      "crunched": 0,
      "start": 2168331,
      "end": 2325881,
      "audio": false
    }, {
      "filename": "/localization/id.lua",
      "crunched": 0,
      "start": 2325881,
      "end": 2477538,
      "audio": false
    }, {
      "filename": "/localization/it.lua",
      "crunched": 0,
      "start": 2477538,
      "end": 2629404,
      "audio": false
    }, {
      "filename": "/localization/ja.lua",
      "crunched": 0,
      "start": 2629404,
      "end": 2797801,
      "audio": false
    }, {
      "filename": "/localization/ko.lua",
      "crunched": 0,
      "start": 2797801,
      "end": 2957874,
      "audio": false
    }, {
      "filename": "/localization/nl.lua",
      "crunched": 0,
      "start": 2957874,
      "end": 3110645,
      "audio": false
    }, {
      "filename": "/localization/pl.lua",
      "crunched": 0,
      "start": 3110645,
      "end": 3265531,
      "audio": false
    }, {
      "filename": "/localization/pt_BR.lua",
      "crunched": 0,
      "start": 3265531,
      "end": 3418913,
      "audio": false
    }, {
      "filename": "/localization/ru.lua",
      "crunched": 0,
      "start": 3418913,
      "end": 3600784,
      "audio": false
    }, {
      "filename": "/localization/zh_CN.lua",
      "crunched": 0,
      "start": 3600784,
      "end": 3748191,
      "audio": false
    }, {
      "filename": "/localization/zh_TW.lua",
      "crunched": 0,
      "start": 3748191,
      "end": 3895233,
      "audio": false
    }, {
      "filename": "/main.lua",
      "crunched": 0,
      "start": 3895233,
      "end": 3910975,
      "audio": false
    }, {
      "filename": "/resources/.DS_Store",
      "crunched": 0,
      "start": 3910975,
      "end": 3917123,
      "audio": false
    }, {
      "filename": "/resources/fonts/GoNotoCJKCore.ttf",
      "crunched": 0,
      "start": 3917123,
      "end": 22417095,
      "audio": false
    }, {
      "filename": "/resources/fonts/GoNotoCurrent-Bold.ttf",
      "crunched": 0,
      "start": 22417095,
      "end": 36951139,
      "audio": false
    }, {
      "filename": "/resources/fonts/NotoSans-Bold.ttf",
      "crunched": 0,
      "start": 36951139,
      "end": 37533743,
      "audio": false
    }, {
      "filename": "/resources/fonts/NotoSansJP-Bold.ttf",
      "crunched": 0,
      "start": 37533743,
      "end": 43261571,
      "audio": false
    }, {
      "filename": "/resources/fonts/NotoSansKR-Bold.ttf",
      "crunched": 0,
      "start": 43261571,
      "end": 49452395,
      "audio": false
    }, {
      "filename": "/resources/fonts/NotoSansSC-Bold.ttf",
      "crunched": 0,
      "start": 49452395,
      "end": 60002511,
      "audio": false
    }, {
      "filename": "/resources/fonts/NotoSansTC-Bold.ttf",
      "crunched": 0,
      "start": 60002511,
      "end": 67107823,
      "audio": false
    }, {
      "filename": "/resources/fonts/m6x11plus.ttf",
      "crunched": 0,
      "start": 67107823,
      "end": 67142888,
      "audio": false
    }, {
      "filename": "/resources/gamecontrollerdb.txt",
      "crunched": 0,
      "start": 67142888,
      "end": 67540712,
      "audio": false
    }, {
      "filename": "/resources/shaders/CRT.fs",
      "crunched": 0,
      "start": 67540712,
      "end": 67547982,
      "audio": false
    }, {
      "filename": "/resources/shaders/background.fs",
      "crunched": 0,
      "start": 67547982,
      "end": 67550502,
      "audio": false
    }, {
      "filename": "/resources/shaders/booster.fs",
      "crunched": 0,
      "start": 67550502,
      "end": 67555825,
      "audio": false
    }, {
      "filename": "/resources/shaders/debuff.fs",
      "crunched": 0,
      "start": 67555825,
      "end": 67560989,
      "audio": false
    }, {
      "filename": "/resources/shaders/dissolve.fs",
      "crunched": 0,
      "start": 67560989,
      "end": 67565258,
      "audio": false
    }, {
      "filename": "/resources/shaders/flame.fs",
      "crunched": 0,
      "start": 67565258,
      "end": 67568107,
      "audio": false
    }, {
      "filename": "/resources/shaders/flash.fs",
      "crunched": 0,
      "start": 67568107,
      "end": 67569008,
      "audio": false
    }, {
      "filename": "/resources/shaders/foil.fs",
      "crunched": 0,
      "start": 67569008,
      "end": 67574943,
      "audio": false
    }, {
      "filename": "/resources/shaders/gold_seal.fs",
      "crunched": 0,
      "start": 67574943,
      "end": 67575744,
      "audio": false
    }, {
      "filename": "/resources/shaders/holo.fs",
      "crunched": 0,
      "start": 67575744,
      "end": 67581751,
      "audio": false
    }, {
      "filename": "/resources/shaders/hologram.fs",
      "crunched": 0,
      "start": 67581751,
      "end": 67587513,
      "audio": false
    }, {
      "filename": "/resources/shaders/negative.fs",
      "crunched": 0,
      "start": 67587513,
      "end": 67592407,
      "audio": false
    }, {
      "filename": "/resources/shaders/negative_shine.fs",
      "crunched": 0,
      "start": 67592407,
      "end": 67597317,
      "audio": false
    }, {
      "filename": "/resources/shaders/played.fs",
      "crunched": 0,
      "start": 67597317,
      "end": 67602107,
      "audio": false
    }, {
      "filename": "/resources/shaders/polychrome.fs",
      "crunched": 0,
      "start": 67602107,
      "end": 67607933,
      "audio": false
    }, {
      "filename": "/resources/shaders/skew.fs",
      "crunched": 0,
      "start": 67607933,
      "end": 67608604,
      "audio": false
    }, {
      "filename": "/resources/shaders/splash.fs",
      "crunched": 0,
      "start": 67608604,
      "end": 67611211,
      "audio": false
    }, {
      "filename": "/resources/shaders/vortex.fs",
      "crunched": 0,
      "start": 67611211,
      "end": 67612022,
      "audio": false
    }, {
      "filename": "/resources/shaders/voucher.fs",
      "crunched": 0,
      "start": 67612022,
      "end": 67616851,
      "audio": false
    }, {
      "filename": "/resources/sounds/ambientFire1.ogg",
      "crunched": 0,
      "start": 67616851,
      "end": 68095182,
      "audio": true
    }, {
      "filename": "/resources/sounds/ambientFire2.ogg",
      "crunched": 0,
      "start": 68095182,
      "end": 68603679,
      "audio": true
    }, {
      "filename": "/resources/sounds/ambientFire3.ogg",
      "crunched": 0,
      "start": 68603679,
      "end": 69107236,
      "audio": true
    }, {
      "filename": "/resources/sounds/ambientOrgan1.ogg",
      "crunched": 0,
      "start": 69107236,
      "end": 69488189,
      "audio": true
    }, {
      "filename": "/resources/sounds/button.ogg",
      "crunched": 0,
      "start": 69488189,
      "end": 69496322,
      "audio": true
    }, {
      "filename": "/resources/sounds/cancel.ogg",
      "crunched": 0,
      "start": 69496322,
      "end": 69506402,
      "audio": true
    }, {
      "filename": "/resources/sounds/card1.ogg",
      "crunched": 0,
      "start": 69506402,
      "end": 69520340,
      "audio": true
    }, {
      "filename": "/resources/sounds/card3.ogg",
      "crunched": 0,
      "start": 69520340,
      "end": 69532212,
      "audio": true
    }, {
      "filename": "/resources/sounds/cardFan2.ogg",
      "crunched": 0,
      "start": 69532212,
      "end": 69548681,
      "audio": true
    }, {
      "filename": "/resources/sounds/cardSlide1.ogg",
      "crunched": 0,
      "start": 69548681,
      "end": 69559609,
      "audio": true
    }, {
      "filename": "/resources/sounds/cardSlide2.ogg",
      "crunched": 0,
      "start": 69559609,
      "end": 69569492,
      "audio": true
    }, {
      "filename": "/resources/sounds/chips1.ogg",
      "crunched": 0,
      "start": 69569492,
      "end": 69578476,
      "audio": true
    }, {
      "filename": "/resources/sounds/chips2.ogg",
      "crunched": 0,
      "start": 69578476,
      "end": 69590593,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin1.ogg",
      "crunched": 0,
      "start": 69590593,
      "end": 69601902,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin2.ogg",
      "crunched": 0,
      "start": 69601902,
      "end": 69611628,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin3.ogg",
      "crunched": 0,
      "start": 69611628,
      "end": 69623291,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin4.ogg",
      "crunched": 0,
      "start": 69623291,
      "end": 69633816,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin5.ogg",
      "crunched": 0,
      "start": 69633816,
      "end": 69646918,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin6.ogg",
      "crunched": 0,
      "start": 69646918,
      "end": 69664969,
      "audio": true
    }, {
      "filename": "/resources/sounds/coin7.ogg",
      "crunched": 0,
      "start": 69664969,
      "end": 69676284,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumple1.ogg",
      "crunched": 0,
      "start": 69676284,
      "end": 69690468,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumple2.ogg",
      "crunched": 0,
      "start": 69690468,
      "end": 69704804,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumple3.ogg",
      "crunched": 0,
      "start": 69704804,
      "end": 69718088,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumple4.ogg",
      "crunched": 0,
      "start": 69718088,
      "end": 69731220,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumple5.ogg",
      "crunched": 0,
      "start": 69731220,
      "end": 69745026,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumpleLong1.ogg",
      "crunched": 0,
      "start": 69745026,
      "end": 69796164,
      "audio": true
    }, {
      "filename": "/resources/sounds/crumpleLong2.ogg",
      "crunched": 0,
      "start": 69796164,
      "end": 69850906,
      "audio": true
    }, {
      "filename": "/resources/sounds/explosion1.ogg",
      "crunched": 0,
      "start": 69850906,
      "end": 69899332,
      "audio": true
    }, {
      "filename": "/resources/sounds/explosion_buildup1.ogg",
      "crunched": 0,
      "start": 69899332,
      "end": 69931183,
      "audio": true
    }, {
      "filename": "/resources/sounds/explosion_release1.ogg",
      "crunched": 0,
      "start": 69931183,
      "end": 69963181,
      "audio": true
    }, {
      "filename": "/resources/sounds/foil1.ogg",
      "crunched": 0,
      "start": 69963181,
      "end": 69971947,
      "audio": true
    }, {
      "filename": "/resources/sounds/foil2.ogg",
      "crunched": 0,
      "start": 69971947,
      "end": 69981489,
      "audio": true
    }, {
      "filename": "/resources/sounds/generic1.ogg",
      "crunched": 0,
      "start": 69981489,
      "end": 69988624,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass1.ogg",
      "crunched": 0,
      "start": 69988624,
      "end": 70005578,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass2.ogg",
      "crunched": 0,
      "start": 70005578,
      "end": 70022375,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass3.ogg",
      "crunched": 0,
      "start": 70022375,
      "end": 70038947,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass4.ogg",
      "crunched": 0,
      "start": 70038947,
      "end": 70056451,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass5.ogg",
      "crunched": 0,
      "start": 70056451,
      "end": 70073586,
      "audio": true
    }, {
      "filename": "/resources/sounds/glass6.ogg",
      "crunched": 0,
      "start": 70073586,
      "end": 70091631,
      "audio": true
    }, {
      "filename": "/resources/sounds/gold_seal.ogg",
      "crunched": 0,
      "start": 70091631,
      "end": 70104915,
      "audio": true
    }, {
      "filename": "/resources/sounds/gong.ogg",
      "crunched": 0,
      "start": 70104915,
      "end": 70123060,
      "audio": true
    }, {
      "filename": "/resources/sounds/highlight1.ogg",
      "crunched": 0,
      "start": 70123060,
      "end": 70130247,
      "audio": true
    }, {
      "filename": "/resources/sounds/highlight2.ogg",
      "crunched": 0,
      "start": 70130247,
      "end": 70143631,
      "audio": true
    }, {
      "filename": "/resources/sounds/holo1.ogg",
      "crunched": 0,
      "start": 70143631,
      "end": 70156186,
      "audio": true
    }, {
      "filename": "/resources/sounds/introPad1.ogg",
      "crunched": 0,
      "start": 70156186,
      "end": 70490204,
      "audio": true
    }, {
      "filename": "/resources/sounds/magic_crumple.ogg",
      "crunched": 0,
      "start": 70490204,
      "end": 70576333,
      "audio": true
    }, {
      "filename": "/resources/sounds/magic_crumple2.ogg",
      "crunched": 0,
      "start": 70576333,
      "end": 70611663,
      "audio": true
    }, {
      "filename": "/resources/sounds/magic_crumple3.ogg",
      "crunched": 0,
      "start": 70611663,
      "end": 70636093,
      "audio": true
    }, {
      "filename": "/resources/sounds/multhit1.ogg",
      "crunched": 0,
      "start": 70636093,
      "end": 70648175,
      "audio": true
    }, {
      "filename": "/resources/sounds/multhit2.ogg",
      "crunched": 0,
      "start": 70648175,
      "end": 70663127,
      "audio": true
    }, {
      "filename": "/resources/sounds/music1.ogg",
      "crunched": 0,
      "start": 70663127,
      "end": 73601869,
      "audio": true
    }, {
      "filename": "/resources/sounds/music2.ogg",
      "crunched": 0,
      "start": 73601869,
      "end": 76217138,
      "audio": true
    }, {
      "filename": "/resources/sounds/music3.ogg",
      "crunched": 0,
      "start": 76217138,
      "end": 78728196,
      "audio": true
    }, {
      "filename": "/resources/sounds/music4.ogg",
      "crunched": 0,
      "start": 78728196,
      "end": 81536593,
      "audio": true
    }, {
      "filename": "/resources/sounds/music5.ogg",
      "crunched": 0,
      "start": 81536593,
      "end": 84382421,
      "audio": true
    }, {
      "filename": "/resources/sounds/negative.ogg",
      "crunched": 0,
      "start": 84382421,
      "end": 84395619,
      "audio": true
    }, {
      "filename": "/resources/sounds/other1.ogg",
      "crunched": 0,
      "start": 84395619,
      "end": 84407767,
      "audio": true
    }, {
      "filename": "/resources/sounds/paper1.ogg",
      "crunched": 0,
      "start": 84407767,
      "end": 84413039,
      "audio": true
    }, {
      "filename": "/resources/sounds/polychrome1.ogg",
      "crunched": 0,
      "start": 84413039,
      "end": 84443060,
      "audio": true
    }, {
      "filename": "/resources/sounds/slice1.ogg",
      "crunched": 0,
      "start": 84443060,
      "end": 84451557,
      "audio": true
    }, {
      "filename": "/resources/sounds/splash_buildup.ogg",
      "crunched": 0,
      "start": 84451557,
      "end": 84791116,
      "audio": true
    }, {
      "filename": "/resources/sounds/tarot1.ogg",
      "crunched": 0,
      "start": 84791116,
      "end": 84800237,
      "audio": true
    }, {
      "filename": "/resources/sounds/tarot2.ogg",
      "crunched": 0,
      "start": 84800237,
      "end": 84811059,
      "audio": true
    }, {
      "filename": "/resources/sounds/timpani.ogg",
      "crunched": 0,
      "start": 84811059,
      "end": 84825250,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice1.ogg",
      "crunched": 0,
      "start": 84825250,
      "end": 84832334,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice10.ogg",
      "crunched": 0,
      "start": 84832334,
      "end": 84839425,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice11.ogg",
      "crunched": 0,
      "start": 84839425,
      "end": 84846414,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice2.ogg",
      "crunched": 0,
      "start": 84846414,
      "end": 84853434,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice3.ogg",
      "crunched": 0,
      "start": 84853434,
      "end": 84860533,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice4.ogg",
      "crunched": 0,
      "start": 84860533,
      "end": 84867896,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice5.ogg",
      "crunched": 0,
      "start": 84867896,
      "end": 84875091,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice6.ogg",
      "crunched": 0,
      "start": 84875091,
      "end": 84882210,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice7.ogg",
      "crunched": 0,
      "start": 84882210,
      "end": 84889271,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice8.ogg",
      "crunched": 0,
      "start": 84889271,
      "end": 84896435,
      "audio": true
    }, {
      "filename": "/resources/sounds/voice9.ogg",
      "crunched": 0,
      "start": 84896435,
      "end": 84903601,
      "audio": true
    }, {
      "filename": "/resources/sounds/whoosh.ogg",
      "crunched": 0,
      "start": 84903601,
      "end": 84913513,
      "audio": true
    }, {
      "filename": "/resources/sounds/whoosh1.ogg",
      "crunched": 0,
      "start": 84913513,
      "end": 84926415,
      "audio": true
    }, {
      "filename": "/resources/sounds/whoosh2.ogg",
      "crunched": 0,
      "start": 84926415,
      "end": 84939263,
      "audio": true
    }, {
      "filename": "/resources/sounds/whoosh_long.ogg",
      "crunched": 0,
      "start": 84939263,
      "end": 85053444,
      "audio": true
    }, {
      "filename": "/resources/sounds/win.ogg",
      "crunched": 0,
      "start": 85053444,
      "end": 85090010,
      "audio": true
    }, {
      "filename": "/resources/textures/1x/8BitDeck.png",
      "crunched": 0,
      "start": 85090010,
      "end": 85151149,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/8BitDeck_opt2.png",
      "crunched": 0,
      "start": 85151149,
      "end": 85223684,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/BlindChips.png",
      "crunched": 0,
      "start": 85223684,
      "end": 85403559,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/Enhancers.png",
      "crunched": 0,
      "start": 85403559,
      "end": 85482910,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/Jokers.png",
      "crunched": 0,
      "start": 85482910,
      "end": 86148161,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/ShopSignAnimation.png",
      "crunched": 0,
      "start": 86148161,
      "end": 86162317,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/Tarots.png",
      "crunched": 0,
      "start": 86162317,
      "end": 86293989,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/Vouchers.png",
      "crunched": 0,
      "start": 86293989,
      "end": 86387733,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/balatro.png",
      "crunched": 0,
      "start": 86387733,
      "end": 86431271,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/balatro_alt.png",
      "crunched": 0,
      "start": 86431271,
      "end": 86466091,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/boosters.png",
      "crunched": 0,
      "start": 86466091,
      "end": 86665888,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/chips.png",
      "crunched": 0,
      "start": 86665888,
      "end": 86673127,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_AC_1.png",
      "crunched": 0,
      "start": 86673127,
      "end": 86681955,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_AC_2.png",
      "crunched": 0,
      "start": 86681955,
      "end": 86690781,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_AU_1.png",
      "crunched": 0,
      "start": 86690781,
      "end": 86698140,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_AU_2.png",
      "crunched": 0,
      "start": 86698140,
      "end": 86707278,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_BUG_1.png",
      "crunched": 0,
      "start": 86707278,
      "end": 86717610,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_BUG_2.png",
      "crunched": 0,
      "start": 86717610,
      "end": 86729175,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_C7_1.png",
      "crunched": 0,
      "start": 86729175,
      "end": 86738477,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_C7_2.png",
      "crunched": 0,
      "start": 86738477,
      "end": 86747755,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CL_1.png",
      "crunched": 0,
      "start": 86747755,
      "end": 86757075,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CL_2.png",
      "crunched": 0,
      "start": 86757075,
      "end": 86765863,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CR_1.png",
      "crunched": 0,
      "start": 86765863,
      "end": 86774597,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CR_2.png",
      "crunched": 0,
      "start": 86774597,
      "end": 86784006,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CYP_1.png",
      "crunched": 0,
      "start": 86784006,
      "end": 86792765,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_CYP_2.png",
      "crunched": 0,
      "start": 86792765,
      "end": 86801542,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_D2_1.png",
      "crunched": 0,
      "start": 86801542,
      "end": 86810271,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_D2_2.png",
      "crunched": 0,
      "start": 86810271,
      "end": 86819055,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DBD_1.png",
      "crunched": 0,
      "start": 86819055,
      "end": 86828181,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DBD_2.png",
      "crunched": 0,
      "start": 86828181,
      "end": 86837553,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DS_1.png",
      "crunched": 0,
      "start": 86837553,
      "end": 86845448,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DS_2.png",
      "crunched": 0,
      "start": 86845448,
      "end": 86853368,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DTD_1.png",
      "crunched": 0,
      "start": 86853368,
      "end": 86861398,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_DTD_2.png",
      "crunched": 0,
      "start": 86861398,
      "end": 86869530,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_EG_1.png",
      "crunched": 0,
      "start": 86869530,
      "end": 86875373,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_EG_2.png",
      "crunched": 0,
      "start": 86875373,
      "end": 86881463,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_FO_1.png",
      "crunched": 0,
      "start": 86881463,
      "end": 86890789,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_FO_2.png",
      "crunched": 0,
      "start": 86890789,
      "end": 86900430,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_PC_1.png",
      "crunched": 0,
      "start": 86900430,
      "end": 86908582,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_PC_2.png",
      "crunched": 0,
      "start": 86908582,
      "end": 86917054,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_R_1.png",
      "crunched": 0,
      "start": 86917054,
      "end": 86928421,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_R_2.png",
      "crunched": 0,
      "start": 86928421,
      "end": 86940407,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_SK_1.png",
      "crunched": 0,
      "start": 86940407,
      "end": 86950872,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_SK_2.png",
      "crunched": 0,
      "start": 86950872,
      "end": 86961219,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_STP_1.png",
      "crunched": 0,
      "start": 86961219,
      "end": 86969824,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_STP_2.png",
      "crunched": 0,
      "start": 86969824,
      "end": 86978433,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_STS_1.png",
      "crunched": 0,
      "start": 86978433,
      "end": 86987892,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_STS_2.png",
      "crunched": 0,
      "start": 86987892,
      "end": 86998063,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_SV_1.png",
      "crunched": 0,
      "start": 86998063,
      "end": 87007677,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_SV_2.png",
      "crunched": 0,
      "start": 87007677,
      "end": 87017924,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_TBoI_1.png",
      "crunched": 0,
      "start": 87017924,
      "end": 87026002,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_TBoI_2.png",
      "crunched": 0,
      "start": 87026002,
      "end": 87033741,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_TW_1.png",
      "crunched": 0,
      "start": 87033741,
      "end": 87042950,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_TW_2.png",
      "crunched": 0,
      "start": 87042950,
      "end": 87052035,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_VS_1.png",
      "crunched": 0,
      "start": 87052035,
      "end": 87059497,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_VS_2.png",
      "crunched": 0,
      "start": 87059497,
      "end": 87068649,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_WF_1.png",
      "crunched": 0,
      "start": 87068649,
      "end": 87077257,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_WF_2.png",
      "crunched": 0,
      "start": 87077257,
      "end": 87087405,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_XR_1.png",
      "crunched": 0,
      "start": 87087405,
      "end": 87097214,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/collabs/collab_XR_2.png",
      "crunched": 0,
      "start": 87097214,
      "end": 87106954,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/gamepad_ui.png",
      "crunched": 0,
      "start": 87106954,
      "end": 87148071,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/icons.png",
      "crunched": 0,
      "start": 87148071,
      "end": 87161583,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/localthunk-logo.png",
      "crunched": 0,
      "start": 87161583,
      "end": 87319403,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/playstack-logo.png",
      "crunched": 0,
      "start": 87319403,
      "end": 87493190,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/stickers.png",
      "crunched": 0,
      "start": 87493190,
      "end": 87502665,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/tags.png",
      "crunched": 0,
      "start": 87502665,
      "end": 87513458,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/ui_assets.png",
      "crunched": 0,
      "start": 87513458,
      "end": 87515053,
      "audio": false
    }, {
      "filename": "/resources/textures/1x/ui_assets_opt2.png",
      "crunched": 0,
      "start": 87515053,
      "end": 87516633,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/8BitDeck.png",
      "crunched": 0,
      "start": 87516633,
      "end": 87676771,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/8BitDeck_opt2.png",
      "crunched": 0,
      "start": 87676771,
      "end": 87846432,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/BlindChips.png",
      "crunched": 0,
      "start": 87846432,
      "end": 88349598,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/Enhancers.png",
      "crunched": 0,
      "start": 88349598,
      "end": 88496640,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/Jokers.png",
      "crunched": 0,
      "start": 88496640,
      "end": 89887754,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/ShopSignAnimation.png",
      "crunched": 0,
      "start": 89887754,
      "end": 89923573,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/Tarots.png",
      "crunched": 0,
      "start": 89923573,
      "end": 90208880,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/Vouchers.png",
      "crunched": 0,
      "start": 90208880,
      "end": 90424884,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/balatro.png",
      "crunched": 0,
      "start": 90424884,
      "end": 90502699,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/balatro_alt.png",
      "crunched": 0,
      "start": 90502699,
      "end": 90569605,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/boosters.png",
      "crunched": 0,
      "start": 90569605,
      "end": 90904804,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/chips.png",
      "crunched": 0,
      "start": 90904804,
      "end": 90918470,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_AC_1.png",
      "crunched": 0,
      "start": 90918470,
      "end": 90935785,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_AC_2.png",
      "crunched": 0,
      "start": 90935785,
      "end": 90953137,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_AU_1.png",
      "crunched": 0,
      "start": 90953137,
      "end": 90968829,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_AU_2.png",
      "crunched": 0,
      "start": 90968829,
      "end": 90985986,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_BUG_1.png",
      "crunched": 0,
      "start": 90985986,
      "end": 91004960,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_BUG_2.png",
      "crunched": 0,
      "start": 91004960,
      "end": 91025121,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_C7_1.png",
      "crunched": 0,
      "start": 91025121,
      "end": 91042570,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_C7_2.png",
      "crunched": 0,
      "start": 91042570,
      "end": 91060308,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CL_1.png",
      "crunched": 0,
      "start": 91060308,
      "end": 91078228,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CL_2.png",
      "crunched": 0,
      "start": 91078228,
      "end": 91095259,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CR_1.png",
      "crunched": 0,
      "start": 91095259,
      "end": 91112116,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CR_2.png",
      "crunched": 0,
      "start": 91112116,
      "end": 91129567,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CYP_1.png",
      "crunched": 0,
      "start": 91129567,
      "end": 91147473,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_CYP_2.png",
      "crunched": 0,
      "start": 91147473,
      "end": 91165322,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_D2_1.png",
      "crunched": 0,
      "start": 91165322,
      "end": 91182226,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_D2_2.png",
      "crunched": 0,
      "start": 91182226,
      "end": 91199184,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DBD_1.png",
      "crunched": 0,
      "start": 91199184,
      "end": 91216785,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DBD_2.png",
      "crunched": 0,
      "start": 91216785,
      "end": 91234591,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DS_1.png",
      "crunched": 0,
      "start": 91234591,
      "end": 91251206,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DS_2.png",
      "crunched": 0,
      "start": 91251206,
      "end": 91267848,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DTD_1.png",
      "crunched": 0,
      "start": 91267848,
      "end": 91283463,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_DTD_2.png",
      "crunched": 0,
      "start": 91283463,
      "end": 91299235,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_EG_1.png",
      "crunched": 0,
      "start": 91299235,
      "end": 91312726,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_EG_2.png",
      "crunched": 0,
      "start": 91312726,
      "end": 91326564,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_FO_1.png",
      "crunched": 0,
      "start": 91326564,
      "end": 91344463,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_FO_2.png",
      "crunched": 0,
      "start": 91344463,
      "end": 91362801,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_PC_1.png",
      "crunched": 0,
      "start": 91362801,
      "end": 91379821,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_PC_2.png",
      "crunched": 0,
      "start": 91379821,
      "end": 91396864,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_R_1.png",
      "crunched": 0,
      "start": 91396864,
      "end": 91417472,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_R_2.png",
      "crunched": 0,
      "start": 91417472,
      "end": 91439284,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_SK_1.png",
      "crunched": 0,
      "start": 91439284,
      "end": 91458898,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_SK_2.png",
      "crunched": 0,
      "start": 91458898,
      "end": 91477568,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_STP_1.png",
      "crunched": 0,
      "start": 91477568,
      "end": 91494527,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_STP_2.png",
      "crunched": 0,
      "start": 91494527,
      "end": 91511524,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_STS_1.png",
      "crunched": 0,
      "start": 91511524,
      "end": 91529578,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_STS_2.png",
      "crunched": 0,
      "start": 91529578,
      "end": 91548866,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_SV_1.png",
      "crunched": 0,
      "start": 91548866,
      "end": 91566498,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_SV_2.png",
      "crunched": 0,
      "start": 91566498,
      "end": 91584770,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_TBoI_1.png",
      "crunched": 0,
      "start": 91584770,
      "end": 91601176,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_TBoI_2.png",
      "crunched": 0,
      "start": 91601176,
      "end": 91617560,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_TW_1.png",
      "crunched": 0,
      "start": 91617560,
      "end": 91634772,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_TW_2.png",
      "crunched": 0,
      "start": 91634772,
      "end": 91651964,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_VS_1.png",
      "crunched": 0,
      "start": 91651964,
      "end": 91667503,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_VS_2.png",
      "crunched": 0,
      "start": 91667503,
      "end": 91684725,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_WF_1.png",
      "crunched": 0,
      "start": 91684725,
      "end": 91702260,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_WF_2.png",
      "crunched": 0,
      "start": 91702260,
      "end": 91721203,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_XR_1.png",
      "crunched": 0,
      "start": 91721203,
      "end": 91739841,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/collabs/collab_XR_2.png",
      "crunched": 0,
      "start": 91739841,
      "end": 91757559,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/gamepad_ui.png",
      "crunched": 0,
      "start": 91757559,
      "end": 91875378,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/icons.png",
      "crunched": 0,
      "start": 91875378,
      "end": 91907651,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/localthunk-logo.png",
      "crunched": 0,
      "start": 91907651,
      "end": 92408401,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/playstack-logo.png",
      "crunched": 0,
      "start": 92408401,
      "end": 92866985,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/stickers.png",
      "crunched": 0,
      "start": 92866985,
      "end": 92894943,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/tags.png",
      "crunched": 0,
      "start": 92894943,
      "end": 92915416,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/ui_assets.png",
      "crunched": 0,
      "start": 92915416,
      "end": 92918851,
      "audio": false
    }, {
      "filename": "/resources/textures/2x/ui_assets_opt2.png",
      "crunched": 0,
      "start": 92918851,
      "end": 92922286,
      "audio": false
    }, {
      "filename": "/resources/textures/README.txt",
      "crunched": 0,
      "start": 92922286,
      "end": 92922715,
      "audio": false
    }, {
      "filename": "/tag.lua",
      "crunched": 0,
      "start": 92922715,
      "end": 92947854,
      "audio": false
    }, {
      "filename": "/version.jkr",
      "crunched": 0,
      "start": 92947854,
      "end": 92947939,
      "audio": false
    }]
  });
})();