"use strict";

self.LFJSWasmModule = function (LFJS) {
  var Module = typeof Module !== "undefined" ? Module : {};
  var moduleOverrides = {};
  var key;
  for (key in Module) {
    if (Module.hasOwnProperty(key)) {
      moduleOverrides[key] = Module[key];
    }
  }
  Module["arguments"] = [];
  Module["thisProgram"] = "./this.program";
  Module["quit"] = function (status, toThrow) {
    throw toThrow;
  };
  Module["preRun"] = [];
  Module["postRun"] = [];
  var ENVIRONMENT_IS_WEB = false;
  var ENVIRONMENT_IS_WORKER = false;
  var ENVIRONMENT_IS_NODE = false;
  var ENVIRONMENT_HAS_NODE = false;
  var ENVIRONMENT_IS_SHELL = false;
  ENVIRONMENT_IS_WEB = typeof window === "object";
  ENVIRONMENT_IS_WORKER = typeof importScripts === "function";
  ENVIRONMENT_HAS_NODE =
    typeof process === "object" &&
    typeof process.versions === "object" &&
    typeof process.versions.node === "string";
  ENVIRONMENT_IS_NODE =
    ENVIRONMENT_HAS_NODE && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
  ENVIRONMENT_IS_SHELL =
    !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
  var scriptDirectory = "";

  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    } else {
      return scriptDirectory + path;
    }
  }
  if (ENVIRONMENT_IS_NODE) {
    scriptDirectory = __dirname + "/";
    var nodeFS;
    var nodePath;
    Module["read"] = function shell_read(filename, binary) {
      var ret;
      if (!nodeFS) {
        nodeFS = require("fs");
      }
      if (!nodePath) {
        nodePath = require("path");
      }
      filename = nodePath["normalize"](filename);
      ret = nodeFS["readFileSync"](filename);
      return binary ? ret : ret.toString();
    };
    Module["readBinary"] = function readBinary(filename) {
      var ret = Module["read"](filename, true);
      if (!ret.buffer) {
        ret = new Uint8Array(ret);
      }
      assert(ret.buffer);
      return ret;
    };
    if (process["argv"].length > 1) {
      Module["thisProgram"] = process["argv"][1].replace(/\\/g, "/");
    }
    Module["arguments"] = process["argv"].slice(2);
    if (typeof module !== "undefined") {
      module["exports"] = Module;
    }
    process["on"]("uncaughtException", function (ex) {
      if (!(ex instanceof ExitStatus)) {
        throw ex;
      }
    });
    process["on"]("unhandledRejection", abort);
    Module["quit"] = function (status) {
      process["exit"](status);
    };
    Module["inspect"] = function () {
      return "[Emscripten Module object]";
    };
  } else {
    if (ENVIRONMENT_IS_SHELL) {
      if (typeof read != "undefined") {
        Module["read"] = function shell_read(f) {
          return read(f);
        };
      }
      Module["readBinary"] = function readBinary(f) {
        var data;
        if (typeof readbuffer === "function") {
          return new Uint8Array(readbuffer(f));
        }
        data = read(f, "binary");
        assert(typeof data === "object");
        return data;
      };
      if (typeof scriptArgs != "undefined") {
        Module["arguments"] = scriptArgs;
      } else {
        if (typeof arguments != "undefined") {
          Module["arguments"] = arguments;
        }
      }
      if (typeof quit === "function") {
        Module["quit"] = function (status) {
          quit(status);
        };
      }
    } else {
      if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
        if (ENVIRONMENT_IS_WORKER) {
          scriptDirectory = self.location.href;
        } else {
          if (document.currentScript) {
            scriptDirectory = document.currentScript.src;
          }
        }
        if (scriptDirectory.indexOf("blob:") !== 0) {
          scriptDirectory = scriptDirectory.substr(
            0,
            scriptDirectory.lastIndexOf("/") + 1
          );
        } else {
          scriptDirectory = "";
        }
        Module["read"] = function shell_read(url) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.send(null);
          return xhr.responseText;
        };
        if (ENVIRONMENT_IS_WORKER) {
          Module["readBinary"] = function readBinary(url) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(xhr.response);
          };
        }
        Module["readAsync"] = function readAsync(url, onload, onerror) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = function xhr_onload() {
            if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) {
              onload(xhr.response);
              return;
            }
            onerror();
          };
          xhr.onerror = onerror;
          xhr.send(null);
        };
        Module["setWindowTitle"] = function (title) {
          document.title = title;
        };
      } else {
      }
    }
  }
  var out =
    Module["print"] ||
    (typeof console !== "undefined"
      ? console.log.bind(console)
      : typeof print !== "undefined"
      ? print
      : null);
  var err =
    Module["printErr"] ||
    (typeof printErr !== "undefined"
      ? printErr
      : (typeof console !== "undefined" && console.warn.bind(console)) || out);
  for (key in moduleOverrides) {
    if (moduleOverrides.hasOwnProperty(key)) {
      Module[key] = moduleOverrides[key];
    }
  }
  moduleOverrides = undefined;
  var STACK_ALIGN = 16;

  function dynamicAlloc(size) {
    var ret = HEAP32[DYNAMICTOP_PTR >> 2];
    var end = (ret + size + 15) & -16;
    if (end > _emscripten_get_heap_size()) {
      abort();
    }
    HEAP32[DYNAMICTOP_PTR >> 2] = end;
    return ret;
  }

  function getNativeTypeSize(type) {
    switch (type) {
      case "i1":
      case "i8":
        return 1;
      case "i16":
        return 2;
      case "i32":
        return 4;
      case "i64":
        return 8;
      case "float":
        return 4;
      case "double":
        return 8;
      default: {
        if (type[type.length - 1] === "*") {
          return 4;
        } else {
          if (type[0] === "i") {
            var bits = parseInt(type.substr(1));
            assert(
              bits % 8 === 0,
              "getNativeTypeSize invalid bits " + bits + ", type " + type
            );
            return bits / 8;
          } else {
            return 0;
          }
        }
      }
    }
  }

  function warnOnce(text) {
    if (!warnOnce.shown) {
      warnOnce.shown = {};
    }
    if (!warnOnce.shown[text]) {
      warnOnce.shown[text] = 1;
      err(text);
    }
  }
  var asm2wasmImports = {
    "f64-rem": function (x, y) {
      return x % y;
    },
    debugger: function () {
      return;
    },
  };
  var jsCallStartIndex = 1;
  var functionPointers = new Array(0);

  function convertJsFunctionToWasm(func, sig) {
    var typeSection = [1, 0, 1, 96];
    var sigRet = sig.slice(0, 1);
    var sigParam = sig.slice(1);
    var typeCodes = {
      i: 127,
      j: 126,
      f: 125,
      d: 124,
    };
    typeSection.push(sigParam.length);
    for (var i = 0; i < sigParam.length; ++i) {
      typeSection.push(typeCodes[sigParam[i]]);
    }
    if (sigRet == "v") {
      typeSection.push(0);
    } else {
      typeSection = typeSection.concat([1, typeCodes[sigRet]]);
    }
    typeSection[1] = typeSection.length - 2;
    var bytes = new Uint8Array(
      [0, 97, 115, 109, 1, 0, 0, 0].concat(
        typeSection,
        [2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0]
      )
    );
    var module = new WebAssembly.Module(bytes);
    var instance = new WebAssembly.Instance(module, {
      e: {
        f: func,
      },
    });
    var wrappedFunc = instance.exports.f;
    return wrappedFunc;
  }
  var funcWrappers = {};

  function dynCall(sig, ptr, args) {
    if (args && args.length) {
      return Module["dynCall_" + sig].apply(null, [ptr].concat(args));
    } else {
      return Module["dynCall_" + sig].call(null, ptr);
    }
  }
  var tempRet0 = 0;
  var setTempRet0 = function (value) {
    tempRet0 = value;
  };
  var getTempRet0 = function () {
    return tempRet0;
  };
  if (typeof WebAssembly !== "object") {
    err("no native wasm support detected");
  }

  function setValue(ptr, value, type, noSafe) {
    type = type || "i8";
    if (type.charAt(type.length - 1) === "*") {
      type = "i32";
    }
    switch (type) {
      case "i1":
        HEAP8[ptr >> 0] = value;
        break;
      case "i8":
        HEAP8[ptr >> 0] = value;
        break;
      case "i16":
        HEAP16[ptr >> 1] = value;
        break;
      case "i32":
        HEAP32[ptr >> 2] = value;
        break;
      case "i64":
        (tempI64 = [
          value >>> 0,
          ((tempDouble = value),
          +Math_abs(tempDouble) >= 1
            ? tempDouble > 0
              ? (Math_min(+Math_floor(tempDouble / 4294967296), 4294967295) |
                  0) >>>
                0
              : ~~+Math_ceil(
                  (tempDouble - +(~~tempDouble >>> 0)) / 4294967296
                ) >>> 0
            : 0),
        ]),
          (HEAP32[ptr >> 2] = tempI64[0]),
          (HEAP32[(ptr + 4) >> 2] = tempI64[1]);
        break;
      case "float":
        HEAPF32[ptr >> 2] = value;
        break;
      case "double":
        HEAPF64[ptr >> 3] = value;
        break;
      default:
        abort("invalid type for setValue: " + type);
    }
  }
  var wasmMemory;
  var wasmTable;
  var ABORT = false;
  var EXITSTATUS = 0;

  function assert(condition, text) {
    if (!condition) {
      abort("Assertion failed: " + text);
    }
  }

  function getCFunc(ident) {
    var func = Module["_" + ident];
    assert(
      func,
      "Cannot call unknown function " + ident + ", make sure it is exported"
    );
    return func;
  }

  function ccall(ident, returnType, argTypes, args, opts) {
    var toC = {
      string: function (str) {
        var ret = 0;
        if (str !== null && str !== undefined && str !== 0) {
          var len = (str.length << 2) + 1;
          ret = stackAlloc(len);
          stringToUTF8(str, ret, len);
        }
        return ret;
      },
      array: function (arr) {
        var ret = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret);
        return ret;
      },
    };

    function convertReturnValue(ret) {
      if (returnType === "string") {
        return UTF8ToString(ret);
      }
      if (returnType === "boolean") {
        return Boolean(ret);
      }
      return ret;
    }
    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;
    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) {
            stack = stackSave();
          }
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }
    var ret = func.apply(null, cArgs);
    ret = convertReturnValue(ret);
    if (stack !== 0) {
      stackRestore(stack);
    }
    return ret;
  }

  function cwrap(ident, returnType, argTypes, opts) {
    argTypes = argTypes || [];
    var numericArgs = argTypes.every(function (type) {
      return type === "number";
    });
    var numericRet = returnType !== "string";
    if (numericRet && numericArgs && !opts) {
      return getCFunc(ident);
    }
    return function () {
      return ccall(ident, returnType, argTypes, arguments, opts);
    };
  }
  var ALLOC_NONE = 3;
  var UTF8Decoder =
    typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : undefined;

  function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
    var endIdx = idx + maxBytesToRead;
    var endPtr = idx;
    while (u8Array[endPtr] && !(endPtr >= endIdx)) {
      ++endPtr;
    }
    if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
      return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
    } else {
      var str = "";
      while (idx < endPtr) {
        var u0 = u8Array[idx++];
        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }
        var u1 = u8Array[idx++] & 63;
        if ((u0 & 224) == 192) {
          str += String.fromCharCode(((u0 & 31) << 6) | u1);
          continue;
        }
        var u2 = u8Array[idx++] & 63;
        if ((u0 & 240) == 224) {
          u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {
          u0 =
            ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
        }
        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
        }
      }
    }
    return str;
  }

  function UTF8ToString(ptr, maxBytesToRead) {
    return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
  }

  function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
    if (!(maxBytesToWrite > 0)) {
      return 0;
    }
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) {
        var u1 = str.charCodeAt(++i);
        u = (65536 + ((u & 1023) << 10)) | (u1 & 1023);
      }
      if (u <= 127) {
        if (outIdx >= endIdx) {
          break;
        }
        outU8Array[outIdx++] = u;
      } else {
        if (u <= 2047) {
          if (outIdx + 1 >= endIdx) {
            break;
          }
          outU8Array[outIdx++] = 192 | (u >> 6);
          outU8Array[outIdx++] = 128 | (u & 63);
        } else {
          if (u <= 65535) {
            if (outIdx + 2 >= endIdx) {
              break;
            }
            outU8Array[outIdx++] = 224 | (u >> 12);
            outU8Array[outIdx++] = 128 | ((u >> 6) & 63);
            outU8Array[outIdx++] = 128 | (u & 63);
          } else {
            if (outIdx + 3 >= endIdx) {
              break;
            }
            outU8Array[outIdx++] = 240 | (u >> 18);
            outU8Array[outIdx++] = 128 | ((u >> 12) & 63);
            outU8Array[outIdx++] = 128 | ((u >> 6) & 63);
            outU8Array[outIdx++] = 128 | (u & 63);
          }
        }
      }
    }
    outU8Array[outIdx] = 0;
    return outIdx - startIdx;
  }

  function stringToUTF8(str, outPtr, maxBytesToWrite) {
    return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  }

  function lengthBytesUTF8(str) {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) {
        u = (65536 + ((u & 1023) << 10)) | (str.charCodeAt(++i) & 1023);
      }
      if (u <= 127) {
        ++len;
      } else {
        if (u <= 2047) {
          len += 2;
        } else {
          if (u <= 65535) {
            len += 3;
          } else {
            len += 4;
          }
        }
      }
    }
    return len;
  }
  var UTF16Decoder =
    typeof TextDecoder !== "undefined"
      ? new TextDecoder("utf-16le")
      : undefined;

  function writeArrayToMemory(array, buffer) {
    HEAP8.set(array, buffer);
  }

  function writeAsciiToMemory(str, buffer, dontAddNull) {
    for (var i = 0; i < str.length; ++i) {
      HEAP8[buffer++ >> 0] = str.charCodeAt(i);
    }
    if (!dontAddNull) {
      HEAP8[buffer >> 0] = 0;
    }
  }

  function demangle(func) {
    return func;
  }

  function demangleAll(text) {
    var regex = /__Z[\w\d_]+/g;
    return text.replace(regex, function (x) {
      var y = demangle(x);
      return x === y ? x : y + " [" + x + "]";
    });
  }

  function jsStackTrace() {
    var err = new Error();
    if (!err.stack) {
      try {
        throw new Error(0);
      } catch (e) {
        err = e;
      }
      if (!err.stack) {
        return "(no stack trace available)";
      }
    }
    return err.stack.toString();
  }
  var WASM_PAGE_SIZE = 65536;

  function alignUp(x, multiple) {
    if (x % multiple > 0) {
      x += multiple - (x % multiple);
    }
    return x;
  }
  var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

  function updateGlobalBufferViews() {
    Module["HEAP8"] = HEAP8 = new Int8Array(buffer);
    Module["HEAP16"] = HEAP16 = new Int16Array(buffer);
    Module["HEAP32"] = HEAP32 = new Int32Array(buffer);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(buffer);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(buffer);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(buffer);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(buffer);
    Module["HEAPF64"] = HEAPF64 = new Float64Array(buffer);
  }
  var STACK_BASE = 11760,
    DYNAMIC_BASE = 5254640,
    DYNAMICTOP_PTR = 11728;
  var TOTAL_STACK = 5242880;
  var INITIAL_TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 33554432;
  if (INITIAL_TOTAL_MEMORY < TOTAL_STACK) {
    err(
      "TOTAL_MEMORY should be larger than TOTAL_STACK, was " +
        INITIAL_TOTAL_MEMORY +
        "! (TOTAL_STACK=" +
        TOTAL_STACK +
        ")"
    );
  }
  if (Module["wasmMemory"]) {
    wasmMemory = Module["wasmMemory"];
  } else {
    wasmMemory = new WebAssembly.Memory({
      initial: INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE,
    });
  }
  if (wasmMemory) {
    buffer = wasmMemory.buffer;
  }
  INITIAL_TOTAL_MEMORY = buffer.byteLength;
  updateGlobalBufferViews();
  HEAP32[DYNAMICTOP_PTR >> 2] = DYNAMIC_BASE;

  function callRuntimeCallbacks(callbacks) {
    while (callbacks.length > 0) {
      var callback = callbacks.shift();
      if (typeof callback == "function") {
        callback();
        continue;
      }
      var func = callback.func;
      if (typeof func === "number") {
        if (callback.arg === undefined) {
          Module["dynCall_v"](func);
        } else {
          Module["dynCall_vi"](func, callback.arg);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }
  var __ATPRERUN__ = [];
  var __ATINIT__ = [];
  var __ATMAIN__ = [];
  var __ATPOSTRUN__ = [];
  var runtimeInitialized = false;
  var runtimeExited = false;

  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") {
        Module["preRun"] = [Module["preRun"]];
      }
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(__ATPRERUN__);
  }

  function initRuntime() {
    runtimeInitialized = true;
    callRuntimeCallbacks(__ATINIT__);
  }

  function preMain() {
    callRuntimeCallbacks(__ATMAIN__);
  }

  function exitRuntime() {
    runtimeExited = true;
  }

  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") {
        Module["postRun"] = [Module["postRun"]];
      }
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  }

  function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  }
  var Math_abs = Math.abs;
  var Math_ceil = Math.ceil;
  var Math_floor = Math.floor;
  var Math_min = Math.min;
  var runDependencies = 0;
  var runDependencyWatcher = null;
  var dependenciesFulfilled = null;

  function addRunDependency(id) {
    runDependencies++;
    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }
  }

  function removeRunDependency(id) {
    runDependencies--;
    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }
    if (runDependencies == 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }
      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }
  Module["preloadedImages"] = {};
  Module["preloadedAudios"] = {};
  var dataURIPrefix = "data:application/octet-stream;base64,";

  function isDataURI(filename) {
    return String.prototype.startsWith
      ? filename.startsWith(dataURIPrefix)
      : filename.indexOf(dataURIPrefix) === 0;
  }
  var wasmBinaryFile = LFJS.wasmUrl;
  if (!isDataURI(wasmBinaryFile)) {
    wasmBinaryFile = locateFile(wasmBinaryFile);
  }

  function getBinary() {
    try {
      if (Module["wasmBinary"]) {
        return new Uint8Array(Module["wasmBinary"]);
      }
      if (Module["readBinary"]) {
        return Module["readBinary"](wasmBinaryFile);
      } else {
        throw "both async and sync fetching of the wasm failed";
      }
    } catch (err) {
      abort(err);
    }
  }

  function getBinaryPromise() {
    if (
      !Module["wasmBinary"] &&
      (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) &&
      typeof fetch === "function"
    ) {
      return fetch(wasmBinaryFile, {
        credentials: "same-origin",
      })
        .then(function (response) {
          if (!response["ok"]) {
            throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
          }
          return response["arrayBuffer"]();
        })
        .catch(function () {
          return getBinary();
        });
    }
    return new Promise(function (resolve, reject) {
      resolve(getBinary());
    });
  }

  function createWasm(env) {
    var info = {
      env: env,
      global: {
        NaN: NaN,
        Infinity: Infinity,
      },
      "global.Math": Math,
      asm2wasm: asm2wasmImports,
    };

    function receiveInstance(instance, module) {
      var exports = instance.exports;
      Module["asm"] = exports;
      removeRunDependency("wasm-instantiate");
    }
    addRunDependency("wasm-instantiate");

    function receiveInstantiatedSource(output) {
      receiveInstance(output["instance"]);
    }

    function instantiateArrayBuffer(receiver) {
      return getBinaryPromise()
        .then(function (binary) {
          return WebAssembly.instantiate(binary, info);
        })
        .then(receiver, function (reason) {
          err("failed to asynchronously prepare wasm: " + reason);
          abort(reason);
        });
    }

    function instantiateAsync() {
      if (
        !Module["wasmBinary"] &&
        typeof WebAssembly.instantiateStreaming === "function" &&
        !isDataURI(wasmBinaryFile) &&
        typeof fetch === "function"
      ) {
        fetch(wasmBinaryFile, {
          credentials: "same-origin",
        }).then(function (response) {
          return WebAssembly.instantiateStreaming(response, info).then(
            receiveInstantiatedSource,
            function (reason) {
              //
              //
              instantiateArrayBuffer(receiveInstantiatedSource);
            }
          );
        });
      } else {
        return instantiateArrayBuffer(receiveInstantiatedSource);
      }
    }
    if (Module["instantiateWasm"]) {
      try {
        var exports = Module["instantiateWasm"](info, receiveInstance);
        return exports;
      } catch (e) {
        err("Module.instantiateWasm callback failed with error: " + e);
        return false;
      }
    }
    instantiateArrayBuffer(receiveInstantiatedSource);
    return {};
  }
  Module["asm"] = function (global, env, providedBuffer) {
    env["memory"] = wasmMemory;
    env["table"] = wasmTable = new WebAssembly.Table({
      initial: 384,
      maximum: 384,
      element: "anyfunc",
    });
    env["__memory_base"] = 1024;
    env["__table_base"] = 0;
    var exports = createWasm(env);
    return exports;
  };
  var tempDouble;
  var tempI64;
  var tempDoublePtr = 11744;
  var ___exception_infos = {};
  var ___exception_caught = [];

  function ___exception_addRef(ptr) {
    if (!ptr) {
      return;
    }
    var info = ___exception_infos[ptr];
    info.refcount++;
  }

  function ___exception_deAdjust(adjusted) {
    if (!adjusted || ___exception_infos[adjusted]) {
      return adjusted;
    }
    for (var key in ___exception_infos) {
      var ptr = +key;
      var adj = ___exception_infos[ptr].adjusted;
      var len = adj.length;
      for (var i = 0; i < len; i++) {
        if (adj[i] === adjusted) {
          return ptr;
        }
      }
    }
    return adjusted;
  }

  function ___cxa_begin_catch(ptr) {
    var info = ___exception_infos[ptr];
    if (info && !info.caught) {
      info.caught = true;
      __ZSt18uncaught_exceptionv.uncaught_exception--;
    }
    if (info) {
      info.rethrown = false;
    }
    ___exception_caught.push(ptr);
    ___exception_addRef(___exception_deAdjust(ptr));
    return ptr;
  }

  function ___cxa_pure_virtual() {
    ABORT = true;
    throw "Pure virtual function called!";
  }

  function ___cxa_uncaught_exception() {
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  }

  function ___gxx_personality_v0() {}
  var PATH = {
    splitPath: function (filename) {
      var splitPathRe =
        /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
      return splitPathRe.exec(filename).slice(1);
    },
    normalizeArray: function (parts, allowAboveRoot) {
      var up = 0;
      for (var i = parts.length - 1; i >= 0; i--) {
        var last = parts[i];
        if (last === ".") {
          parts.splice(i, 1);
        } else {
          if (last === "..") {
            parts.splice(i, 1);
            up++;
          } else {
            if (up) {
              parts.splice(i, 1);
              up--;
            }
          }
        }
      }
      if (allowAboveRoot) {
        for (; up; up--) {
          parts.unshift("..");
        }
      }
      return parts;
    },
    normalize: function (path) {
      var isAbsolute = path.charAt(0) === "/",
        trailingSlash = path.substr(-1) === "/";
      path = PATH.normalizeArray(
        path.split("/").filter(function (p) {
          return !!p;
        }),
        !isAbsolute
      ).join("/");
      if (!path && !isAbsolute) {
        path = ".";
      }
      if (path && trailingSlash) {
        path += "/";
      }
      return (isAbsolute ? "/" : "") + path;
    },
    dirname: function (path) {
      var result = PATH.splitPath(path),
        root = result[0],
        dir = result[1];
      if (!root && !dir) {
        return ".";
      }
      if (dir) {
        dir = dir.substr(0, dir.length - 1);
      }
      return root + dir;
    },
    basename: function (path) {
      if (path === "/") {
        return "/";
      }
      var lastSlash = path.lastIndexOf("/");
      if (lastSlash === -1) {
        return path;
      }
      return path.substr(lastSlash + 1);
    },
    extname: function (path) {
      return PATH.splitPath(path)[3];
    },
    join: function () {
      var paths = Array.prototype.slice.call(arguments, 0);
      return PATH.normalize(paths.join("/"));
    },
    join2: function (l, r) {
      return PATH.normalize(l + "/" + r);
    },
  };
  var SYSCALLS = {
    buffers: [null, [], []],
    printChar: function (stream, curr) {
      var buffer = SYSCALLS.buffers[stream];
      if (curr === 0 || curr === 10) {
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    },
    varargs: 0,
    get: function (varargs) {
      SYSCALLS.varargs += 4;
      var ret = HEAP32[(SYSCALLS.varargs - 4) >> 2];
      return ret;
    },
    getStr: function () {
      var ret = UTF8ToString(SYSCALLS.get());
      return ret;
    },
    get64: function () {
      var low = SYSCALLS.get(),
        high = SYSCALLS.get();
      return low;
    },
    getZero: function () {
      SYSCALLS.get();
    },
  };

  function ___syscall140(which, varargs) {
    SYSCALLS.varargs = varargs;
    try {
      var stream = SYSCALLS.getStreamFromFD(),
        offset_high = SYSCALLS.get(),
        offset_low = SYSCALLS.get(),
        result = SYSCALLS.get(),
        whence = SYSCALLS.get();
      return 0;
    } catch (e) {
      if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) {
        abort(e);
      }
      return -e.errno;
    }
  }

  function flush_NO_FILESYSTEM() {
    var fflush = Module["_fflush"];
    if (fflush) {
      fflush(0);
    }
    var buffers = SYSCALLS.buffers;
    if (buffers[1].length) {
      SYSCALLS.printChar(1, 10);
    }
    if (buffers[2].length) {
      SYSCALLS.printChar(2, 10);
    }
  }

  function ___syscall146(which, varargs) {
    SYSCALLS.varargs = varargs;
    try {
      var stream = SYSCALLS.get(),
        iov = SYSCALLS.get(),
        iovcnt = SYSCALLS.get();
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[(iov + i * 8) >> 2];
        var len = HEAP32[(iov + (i * 8 + 4)) >> 2];
        for (var j = 0; j < len; j++) {
          SYSCALLS.printChar(stream, HEAPU8[ptr + j]);
        }
        ret += len;
      }
      return ret;
    } catch (e) {
      if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) {
        abort(e);
      }
      return -e.errno;
    }
  }

  function ___syscall54(which, varargs) {
    SYSCALLS.varargs = varargs;
    try {
      return 0;
    } catch (e) {
      if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) {
        abort(e);
      }
      return -e.errno;
    }
  }

  function ___syscall6(which, varargs) {
    SYSCALLS.varargs = varargs;
    try {
      var stream = SYSCALLS.getStreamFromFD();
      return 0;
    } catch (e) {
      if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) {
        abort(e);
      }
      return -e.errno;
    }
  }

  function _abort() {
    Module["abort"]();
  }

  function _b2WorldBeginContactBody(contactPtr) {
    b2World.BeginContactBody(contactPtr);
  }

  function _b2WorldEndContactBody(contactPtr) {
    b2World.EndContactBody(contactPtr);
  }

  function _b2WorldPostSolve(contactPtr, impulsePtr) {
    b2World.PostSolve(contactPtr, impulsePtr);
  }

  function _b2WorldPreSolve(contactPtr, oldManifoldPtr) {
    b2World.PreSolve(contactPtr, oldManifoldPtr);
  }

  function _b2WorldQueryAABB(fixturePtr) {
    return b2World.QueryAABB(fixturePtr);
  }

  function _b2WorldRayCastCallback(
    fixturePtr,
    pointX,
    pointY,
    normalX,
    normalY,
    fraction
  ) {
    return b2World.RayCast(
      fixturePtr,
      pointX,
      pointY,
      normalX,
      normalY,
      fraction
    );
  }

  function _emscripten_get_heap_size() {
    return HEAP8.length;
  }

  function _llvm_trap() {
    abort("trap!");
  }

  function _emscripten_memcpy_big(dest, src, num) {
    HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
  }

  function ___setErrNo(value) {
    if (Module["___errno_location"]) {
      HEAP32[Module["___errno_location"]() >> 2] = value;
    }
    return value;
  }

  function abortOnCannotGrowMemory(requestedSize) {
    abort("OOM");
  }

  function emscripten_realloc_buffer(size) {
    var PAGE_MULTIPLE = 65536;
    size = alignUp(size, PAGE_MULTIPLE);
    var oldSize = buffer.byteLength;
    try {
      var result = wasmMemory.grow((size - oldSize) / 65536);
      if (result !== (-1 | 0)) {
        buffer = wasmMemory.buffer;
        return true;
      } else {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  function _emscripten_resize_heap(requestedSize) {
    var oldSize = _emscripten_get_heap_size();
    var PAGE_MULTIPLE = 65536;
    var LIMIT = 2147483648 - PAGE_MULTIPLE;
    if (requestedSize > LIMIT) {
      return false;
    }
    var MIN_TOTAL_MEMORY = 16777216;
    var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY);
    while (newSize < requestedSize) {
      if (newSize <= 536870912) {
        newSize = alignUp(2 * newSize, PAGE_MULTIPLE);
      } else {
        newSize = Math.min(
          alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE),
          LIMIT
        );
      }
    }
    if (!emscripten_realloc_buffer(newSize)) {
      return false;
    }
    updateGlobalBufferViews();
    return true;
  }
  var ASSERTIONS = false;
  var asmGlobalArg = {};
  var asmLibraryArg = {
    abort: abort,
    setTempRet0: setTempRet0,
    getTempRet0: getTempRet0,
    ___cxa_begin_catch: ___cxa_begin_catch,
    ___cxa_pure_virtual: ___cxa_pure_virtual,
    ___cxa_uncaught_exception: ___cxa_uncaught_exception,
    ___exception_addRef: ___exception_addRef,
    ___exception_deAdjust: ___exception_deAdjust,
    ___gxx_personality_v0: ___gxx_personality_v0,
    ___setErrNo: ___setErrNo,
    ___syscall140: ___syscall140,
    ___syscall146: ___syscall146,
    ___syscall54: ___syscall54,
    ___syscall6: ___syscall6,
    _abort: _abort,
    _b2WorldBeginContactBody: _b2WorldBeginContactBody,
    _b2WorldEndContactBody: _b2WorldEndContactBody,
    _b2WorldPostSolve: _b2WorldPostSolve,
    _b2WorldPreSolve: _b2WorldPreSolve,
    _b2WorldQueryAABB: _b2WorldQueryAABB,
    _b2WorldRayCastCallback: _b2WorldRayCastCallback,
    _emscripten_get_heap_size: _emscripten_get_heap_size,
    _emscripten_memcpy_big: _emscripten_memcpy_big,
    _emscripten_resize_heap: _emscripten_resize_heap,
    _llvm_trap: _llvm_trap,
    abortOnCannotGrowMemory: abortOnCannotGrowMemory,
    emscripten_realloc_buffer: emscripten_realloc_buffer,
    flush_NO_FILESYSTEM: flush_NO_FILESYSTEM,
    tempDoublePtr: tempDoublePtr,
    DYNAMICTOP_PTR: DYNAMICTOP_PTR,
  };
  var asm = Module["asm"](asmGlobalArg, asmLibraryArg, buffer);
  Module["asm"] = asm;
  var _GenerateOffsets = (Module["_GenerateOffsets"] = function () {
    return Module["asm"]["_GenerateOffsets"].apply(null, arguments);
  });
  var __ZSt18uncaught_exceptionv = (Module["__ZSt18uncaught_exceptionv"] =
    function () {
      return Module["asm"]["__ZSt18uncaught_exceptionv"].apply(null, arguments);
    });
  var ___cxa_can_catch = (Module["___cxa_can_catch"] = function () {
    return Module["asm"]["___cxa_can_catch"].apply(null, arguments);
  });
  var ___cxa_is_pointer_type = (Module["___cxa_is_pointer_type"] = function () {
    return Module["asm"]["___cxa_is_pointer_type"].apply(null, arguments);
  });
  var ___errno_location = (Module["___errno_location"] = function () {
    return Module["asm"]["___errno_location"].apply(null, arguments);
  });
  var _b2Body_ApplyAngularImpulse = (Module["_b2Body_ApplyAngularImpulse"] =
    function () {
      return Module["asm"]["_b2Body_ApplyAngularImpulse"].apply(
        null,
        arguments
      );
    });
  var _b2Body_ApplyForce = (Module["_b2Body_ApplyForce"] = function () {
    return Module["asm"]["_b2Body_ApplyForce"].apply(null, arguments);
  });
  var _b2Body_ApplyForceToCenter = (Module["_b2Body_ApplyForceToCenter"] =
    function () {
      return Module["asm"]["_b2Body_ApplyForceToCenter"].apply(null, arguments);
    });
  var _b2Body_ApplyLinearImpulse = (Module["_b2Body_ApplyLinearImpulse"] =
    function () {
      return Module["asm"]["_b2Body_ApplyLinearImpulse"].apply(null, arguments);
    });
  var _b2Body_ApplyTorque = (Module["_b2Body_ApplyTorque"] = function () {
    return Module["asm"]["_b2Body_ApplyTorque"].apply(null, arguments);
  });
  var _b2Body_DestroyFixture = (Module["_b2Body_DestroyFixture"] = function () {
    return Module["asm"]["_b2Body_DestroyFixture"].apply(null, arguments);
  });
  var _b2Body_GetAngle = (Module["_b2Body_GetAngle"] = function () {
    return Module["asm"]["_b2Body_GetAngle"].apply(null, arguments);
  });
  var _b2Body_GetAngularVelocity = (Module["_b2Body_GetAngularVelocity"] =
    function () {
      return Module["asm"]["_b2Body_GetAngularVelocity"].apply(null, arguments);
    });
  var _b2Body_GetGravityScale = (Module["_b2Body_GetGravityScale"] =
    function () {
      return Module["asm"]["_b2Body_GetGravityScale"].apply(null, arguments);
    });
  var _b2Body_GetInertia = (Module["_b2Body_GetInertia"] = function () {
    return Module["asm"]["_b2Body_GetInertia"].apply(null, arguments);
  });
  var _b2Body_GetLinearVelocity = (Module["_b2Body_GetLinearVelocity"] =
    function () {
      return Module["asm"]["_b2Body_GetLinearVelocity"].apply(null, arguments);
    });
  var _b2Body_GetLinearVelocityFromWorldPoint = (Module[
    "_b2Body_GetLinearVelocityFromWorldPoint"
  ] = function () {
    return Module["asm"]["_b2Body_GetLinearVelocityFromWorldPoint"].apply(
      null,
      arguments
    );
  });
  var _b2Body_GetLocalPoint = (Module["_b2Body_GetLocalPoint"] = function () {
    return Module["asm"]["_b2Body_GetLocalPoint"].apply(null, arguments);
  });
  var _b2Body_GetLocalVector = (Module["_b2Body_GetLocalVector"] = function () {
    return Module["asm"]["_b2Body_GetLocalVector"].apply(null, arguments);
  });
  var _b2Body_GetMass = (Module["_b2Body_GetMass"] = function () {
    return Module["asm"]["_b2Body_GetMass"].apply(null, arguments);
  });
  var _b2Body_GetPosition = (Module["_b2Body_GetPosition"] = function () {
    return Module["asm"]["_b2Body_GetPosition"].apply(null, arguments);
  });
  var _b2Body_GetTransform = (Module["_b2Body_GetTransform"] = function () {
    return Module["asm"]["_b2Body_GetTransform"].apply(null, arguments);
  });
  var _b2Body_GetType = (Module["_b2Body_GetType"] = function () {
    return Module["asm"]["_b2Body_GetType"].apply(null, arguments);
  });
  var _b2Body_GetWorldCenter = (Module["_b2Body_GetWorldCenter"] = function () {
    return Module["asm"]["_b2Body_GetWorldCenter"].apply(null, arguments);
  });
  var _b2Body_GetWorldPoint = (Module["_b2Body_GetWorldPoint"] = function () {
    return Module["asm"]["_b2Body_GetWorldPoint"].apply(null, arguments);
  });
  var _b2Body_GetWorldVector = (Module["_b2Body_GetWorldVector"] = function () {
    return Module["asm"]["_b2Body_GetWorldVector"].apply(null, arguments);
  });
  var _b2Body_IsAwake = (Module["_b2Body_IsAwake"] = function () {
    return Module["asm"]["_b2Body_IsAwake"].apply(null, arguments);
  });
  var _b2Body_ResetMassData = (Module["_b2Body_ResetMassData"] = function () {
    return Module["asm"]["_b2Body_ResetMassData"].apply(null, arguments);
  });
  var _b2Body_SetAngularVelocity = (Module["_b2Body_SetAngularVelocity"] =
    function () {
      return Module["asm"]["_b2Body_SetAngularVelocity"].apply(null, arguments);
    });
  var _b2Body_SetAwake = (Module["_b2Body_SetAwake"] = function () {
    return Module["asm"]["_b2Body_SetAwake"].apply(null, arguments);
  });
  var _b2Body_SetBullet = (Module["_b2Body_SetBullet"] = function () {
    return Module["asm"]["_b2Body_SetBullet"].apply(null, arguments);
  });
  var _b2Body_SetFixedRotation = (Module["_b2Body_SetFixedRotation"] =
    function () {
      return Module["asm"]["_b2Body_SetFixedRotation"].apply(null, arguments);
    });
  var _b2Body_SetGravityScale = (Module["_b2Body_SetGravityScale"] =
    function () {
      return Module["asm"]["_b2Body_SetGravityScale"].apply(null, arguments);
    });
  var _b2Body_SetLinearDamping = (Module["_b2Body_SetLinearDamping"] =
    function () {
      return Module["asm"]["_b2Body_SetLinearDamping"].apply(null, arguments);
    });
  var _b2Body_SetLinearVelocity = (Module["_b2Body_SetLinearVelocity"] =
    function () {
      return Module["asm"]["_b2Body_SetLinearVelocity"].apply(null, arguments);
    });
  var _b2Body_SetMassData = (Module["_b2Body_SetMassData"] = function () {
    return Module["asm"]["_b2Body_SetMassData"].apply(null, arguments);
  });
  var _b2Body_SetSleepingAllowed = (Module["_b2Body_SetSleepingAllowed"] =
    function () {
      return Module["asm"]["_b2Body_SetSleepingAllowed"].apply(null, arguments);
    });
  var _b2Body_SetTransform = (Module["_b2Body_SetTransform"] = function () {
    return Module["asm"]["_b2Body_SetTransform"].apply(null, arguments);
  });
  var _b2Body_SetType = (Module["_b2Body_SetType"] = function () {
    return Module["asm"]["_b2Body_SetType"].apply(null, arguments);
  });
  var _b2ChainShape_CreateFixture = (Module["_b2ChainShape_CreateFixture"] =
    function () {
      return Module["asm"]["_b2ChainShape_CreateFixture"].apply(
        null,
        arguments
      );
    });
  var _b2CircleShape_CreateFixture = (Module["_b2CircleShape_CreateFixture"] =
    function () {
      return Module["asm"]["_b2CircleShape_CreateFixture"].apply(
        null,
        arguments
      );
    });
  var _b2CircleShape_CreateParticleGroup = (Module[
    "_b2CircleShape_CreateParticleGroup"
  ] = function () {
    return Module["asm"]["_b2CircleShape_CreateParticleGroup"].apply(
      null,
      arguments
    );
  });
  var _b2CircleShape_DestroyParticlesInShape = (Module[
    "_b2CircleShape_DestroyParticlesInShape"
  ] = function () {
    return Module["asm"]["_b2CircleShape_DestroyParticlesInShape"].apply(
      null,
      arguments
    );
  });
  var _b2Contact_GetManifold = (Module["_b2Contact_GetManifold"] = function () {
    return Module["asm"]["_b2Contact_GetManifold"].apply(null, arguments);
  });
  var _b2Contact_GetWorldManifold = (Module["_b2Contact_GetWorldManifold"] =
    function () {
      return Module["asm"]["_b2Contact_GetWorldManifold"].apply(
        null,
        arguments
      );
    });
  var _b2DistanceJointDef_Create = (Module["_b2DistanceJointDef_Create"] =
    function () {
      return Module["asm"]["_b2DistanceJointDef_Create"].apply(null, arguments);
    });
  var _b2DistanceJointDef_InitializeAndCreate = (Module[
    "_b2DistanceJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2DistanceJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2DistanceJoint_GetReactionForce = (Module[
    "_b2DistanceJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2DistanceJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2DistanceJoint_GetReactionTorque = (Module[
    "_b2DistanceJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2DistanceJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2DistanceJoint_SetDampingRatio = (Module[
    "_b2DistanceJoint_SetDampingRatio"
  ] = function () {
    return Module["asm"]["_b2DistanceJoint_SetDampingRatio"].apply(
      null,
      arguments
    );
  });
  var _b2DistanceJoint_SetFrequency = (Module["_b2DistanceJoint_SetFrequency"] =
    function () {
      return Module["asm"]["_b2DistanceJoint_SetFrequency"].apply(
        null,
        arguments
      );
    });
  var _b2DistanceJoint_SetLength = (Module["_b2DistanceJoint_SetLength"] =
    function () {
      return Module["asm"]["_b2DistanceJoint_SetLength"].apply(null, arguments);
    });
  var _b2EdgeShape_CreateFixture = (Module["_b2EdgeShape_CreateFixture"] =
    function () {
      return Module["asm"]["_b2EdgeShape_CreateFixture"].apply(null, arguments);
    });
  var _b2Fixture_Refilter = (Module["_b2Fixture_Refilter"] = function () {
    return Module["asm"]["_b2Fixture_Refilter"].apply(null, arguments);
  });
  var _b2Fixture_SetDensity = (Module["_b2Fixture_SetDensity"] = function () {
    return Module["asm"]["_b2Fixture_SetDensity"].apply(null, arguments);
  });
  var _b2Fixture_SetFriction = (Module["_b2Fixture_SetFriction"] = function () {
    return Module["asm"]["_b2Fixture_SetFriction"].apply(null, arguments);
  });
  var _b2Fixture_SetRestitution = (Module["_b2Fixture_SetRestitution"] =
    function () {
      return Module["asm"]["_b2Fixture_SetRestitution"].apply(null, arguments);
    });
  var _b2Fixture_SetSensor = (Module["_b2Fixture_SetSensor"] = function () {
    return Module["asm"]["_b2Fixture_SetSensor"].apply(null, arguments);
  });
  var _b2Fixture_TestPoint = (Module["_b2Fixture_TestPoint"] = function () {
    return Module["asm"]["_b2Fixture_TestPoint"].apply(null, arguments);
  });
  var _b2FrictionJointDef_Create = (Module["_b2FrictionJointDef_Create"] =
    function () {
      return Module["asm"]["_b2FrictionJointDef_Create"].apply(null, arguments);
    });
  var _b2FrictionJointDef_InitializeAndCreate = (Module[
    "_b2FrictionJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2FrictionJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2FrictionJoint_GetReactionForce = (Module[
    "_b2FrictionJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2FrictionJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2FrictionJoint_GetReactionTorque = (Module[
    "_b2FrictionJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2FrictionJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2FrictionJoint_SetMaxForce = (Module["_b2FrictionJoint_SetMaxForce"] =
    function () {
      return Module["asm"]["_b2FrictionJoint_SetMaxForce"].apply(
        null,
        arguments
      );
    });
  var _b2FrictionJoint_SetMaxTorque = (Module["_b2FrictionJoint_SetMaxTorque"] =
    function () {
      return Module["asm"]["_b2FrictionJoint_SetMaxTorque"].apply(
        null,
        arguments
      );
    });
  var _b2GearJointDef_Create = (Module["_b2GearJointDef_Create"] = function () {
    return Module["asm"]["_b2GearJointDef_Create"].apply(null, arguments);
  });
  var _b2GearJoint_GetRatio = (Module["_b2GearJoint_GetRatio"] = function () {
    return Module["asm"]["_b2GearJoint_GetRatio"].apply(null, arguments);
  });
  var _b2GearJoint_GetReactionForce = (Module["_b2GearJoint_GetReactionForce"] =
    function () {
      return Module["asm"]["_b2GearJoint_GetReactionForce"].apply(
        null,
        arguments
      );
    });
  var _b2GearJoint_GetReactionTorque = (Module[
    "_b2GearJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2GearJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2Joint_GetBodyA = (Module["_b2Joint_GetBodyA"] = function () {
    return Module["asm"]["_b2Joint_GetBodyA"].apply(null, arguments);
  });
  var _b2Joint_GetBodyB = (Module["_b2Joint_GetBodyB"] = function () {
    return Module["asm"]["_b2Joint_GetBodyB"].apply(null, arguments);
  });
  var _b2Manifold_GetPointCount = (Module["_b2Manifold_GetPointCount"] =
    function () {
      return Module["asm"]["_b2Manifold_GetPointCount"].apply(null, arguments);
    });
  var _b2MotorJointDef_Create = (Module["_b2MotorJointDef_Create"] =
    function () {
      return Module["asm"]["_b2MotorJointDef_Create"].apply(null, arguments);
    });
  var _b2MotorJointDef_InitializeAndCreate = (Module[
    "_b2MotorJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2MotorJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2MotorJoint_GetReactionForce = (Module[
    "_b2MotorJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2MotorJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2MotorJoint_GetReactionTorque = (Module[
    "_b2MotorJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2MotorJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2MotorJoint_SetAngularOffset = (Module[
    "_b2MotorJoint_SetAngularOffset"
  ] = function () {
    return Module["asm"]["_b2MotorJoint_SetAngularOffset"].apply(
      null,
      arguments
    );
  });
  var _b2MotorJoint_SetLinearOffset = (Module["_b2MotorJoint_SetLinearOffset"] =
    function () {
      return Module["asm"]["_b2MotorJoint_SetLinearOffset"].apply(
        null,
        arguments
      );
    });
  var _b2MouseJointDef_Create = (Module["_b2MouseJointDef_Create"] =
    function () {
      return Module["asm"]["_b2MouseJointDef_Create"].apply(null, arguments);
    });
  var _b2MouseJoint_SetTarget = (Module["_b2MouseJoint_SetTarget"] =
    function () {
      return Module["asm"]["_b2MouseJoint_SetTarget"].apply(null, arguments);
    });
  var _b2ParticleGroup_ApplyForce = (Module["_b2ParticleGroup_ApplyForce"] =
    function () {
      return Module["asm"]["_b2ParticleGroup_ApplyForce"].apply(
        null,
        arguments
      );
    });
  var _b2ParticleGroup_ApplyLinearImpulse = (Module[
    "_b2ParticleGroup_ApplyLinearImpulse"
  ] = function () {
    return Module["asm"]["_b2ParticleGroup_ApplyLinearImpulse"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleGroup_DestroyParticles = (Module[
    "_b2ParticleGroup_DestroyParticles"
  ] = function () {
    return Module["asm"]["_b2ParticleGroup_DestroyParticles"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleGroup_GetBufferIndex = (Module[
    "_b2ParticleGroup_GetBufferIndex"
  ] = function () {
    return Module["asm"]["_b2ParticleGroup_GetBufferIndex"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleGroup_GetParticleCount = (Module[
    "_b2ParticleGroup_GetParticleCount"
  ] = function () {
    return Module["asm"]["_b2ParticleGroup_GetParticleCount"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_CreateParticle = (Module[
    "_b2ParticleSystem_CreateParticle"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_CreateParticle"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_DestroyParticle = (Module[
    "_b2ParticleSystem_DestroyParticle"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_DestroyParticle"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetArrayOfHandleUids = (Module[
    "_b2ParticleSystem_GetArrayOfHandleUids"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetArrayOfHandleUids"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetColorBuffer = (Module[
    "_b2ParticleSystem_GetColorBuffer"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetColorBuffer"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetGroupBufferBoundaries = (Module[
    "_b2ParticleSystem_GetGroupBufferBoundaries"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetGroupBufferBoundaries"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetParticleCount = (Module[
    "_b2ParticleSystem_GetParticleCount"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetParticleCount"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetParticleFlags = (Module[
    "_b2ParticleSystem_GetParticleFlags"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetParticleFlags"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetParticleHandleFromIndex = (Module[
    "_b2ParticleSystem_GetParticleHandleFromIndex"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetParticleHandleFromIndex"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetParticleIndexFromHandle = (Module[
    "_b2ParticleSystem_GetParticleIndexFromHandle"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetParticleIndexFromHandle"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetParticleLifetime = (Module[
    "_b2ParticleSystem_GetParticleLifetime"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetParticleLifetime"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetPositionBuffer = (Module[
    "_b2ParticleSystem_GetPositionBuffer"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetPositionBuffer"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetUserDataBuffer = (Module[
    "_b2ParticleSystem_GetUserDataBuffer"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetUserDataBuffer"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_GetVelocityBuffer = (Module[
    "_b2ParticleSystem_GetVelocityBuffer"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_GetVelocityBuffer"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_ParticleApplyForce = (Module[
    "_b2ParticleSystem_ParticleApplyForce"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_ParticleApplyForce"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_ParticleApplyLinearImpulse = (Module[
    "_b2ParticleSystem_ParticleApplyLinearImpulse"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_ParticleApplyLinearImpulse"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetAllParticleFlags = (Module[
    "_b2ParticleSystem_SetAllParticleFlags"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetAllParticleFlags"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetColorMixingStrength = (Module[
    "_b2ParticleSystem_SetColorMixingStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetColorMixingStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetDamping = (Module["_b2ParticleSystem_SetDamping"] =
    function () {
      return Module["asm"]["_b2ParticleSystem_SetDamping"].apply(
        null,
        arguments
      );
    });
  var _b2ParticleSystem_SetDensity = (Module["_b2ParticleSystem_SetDensity"] =
    function () {
      return Module["asm"]["_b2ParticleSystem_SetDensity"].apply(
        null,
        arguments
      );
    });
  var _b2ParticleSystem_SetEjectionStrength = (Module[
    "_b2ParticleSystem_SetEjectionStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetEjectionStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetElasticStrength = (Module[
    "_b2ParticleSystem_SetElasticStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetElasticStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetGravityScale = (Module[
    "_b2ParticleSystem_SetGravityScale"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetGravityScale"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetGroupParticleFlags = (Module[
    "_b2ParticleSystem_SetGroupParticleFlags"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetGroupParticleFlags"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetLifetimeGranularity = (Module[
    "_b2ParticleSystem_SetLifetimeGranularity"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetLifetimeGranularity"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetMaxParticleCount = (Module[
    "_b2ParticleSystem_SetMaxParticleCount"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetMaxParticleCount"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetParticleColor = (Module[
    "_b2ParticleSystem_SetParticleColor"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetParticleColor"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetParticleFlags = (Module[
    "_b2ParticleSystem_SetParticleFlags"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetParticleFlags"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetParticleLifetime = (Module[
    "_b2ParticleSystem_SetParticleLifetime"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetParticleLifetime"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetPaused = (Module["_b2ParticleSystem_SetPaused"] =
    function () {
      return Module["asm"]["_b2ParticleSystem_SetPaused"].apply(
        null,
        arguments
      );
    });
  var _b2ParticleSystem_SetPowderStrength = (Module[
    "_b2ParticleSystem_SetPowderStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetPowderStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetPressureStrength = (Module[
    "_b2ParticleSystem_SetPressureStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetPressureStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetRadius = (Module["_b2ParticleSystem_SetRadius"] =
    function () {
      return Module["asm"]["_b2ParticleSystem_SetRadius"].apply(
        null,
        arguments
      );
    });
  var _b2ParticleSystem_SetRepulsiveStrength = (Module[
    "_b2ParticleSystem_SetRepulsiveStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetRepulsiveStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetSpringStrength = (Module[
    "_b2ParticleSystem_SetSpringStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetSpringStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetStaticPressureIterations = (Module[
    "_b2ParticleSystem_SetStaticPressureIterations"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetStaticPressureIterations"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetStaticPressureRelaxation = (Module[
    "_b2ParticleSystem_SetStaticPressureRelaxation"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetStaticPressureRelaxation"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetStaticPressureStrength = (Module[
    "_b2ParticleSystem_SetStaticPressureStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetStaticPressureStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetStrictContactCheck = (Module[
    "_b2ParticleSystem_SetStrictContactCheck"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetStrictContactCheck"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetTensileSmoothing = (Module[
    "_b2ParticleSystem_SetTensileSmoothing"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetTensileSmoothing"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetTensileTension = (Module[
    "_b2ParticleSystem_SetTensileTension"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetTensileTension"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SetViscousStrength = (Module[
    "_b2ParticleSystem_SetViscousStrength"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SetViscousStrength"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SwitchOneParticleFlag = (Module[
    "_b2ParticleSystem_SwitchOneParticleFlag"
  ] = function () {
    return Module["asm"]["_b2ParticleSystem_SwitchOneParticleFlag"].apply(
      null,
      arguments
    );
  });
  var _b2ParticleSystem_SwitchOneParticleFlagInGroup = (Module[
    "_b2ParticleSystem_SwitchOneParticleFlagInGroup"
  ] = function () {
    return Module["asm"][
      "_b2ParticleSystem_SwitchOneParticleFlagInGroup"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateFixture_3 = (Module[
    "_b2PolygonShape_CreateFixture_3"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_3"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateFixture_4 = (Module[
    "_b2PolygonShape_CreateFixture_4"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_4"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateFixture_5 = (Module[
    "_b2PolygonShape_CreateFixture_5"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_5"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateFixture_6 = (Module[
    "_b2PolygonShape_CreateFixture_6"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_6"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateFixture_7 = (Module[
    "_b2PolygonShape_CreateFixture_7"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_7"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateFixture_8 = (Module[
    "_b2PolygonShape_CreateFixture_8"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_CreateFixture_8"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_3 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_3"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_3"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_4 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_4"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_4"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_5 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_5"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_5"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_6 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_6"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_6"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_7 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_7"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_7"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_CreateParticleGroupInPolygon_8 = (Module[
    "_b2PolygonShape_CreateParticleGroupInPolygon_8"
  ] = function () {
    return Module["asm"][
      "_b2PolygonShape_CreateParticleGroupInPolygon_8"
    ].apply(null, arguments);
  });
  var _b2PolygonShape_DestroyParticlesInShape_3 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_3"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_3"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_DestroyParticlesInShape_4 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_4"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_4"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_DestroyParticlesInShape_5 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_5"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_5"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_DestroyParticlesInShape_6 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_6"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_6"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_DestroyParticlesInShape_7 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_7"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_7"].apply(
      null,
      arguments
    );
  });
  var _b2PolygonShape_DestroyParticlesInShape_8 = (Module[
    "_b2PolygonShape_DestroyParticlesInShape_8"
  ] = function () {
    return Module["asm"]["_b2PolygonShape_DestroyParticlesInShape_8"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJointDef_Create = (Module["_b2PrismaticJointDef_Create"] =
    function () {
      return Module["asm"]["_b2PrismaticJointDef_Create"].apply(
        null,
        arguments
      );
    });
  var _b2PrismaticJointDef_InitializeAndCreate = (Module[
    "_b2PrismaticJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2PrismaticJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_EnableLimit = (Module["_b2PrismaticJoint_EnableLimit"] =
    function () {
      return Module["asm"]["_b2PrismaticJoint_EnableLimit"].apply(
        null,
        arguments
      );
    });
  var _b2PrismaticJoint_EnableMotor = (Module["_b2PrismaticJoint_EnableMotor"] =
    function () {
      return Module["asm"]["_b2PrismaticJoint_EnableMotor"].apply(
        null,
        arguments
      );
    });
  var _b2PrismaticJoint_GetJointTranslation = (Module[
    "_b2PrismaticJoint_GetJointTranslation"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_GetJointTranslation"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_GetMotorForce = (Module[
    "_b2PrismaticJoint_GetMotorForce"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_GetMotorForce"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_GetMotorSpeed = (Module[
    "_b2PrismaticJoint_GetMotorSpeed"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_GetMotorSpeed"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_GetReactionForce = (Module[
    "_b2PrismaticJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_GetReactionTorque = (Module[
    "_b2PrismaticJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_IsLimitEnabled = (Module[
    "_b2PrismaticJoint_IsLimitEnabled"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_IsLimitEnabled"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_IsMotorEnabled = (Module[
    "_b2PrismaticJoint_IsMotorEnabled"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_IsMotorEnabled"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_SetLimits = (Module["_b2PrismaticJoint_SetLimits"] =
    function () {
      return Module["asm"]["_b2PrismaticJoint_SetLimits"].apply(
        null,
        arguments
      );
    });
  var _b2PrismaticJoint_SetLocalAxisA = (Module[
    "_b2PrismaticJoint_SetLocalAxisA"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_SetLocalAxisA"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_SetMaxMotorForce = (Module[
    "_b2PrismaticJoint_SetMaxMotorForce"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_SetMaxMotorForce"].apply(
      null,
      arguments
    );
  });
  var _b2PrismaticJoint_SetMotorSpeed = (Module[
    "_b2PrismaticJoint_SetMotorSpeed"
  ] = function () {
    return Module["asm"]["_b2PrismaticJoint_SetMotorSpeed"].apply(
      null,
      arguments
    );
  });
  var _b2PulleyJointDef_Create = (Module["_b2PulleyJointDef_Create"] =
    function () {
      return Module["asm"]["_b2PulleyJointDef_Create"].apply(null, arguments);
    });
  var _b2PulleyJointDef_InitializeAndCreate = (Module[
    "_b2PulleyJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2PulleyJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2PulleyJoint_GetReactionForce = (Module[
    "_b2PulleyJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2PulleyJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2PulleyJoint_GetReactionTorque = (Module[
    "_b2PulleyJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2PulleyJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJointDef_Create = (Module["_b2RevoluteJointDef_Create"] =
    function () {
      return Module["asm"]["_b2RevoluteJointDef_Create"].apply(null, arguments);
    });
  var _b2RevoluteJointDef_InitializeAndCreate = (Module[
    "_b2RevoluteJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2RevoluteJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_EnableLimit = (Module["_b2RevoluteJoint_EnableLimit"] =
    function () {
      return Module["asm"]["_b2RevoluteJoint_EnableLimit"].apply(
        null,
        arguments
      );
    });
  var _b2RevoluteJoint_EnableMotor = (Module["_b2RevoluteJoint_EnableMotor"] =
    function () {
      return Module["asm"]["_b2RevoluteJoint_EnableMotor"].apply(
        null,
        arguments
      );
    });
  var _b2RevoluteJoint_GetJointAngle = (Module[
    "_b2RevoluteJoint_GetJointAngle"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_GetJointAngle"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_GetJointSpeed = (Module[
    "_b2RevoluteJoint_GetJointSpeed"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_GetJointSpeed"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_GetMotorTorque = (Module[
    "_b2RevoluteJoint_GetMotorTorque"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_GetMotorTorque"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_GetReactionForce = (Module[
    "_b2RevoluteJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_GetReactionTorque = (Module[
    "_b2RevoluteJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_IsLimitEnabled = (Module[
    "_b2RevoluteJoint_IsLimitEnabled"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_IsLimitEnabled"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_IsMotorEnabled = (Module[
    "_b2RevoluteJoint_IsMotorEnabled"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_IsMotorEnabled"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_SetLimits = (Module["_b2RevoluteJoint_SetLimits"] =
    function () {
      return Module["asm"]["_b2RevoluteJoint_SetLimits"].apply(null, arguments);
    });
  var _b2RevoluteJoint_SetMaxMotorTorque = (Module[
    "_b2RevoluteJoint_SetMaxMotorTorque"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_SetMaxMotorTorque"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_SetMotorSpeed = (Module[
    "_b2RevoluteJoint_SetMotorSpeed"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_SetMotorSpeed"].apply(
      null,
      arguments
    );
  });
  var _b2RevoluteJoint_SetReferenceAngle = (Module[
    "_b2RevoluteJoint_SetReferenceAngle"
  ] = function () {
    return Module["asm"]["_b2RevoluteJoint_SetReferenceAngle"].apply(
      null,
      arguments
    );
  });
  var _b2RopeJointDef_Create = (Module["_b2RopeJointDef_Create"] = function () {
    return Module["asm"]["_b2RopeJointDef_Create"].apply(null, arguments);
  });
  var _b2RopeJoint_GetReactionForce = (Module["_b2RopeJoint_GetReactionForce"] =
    function () {
      return Module["asm"]["_b2RopeJoint_GetReactionForce"].apply(
        null,
        arguments
      );
    });
  var _b2RopeJoint_GetReactionTorque = (Module[
    "_b2RopeJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2RopeJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2RopeJoint_SetMaxLength = (Module["_b2RopeJoint_SetMaxLength"] =
    function () {
      return Module["asm"]["_b2RopeJoint_SetMaxLength"].apply(null, arguments);
    });
  var _b2WeldJointDef_Create = (Module["_b2WeldJointDef_Create"] = function () {
    return Module["asm"]["_b2WeldJointDef_Create"].apply(null, arguments);
  });
  var _b2WeldJointDef_InitializeAndCreate = (Module[
    "_b2WeldJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2WeldJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2WeldJoint_GetReactionForce = (Module["_b2WeldJoint_GetReactionForce"] =
    function () {
      return Module["asm"]["_b2WeldJoint_GetReactionForce"].apply(
        null,
        arguments
      );
    });
  var _b2WeldJoint_GetReactionTorque = (Module[
    "_b2WeldJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2WeldJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJointDef_Create = (Module["_b2WheelJointDef_Create"] =
    function () {
      return Module["asm"]["_b2WheelJointDef_Create"].apply(null, arguments);
    });
  var _b2WheelJointDef_InitializeAndCreate = (Module[
    "_b2WheelJointDef_InitializeAndCreate"
  ] = function () {
    return Module["asm"]["_b2WheelJointDef_InitializeAndCreate"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJoint_EnableMotor = (Module["_b2WheelJoint_EnableMotor"] =
    function () {
      return Module["asm"]["_b2WheelJoint_EnableMotor"].apply(null, arguments);
    });
  var _b2WheelJoint_GetMotorTorque = (Module["_b2WheelJoint_GetMotorTorque"] =
    function () {
      return Module["asm"]["_b2WheelJoint_GetMotorTorque"].apply(
        null,
        arguments
      );
    });
  var _b2WheelJoint_GetReactionForce = (Module[
    "_b2WheelJoint_GetReactionForce"
  ] = function () {
    return Module["asm"]["_b2WheelJoint_GetReactionForce"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJoint_GetReactionTorque = (Module[
    "_b2WheelJoint_GetReactionTorque"
  ] = function () {
    return Module["asm"]["_b2WheelJoint_GetReactionTorque"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJoint_SetMaxMotorTorque = (Module[
    "_b2WheelJoint_SetMaxMotorTorque"
  ] = function () {
    return Module["asm"]["_b2WheelJoint_SetMaxMotorTorque"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJoint_SetMotorSpeed = (Module["_b2WheelJoint_SetMotorSpeed"] =
    function () {
      return Module["asm"]["_b2WheelJoint_SetMotorSpeed"].apply(
        null,
        arguments
      );
    });
  var _b2WheelJoint_SetSpringDampingRatio = (Module[
    "_b2WheelJoint_SetSpringDampingRatio"
  ] = function () {
    return Module["asm"]["_b2WheelJoint_SetSpringDampingRatio"].apply(
      null,
      arguments
    );
  });
  var _b2WheelJoint_SetSpringFrequencyHz = (Module[
    "_b2WheelJoint_SetSpringFrequencyHz"
  ] = function () {
    return Module["asm"]["_b2WheelJoint_SetSpringFrequencyHz"].apply(
      null,
      arguments
    );
  });
  var _b2World_Create = (Module["_b2World_Create"] = function () {
    return Module["asm"]["_b2World_Create"].apply(null, arguments);
  });
  var _b2World_CreateBody = (Module["_b2World_CreateBody"] = function () {
    return Module["asm"]["_b2World_CreateBody"].apply(null, arguments);
  });
  var _b2World_CreateParticleSystem = (Module["_b2World_CreateParticleSystem"] =
    function () {
      return Module["asm"]["_b2World_CreateParticleSystem"].apply(
        null,
        arguments
      );
    });
  var _b2World_Delete = (Module["_b2World_Delete"] = function () {
    return Module["asm"]["_b2World_Delete"].apply(null, arguments);
  });
  var _b2World_DestroyBody = (Module["_b2World_DestroyBody"] = function () {
    return Module["asm"]["_b2World_DestroyBody"].apply(null, arguments);
  });
  var _b2World_DestroyJoint = (Module["_b2World_DestroyJoint"] = function () {
    return Module["asm"]["_b2World_DestroyJoint"].apply(null, arguments);
  });
  var _b2World_DestroyParticleSystem = (Module[
    "_b2World_DestroyParticleSystem"
  ] = function () {
    return Module["asm"]["_b2World_DestroyParticleSystem"].apply(
      null,
      arguments
    );
  });
  var _b2World_DestroyWorld = (Module["_b2World_DestroyWorld"] = function () {
    return Module["asm"]["_b2World_DestroyWorld"].apply(null, arguments);
  });
  var _b2World_QueryAABB = (Module["_b2World_QueryAABB"] = function () {
    return Module["asm"]["_b2World_QueryAABB"].apply(null, arguments);
  });
  var _b2World_RayCast = (Module["_b2World_RayCast"] = function () {
    return Module["asm"]["_b2World_RayCast"].apply(null, arguments);
  });
  var _b2World_SetContactListener = (Module["_b2World_SetContactListener"] =
    function () {
      return Module["asm"]["_b2World_SetContactListener"].apply(
        null,
        arguments
      );
    });
  var _b2World_SetGravity = (Module["_b2World_SetGravity"] = function () {
    return Module["asm"]["_b2World_SetGravity"].apply(null, arguments);
  });
  var _b2World_Step = (Module["_b2World_Step"] = function () {
    return Module["asm"]["_b2World_Step"].apply(null, arguments);
  });
  var _emscripten_replace_memory = (Module["_emscripten_replace_memory"] =
    function () {
      return Module["asm"]["_emscripten_replace_memory"].apply(null, arguments);
    });
  var _free = (Module["_free"] = function () {
    return Module["asm"]["_free"].apply(null, arguments);
  });
  var _malloc = (Module["_malloc"] = function () {
    return Module["asm"]["_malloc"].apply(null, arguments);
  });
  var _memcpy = (Module["_memcpy"] = function () {
    return Module["asm"]["_memcpy"].apply(null, arguments);
  });
  var _memmove = (Module["_memmove"] = function () {
    return Module["asm"]["_memmove"].apply(null, arguments);
  });
  var _memset = (Module["_memset"] = function () {
    return Module["asm"]["_memset"].apply(null, arguments);
  });
  var _sbrk = (Module["_sbrk"] = function () {
    return Module["asm"]["_sbrk"].apply(null, arguments);
  });
  var establishStackSpace = (Module["establishStackSpace"] = function () {
    return Module["asm"]["establishStackSpace"].apply(null, arguments);
  });
  var stackAlloc = (Module["stackAlloc"] = function () {
    return Module["asm"]["stackAlloc"].apply(null, arguments);
  });
  var stackRestore = (Module["stackRestore"] = function () {
    return Module["asm"]["stackRestore"].apply(null, arguments);
  });
  var stackSave = (Module["stackSave"] = function () {
    return Module["asm"]["stackSave"].apply(null, arguments);
  });
  var dynCall_fif = (Module["dynCall_fif"] = function () {
    return Module["asm"]["dynCall_fif"].apply(null, arguments);
  });
  var dynCall_fiiiif = (Module["dynCall_fiiiif"] = function () {
    return Module["asm"]["dynCall_fiiiif"].apply(null, arguments);
  });
  var dynCall_fiiiiif = (Module["dynCall_fiiiiif"] = function () {
    return Module["asm"]["dynCall_fiiiiif"].apply(null, arguments);
  });
  var dynCall_ii = (Module["dynCall_ii"] = function () {
    return Module["asm"]["dynCall_ii"].apply(null, arguments);
  });
  var dynCall_iidiiii = (Module["dynCall_iidiiii"] = function () {
    return Module["asm"]["dynCall_iidiiii"].apply(null, arguments);
  });
  var dynCall_iii = (Module["dynCall_iii"] = function () {
    return Module["asm"]["dynCall_iii"].apply(null, arguments);
  });
  var dynCall_iiii = (Module["dynCall_iiii"] = function () {
    return Module["asm"]["dynCall_iiii"].apply(null, arguments);
  });
  var dynCall_iiiii = (Module["dynCall_iiiii"] = function () {
    return Module["asm"]["dynCall_iiiii"].apply(null, arguments);
  });
  var dynCall_iiiiii = (Module["dynCall_iiiiii"] = function () {
    return Module["asm"]["dynCall_iiiiii"].apply(null, arguments);
  });
  var dynCall_jiji = (Module["dynCall_jiji"] = function () {
    return Module["asm"]["dynCall_jiji"].apply(null, arguments);
  });
  var dynCall_v = (Module["dynCall_v"] = function () {
    return Module["asm"]["dynCall_v"].apply(null, arguments);
  });
  var dynCall_vi = (Module["dynCall_vi"] = function () {
    return Module["asm"]["dynCall_vi"].apply(null, arguments);
  });
  var dynCall_vii = (Module["dynCall_vii"] = function () {
    return Module["asm"]["dynCall_vii"].apply(null, arguments);
  });
  var dynCall_viif = (Module["dynCall_viif"] = function () {
    return Module["asm"]["dynCall_viif"].apply(null, arguments);
  });
  var dynCall_viii = (Module["dynCall_viii"] = function () {
    return Module["asm"]["dynCall_viii"].apply(null, arguments);
  });
  var dynCall_viiii = (Module["dynCall_viiii"] = function () {
    return Module["asm"]["dynCall_viiii"].apply(null, arguments);
  });
  var dynCall_viiiii = (Module["dynCall_viiiii"] = function () {
    return Module["asm"]["dynCall_viiiii"].apply(null, arguments);
  });
  var dynCall_viiiiii = (Module["dynCall_viiiiii"] = function () {
    return Module["asm"]["dynCall_viiiiii"].apply(null, arguments);
  });
  Module["asm"] = asm;
  Module["cwrap"] = cwrap;

  function ExitStatus(status) {
    this.name = "ExitStatus";
    this.message = "Program terminated with exit(" + status + ")";
    this.status = status;
  }
  ExitStatus.prototype = new Error();
  ExitStatus.prototype.constructor = ExitStatus;
  dependenciesFulfilled = function runCaller() {
    if (!Module["calledRun"]) {
      run();
    }
    if (!Module["calledRun"]) {
      dependenciesFulfilled = runCaller;
    }
  };

  function run(args) {
    args = args || Module["arguments"];
    if (runDependencies > 0) {
      return;
    }
    preRun();
    if (runDependencies > 0) {
      return;
    }
    if (Module["calledRun"]) {
      return;
    }

    function doRun() {
      if (Module["calledRun"]) {
        return;
      }
      Module["calledRun"] = true;
      if (ABORT) {
        return;
      }
      initRuntime();
      preMain();
      if (Module["onRuntimeInitialized"]) {
        Module["onRuntimeInitialized"]();
      }
      postRun();
    }
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(function () {
        setTimeout(function () {
          Module["setStatus"]("");
        }, 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  Module["run"] = run;

  function abort(what) {
    if (Module["onAbort"]) {
      Module["onAbort"](what);
    }
    if (what !== undefined) {
      out(what);
      err(what);
      what = '"' + what + '"';
    } else {
      what = "";
    }
    ABORT = true;
    EXITSTATUS = 1;
    throw "abort(" + what + "). Build with -s ASSERTIONS=1 for more info.";
  }
  Module["abort"] = abort;
  if (Module["preInit"]) {
    if (typeof Module["preInit"] == "function") {
      Module["preInit"] = [Module["preInit"]];
    }
    while (Module["preInit"].length > 0) {
      Module["preInit"].pop()();
    }
  }
  Module["noExitRuntime"] = true;
  run();
  var Offsets = {
    b2Body: {
      type: 0,
      islandIndex: 8,
      xf: 12,
      xf0: 28,
      sweep: 44,
      linearVelocity: 80,
      angularVelocity: 88,
      force: 92,
      torque: 100,
      world: 104,
      prev: 108,
      next: 112,
      fixtureList: 116,
      fixtureCount: 120,
      jointList: 124,
      contactList: 128,
      mass: 132,
      invMass: 136,
      I: 140,
      invI: 144,
      linearDamping: 148,
      angularDamping: 152,
      gravityScale: 156,
      sleepTime: 160,
      userData: 164,
    },
    b2Contact: {
      flags: 4,
      prev: 8,
      next: 12,
      nodeA: 16,
      nodeB: 32,
      fixtureA: 48,
      fixtureB: 52,
      indexA: 56,
      indexB: 60,
      manifold: 64,
      toiCount: 128,
      toi: 132,
      friction: 136,
      restitution: 140,
      tangentSpeed: 144,
    },
    b2Fixture: {
      density: 0,
      next: 4,
      body: 8,
      shape: 12,
      friction: 16,
      restitution: 20,
      proxies: 24,
      proxyCount: 28,
      filter: 32,
      filterCategoryBits: 32,
      filterMaskBits: 34,
      filterGroupIndex: 36,
      isSensor: 38,
      userData: 40,
    },
    b2ParticleGroup: {
      system: 0,
      firstIndex: 4,
      lastIndex: 8,
      groupFlags: 12,
      strength: 16,
      prev: 20,
      next: 24,
      timestamp: 28,
      mass: 32,
      inertia: 36,
      center: 40,
      linearVelocity: 48,
      angularVelocity: 56,
      transform: 60,
      userData: 76,
    },
    b2WorldManifold: {
      normal: 0,
      points: 8,
      separations: 24,
    },
    b2World: {
      bodyList: 102960,
    },
  };
  var FLT_EPSILON = 1.1920929e-7;

  function b2Max(a, b) {
    return new b2Vec2(Math.max(a.x, b.x), Math.max(a.y, b.y));
  }

  function b2Min(a, b) {
    return new b2Vec2(Math.min(a.x, b.x), Math.min(a.y, b.y));
  }

  function b2Clamp(a, low, high) {
    return b2Max(low, b2Min(a, high));
  }

  function b2Vec2(x, y) {
    if (x === undefined) {
      x = 0;
    }
    if (y === undefined) {
      y = 0;
    }
    this.x = x;
    this.y = y;
  }
  b2Vec2.Add = function (out, a, b) {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
  };
  b2Vec2.CrossScalar = function (output, input, scalar) {
    output.x = -scalar * input.y;
    output.y = scalar * input.x;
  };
  b2Vec2.Cross = function (a, b) {
    return a.x * b.y - a.y * b.x;
  };
  b2Vec2.MulScalar = function (out, input, scalar) {
    out.x = input.x * scalar;
    out.y = input.y * scalar;
  };
  b2Vec2.Mul = function (out, T, v) {
    var Tp = T.p;
    var Tqc = T.q.c;
    var Tqs = T.q.s;
    var x = v.x;
    var y = v.y;
    out.x = Tqc * x - Tqs * y + Tp.x;
    out.y = Tqs * x + Tqc * y + Tp.y;
  };
  b2Vec2.Normalize = function (out, input) {
    var length = input.Length();
    if (length < FLT_EPSILON) {
      out.x = 0;
      out.y = 0;
      return;
    }
    var invLength = 1.0 / length;
    out.x = input.x * invLength;
    out.y = input.y * invLength;
  };
  b2Vec2.Sub = function (out, input, subtract) {
    out.x = input.x - subtract.x;
    out.y = input.y - subtract.y;
  };
  b2Vec2.prototype.Clone = function () {
    return new b2Vec2(this.x, this.y);
  };
  b2Vec2.prototype.Set = function (x, y) {
    this.x = x;
    this.y = y;
  };
  b2Vec2.prototype.Length = function () {
    var x = this.x;
    var y = this.y;
    return Math.sqrt(x * x + y * y);
  };
  b2Vec2.prototype.LengthSquared = function () {
    var x = this.x;
    var y = this.y;
    return x * x + y * y;
  };

  function b2Rot(radians) {
    if (radians === undefined) {
      radians = 0;
    }
    this.s = Math.sin(radians);
    this.c = Math.cos(radians);
  }
  b2Rot.prototype.Set = function (radians) {
    this.s = Math.sin(radians);
    this.c = Math.cos(radians);
  };
  b2Rot.prototype.SetIdentity = function () {
    this.s = 0;
    this.c = 1;
  };
  b2Rot.prototype.GetXAxis = function () {
    return new b2Vec2(this.c, this.s);
  };

  function b2Transform(position, rotation) {
    if (position === undefined) {
      position = new b2Vec2();
    }
    if (rotation === undefined) {
      rotation = new b2Rot();
    }
    this.p = position;
    this.q = rotation;
  }
  b2Transform.prototype.FromFloat64Array = function (arr) {
    var p = this.p;
    var q = this.q;
    p.x = arr[0];
    p.y = arr[1];
    q.s = arr[2];
    q.c = arr[3];
  };
  b2Transform.prototype.SetIdentity = function () {
    this.p.Set(0, 0);
    this.q.SetIdentity();
  };

  function b2AABB(x0, y0, x1, y1) {
    void 0 === x0 && (x0 = 0);
    void 0 === y0 && (y0 = 0);
    void 0 === x1 && (x1 = 0);
    void 0 === y1 && (y1 = 0);
    this.lowerBound = new b2Vec2(x0, y0);
    this.upperBound = new b2Vec2(x1, y1);
  }
  b2AABB.prototype.GetCenter = function () {
    var sum = new b2Vec2();
    b2Vec2.Add(sum, this.lowerBound, this.upperBound);
    b2Vec2.MulScalar(sum, sum, 0.5);
  };
  var b2Manifold_GetPointCount = Module.cwrap(
    "b2Manifold_GetPointCount",
    "number",
    ["number"]
  );

  function b2Manifold(ptr) {
    this.ptr = ptr;
  }
  b2Manifold.prototype.GetPointCount = function () {
    return b2Manifold_GetPointCount(this.ptr);
  };
  var b2WorldManifold_points_offset = Offsets.b2WorldManifold.points;

  function b2WorldManifold(ptr) {
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
    this.ptr = ptr;
  }
  b2WorldManifold.prototype.GetPoint = function (i) {
    var point = new b2Vec2();
    point.x = this.buffer.getFloat32(
      i * 8 + b2WorldManifold_points_offset,
      true
    );
    point.y = this.buffer.getFloat32(
      i * 8 + 4 + b2WorldManifold_points_offset,
      true
    );
    return point;
  };
  var b2EdgeShape_CreateFixture = Module.cwrap(
    "b2EdgeShape_CreateFixture",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2EdgeShape() {
    this.hasVertex0 = false;
    this.hasVertex3 = false;
    this.vertex0 = new b2Vec2();
    this.vertex1 = new b2Vec2();
    this.vertex2 = new b2Vec2();
    this.vertex3 = new b2Vec2();
    this.type = b2Shape_Type_e_edge;
  }
  b2EdgeShape.prototype.Set = function (v1, v2) {
    this.vertex1 = v1;
    this.vertex2 = v2;
    this.hasVertex0 = false;
    this.hasVertex3 = false;
  };
  b2EdgeShape.prototype._CreateFixture = function (body, fixtureDef) {
    return b2EdgeShape_CreateFixture(
      body.ptr,
      fixtureDef.density,
      fixtureDef.friction,
      fixtureDef.isSensor,
      fixtureDef.restitution,
      fixtureDef.userData,
      fixtureDef.filter.categoryBits,
      fixtureDef.filter.groupIndex,
      fixtureDef.filter.maskBits,
      this.hasVertex0,
      this.hasVertex3,
      this.vertex0.x,
      this.vertex0.y,
      this.vertex1.x,
      this.vertex1.y,
      this.vertex2.x,
      this.vertex2.y,
      this.vertex3.x,
      this.vertex3.y
    );
  };
  var b2PolygonShape_CreateFixture_3 = Module.cwrap(
    "b2PolygonShape_CreateFixture_3",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateFixture_4 = Module.cwrap(
    "b2PolygonShape_CreateFixture_4",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateFixture_5 = Module.cwrap(
    "b2PolygonShape_CreateFixture_5",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateFixture_6 = Module.cwrap(
    "b2PolygonShape_CreateFixture_6",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateFixture_7 = Module.cwrap(
    "b2PolygonShape_CreateFixture_7",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateFixture_8 = Module.cwrap(
    "b2PolygonShape_CreateFixture_8",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_3 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_3",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_4 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_4",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_5 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_5",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_6 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_6",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_7 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_7",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_CreateParticleGroupInPolygon_8 = Module.cwrap(
    "b2PolygonShape_CreateParticleGroupInPolygon_8",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_3 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_3",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_4 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_4",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_5 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_5",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_6 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_6",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_7 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_7",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PolygonShape_DestroyParticlesInShape_8 = Module.cwrap(
    "b2PolygonShape_DestroyParticlesInShape_8",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2PolygonShape() {
    this.position = new b2Vec2();
    this.vertices = [];
    this.type = b2Shape_Type_e_polygon;
  }
  b2PolygonShape.prototype.SetAsPolygon = function (v) {
    for (var i = 0; i < v.length; i++) {
      this.vertices.push(new b2Vec2(v[i].x, v[i].y));
    }
  };
  b2PolygonShape.prototype.SetAsBoxXY = function (hx, hy) {
    this.vertices[0] = new b2Vec2(-hx, -hy);
    this.vertices[1] = new b2Vec2(hx, -hy);
    this.vertices[2] = new b2Vec2(hx, hy);
    this.vertices[3] = new b2Vec2(-hx, hy);
  };
  b2PolygonShape.prototype.SetAsBoxXYCenterAngle = function (
    hx,
    hy,
    center,
    angle
  ) {
    this.vertices[0] = new b2Vec2(-hx, -hy);
    this.vertices[1] = new b2Vec2(hx, -hy);
    this.vertices[2] = new b2Vec2(hx, hy);
    this.vertices[3] = new b2Vec2(-hx, hy);
    var xf = new b2Transform();
    xf.p = center;
    xf.q.Set(angle);
    for (var i = 0; i < 4; i++) {
      b2Vec2.Mul(this.vertices[i], xf, this.vertices[i]);
    }
  };
  b2PolygonShape.prototype._CreateFixture = function (body, fixtureDef) {
    var vertices = this.vertices;
    switch (vertices.length) {
      case 3:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        return b2PolygonShape_CreateFixture_3(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y
        );
        break;
      case 4:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        var v3 = vertices[3];
        return b2PolygonShape_CreateFixture_4(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y,
          v3.x,
          v3.y
        );
        break;
      case 5:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        var v3 = vertices[3];
        var v4 = vertices[4];
        return b2PolygonShape_CreateFixture_5(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y,
          v3.x,
          v3.y,
          v4.x,
          v4.y
        );
        break;
      case 6:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        var v3 = vertices[3];
        var v4 = vertices[4];
        var v5 = vertices[5];
        return b2PolygonShape_CreateFixture_6(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y,
          v3.x,
          v3.y,
          v4.x,
          v4.y,
          v5.x,
          v5.y
        );
        break;
      case 7:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        var v3 = vertices[3];
        var v4 = vertices[4];
        var v5 = vertices[5];
        var v6 = vertices[6];
        return b2PolygonShape_CreateFixture_7(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y,
          v3.x,
          v3.y,
          v4.x,
          v4.y,
          v5.x,
          v5.y,
          v6.x,
          v6.y
        );
        break;
      case 8:
        var v0 = vertices[0];
        var v1 = vertices[1];
        var v2 = vertices[2];
        var v3 = vertices[3];
        var v4 = vertices[4];
        var v5 = vertices[5];
        var v6 = vertices[6];
        var v7 = vertices[7];
        return b2PolygonShape_CreateFixture_8(
          body.ptr,
          fixtureDef.density,
          fixtureDef.friction,
          fixtureDef.isSensor,
          fixtureDef.restitution,
          fixtureDef.userData,
          fixtureDef.filter.categoryBits,
          fixtureDef.filter.groupIndex,
          fixtureDef.filter.maskBits,
          v0.x,
          v0.y,
          v1.x,
          v1.y,
          v2.x,
          v2.y,
          v3.x,
          v3.y,
          v4.x,
          v4.y,
          v5.x,
          v5.y,
          v6.x,
          v6.y,
          v6.x,
          v7.y
        );
        break;
    }
  };
  b2PolygonShape.prototype._CreateParticleGroup = function (
    particleSystem,
    pgd
  ) {
    var v = this.vertices;
    switch (v.length) {
      case 3:
        return b2PolygonShape_CreateParticleGroupInPolygon_3(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y
        );
        break;
      case 4:
        return b2PolygonShape_CreateParticleGroupInPolygon_4(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y
        );
        break;
      case 5:
        return b2PolygonShape_CreateParticleGroupInPolygon_5(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y
        );
        break;
      case 6:
        return b2PolygonShape_CreateParticleGroupInPolygon_6(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y
        );
        break;
      case 7:
        return b2PolygonShape_CreateParticleGroupInPolygon_7(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y,
          v[6].x,
          v[6].y
        );
        break;
      case 8:
        return b2PolygonShape_CreateParticleGroupInPolygon_8(
          particleSystem.ptr,
          pgd.angle,
          pgd.angularVelocity,
          pgd.color.r,
          pgd.color.g,
          pgd.color.b,
          pgd.color.a,
          pgd.flags,
          pgd.group.ptr,
          pgd.groupFlags,
          pgd.lifetime,
          pgd.linearVelocity.x,
          pgd.linearVelocity.y,
          pgd.position.x,
          pgd.position.y,
          pgd.positionData,
          pgd.particleCount,
          pgd.strength,
          pgd.stride,
          pgd.userData,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y,
          v[6].x,
          v[6].y,
          v[7].x,
          v[7].y
        );
        break;
      default:
        return null;
    }
  };
  b2PolygonShape.prototype._DestroyParticlesInShape = function (ps, xf) {
    var v = this.vertices;
    switch (v.length) {
      case 3:
        return b2PolygonShape_DestroyParticlesInShape_3(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      case 4:
        return b2PolygonShape_DestroyParticlesInShape_4(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      case 5:
        return b2PolygonShape_DestroyParticlesInShape_5(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      case 6:
        return b2PolygonShape_DestroyParticlesInShape_6(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      case 7:
        return b2PolygonShape_DestroyParticlesInShape_7(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y,
          v[6].x,
          v[6].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      case 8:
        return b2PolygonShape_DestroyParticlesInShape_8(
          ps.ptr,
          v[0].x,
          v[0].y,
          v[1].x,
          v[1].y,
          v[2].x,
          v[2].y,
          v[3].x,
          v[3].y,
          v[4].x,
          v[4].y,
          v[5].x,
          v[5].y,
          v[6].x,
          v[6].y,
          v[7].x,
          v[7].y,
          xf.p.x,
          xf.p.y,
          xf.q.s,
          xf.q.c
        );
        break;
      default:
        return null;
        break;
    }
  };
  b2PolygonShape.prototype.Validate = function () {
    for (var i = 0, max = this.vertices.length; i < max; ++i) {
      var i1 = i;
      var i2 = i < max - 1 ? i1 + 1 : 0;
      var p = this.vertices[i1];
      var e = this.vertices[i2];
      var eSubP = new b2Vec2();
      b2Vec2.Sub(eSubP, e, p);
      for (var j = 0; j < max; ++j) {
        if (j == i1 || j == i2) {
          continue;
        }
        var v = new b2Vec2();
        b2Vec2.Sub(v, this.vertices[j], p);
        var c = b2Vec2.Cross(eSubP, v);
        if (c < 0.0) {
          return false;
        }
      }
    }
    return true;
  };
  var b2Shape_Type_e_circle = 0;
  var b2Shape_Type_e_edge = 1;
  var b2Shape_Type_e_polygon = 2;
  var b2Shape_Type_e_chain = 3;
  var b2Shape_Type_e_typeCount = 4;
  var b2_linearSlop = 0.005;
  var b2_polygonRadius = 2 * b2_linearSlop;
  var b2_maxPolygonVertices = 8;

  function b2MassData(mass, center, I) {
    this.mass = mass;
    this.center = center;
    this.I = I;
  }
  var b2ChainShape_CreateFixture = Module.cwrap(
    "b2ChainShape_CreateFixture",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2ChainShape() {
    this.radius = b2_polygonRadius;
    this.vertices = [];
    this.type = b2Shape_Type_e_chain;
  }
  b2ChainShape.prototype.CreateLoop = function () {
    this.vertices.push(this.vertices[0]);
  };
  b2ChainShape.prototype._CreateFixture = function (body, fixtureDef) {
    var vertices = this.vertices;
    var chainLength = vertices.length;
    var dataLength = chainLength * 2;
    var data = new Float32Array(dataLength);
    for (var i = 0, j = 0; i < dataLength; i += 2, j++) {
      data[i] = vertices[j].x;
      data[i + 1] = vertices[j].y;
    }
    var nDataBytes = data.length * data.BYTES_PER_ELEMENT;
    var dataPtr = Module._malloc(nDataBytes);
    var dataHeap = new Uint8Array(Module.HEAPU8.buffer, dataPtr, nDataBytes);
    dataHeap.set(new Uint8Array(data.buffer));
    var fixture = b2ChainShape_CreateFixture(
      body.ptr,
      fixtureDef.density,
      fixtureDef.friction,
      fixtureDef.isSensor,
      fixtureDef.restitution,
      fixtureDef.userData,
      fixtureDef.filter.categoryBits,
      fixtureDef.filter.groupIndex,
      fixtureDef.filter.maskBits,
      dataHeap.byteOffset,
      data.length
    );
    Module._free(dataHeap.byteOffset);
    return fixture;
  };
  var b2CircleShape_CreateFixture = Module.cwrap(
    "b2CircleShape_CreateFixture",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2CircleShape_CreateParticleGroup = Module.cwrap(
    "b2CircleShape_CreateParticleGroup",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2CircleShape_DestroyParticlesInShape = Module.cwrap(
    "b2CircleShape_DestroyParticlesInShape",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2CircleShape() {
    this.position = new b2Vec2();
    this.radius = 0;
    this.type = b2Shape_Type_e_circle;
  }
  b2CircleShape.prototype._CreateFixture = function (body, fixtureDef) {
    return b2CircleShape_CreateFixture(
      body.ptr,
      fixtureDef.density,
      fixtureDef.friction,
      fixtureDef.isSensor,
      fixtureDef.restitution,
      fixtureDef.userData,
      fixtureDef.filter.categoryBits,
      fixtureDef.filter.groupIndex,
      fixtureDef.filter.maskBits,
      this.position.x,
      this.position.y,
      this.radius
    );
  };
  b2CircleShape.prototype._CreateParticleGroup = function (
    particleSystem,
    pgd
  ) {
    return b2CircleShape_CreateParticleGroup(
      particleSystem.ptr,
      pgd.angle,
      pgd.angularVelocity,
      pgd.color.r,
      pgd.color.g,
      pgd.color.b,
      pgd.color.a,
      pgd.flags,
      pgd.group.ptr,
      pgd.groupFlags,
      pgd.lifetime,
      pgd.linearVelocity.x,
      pgd.linearVelocity.y,
      pgd.position.x,
      pgd.position.y,
      pgd.positionData,
      pgd.particleCount,
      pgd.strength,
      pgd.stride,
      pgd.userData,
      this.position.x,
      this.position.y,
      this.radius
    );
  };
  b2CircleShape.prototype._DestroyParticlesInShape = function (ps, xf) {
    return b2CircleShape_DestroyParticlesInShape(
      ps.ptr,
      this.position.x,
      this.position.y,
      this.radius,
      xf.p.x,
      xf.p.y,
      xf.q.s,
      xf.q.c
    );
  };
  var b2Body_ApplyAngularImpulse = Module.cwrap(
    "b2Body_ApplyAngularImpulse",
    "null",
    ["number", "number", "number"]
  );
  var b2Body_ApplyLinearImpulse = Module.cwrap(
    "b2Body_ApplyLinearImpulse",
    "null",
    ["number", "number", "number", "number", "number", "number"]
  );
  var b2Body_ApplyForce = Module.cwrap("b2Body_ApplyForce", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_ApplyForceToCenter = Module.cwrap(
    "b2Body_ApplyForceToCenter",
    "number",
    ["number", "number", "number", "number"]
  );
  var b2Body_ApplyTorque = Module.cwrap("b2Body_ApplyTorque", "number", [
    "number",
    "number",
    "number",
  ]);
  var b2Body_DestroyFixture = Module.cwrap("b2Body_DestroyFixture", "null", [
    "number",
    "number",
  ]);
  var b2Body_GetAngle = Module.cwrap("b2Body_GetAngle", "number", ["number"]);
  var b2Body_GetAngularVelocity = Module.cwrap(
    "b2Body_GetAngularVelocity",
    "number",
    ["number"]
  );
  var b2Body_GetInertia = Module.cwrap("b2Body_GetInertia", "number", [
    "number",
  ]);
  var b2Body_GetLinearVelocity = Module.cwrap(
    "b2Body_GetLinearVelocity",
    "null",
    ["number", "number"]
  );
  var b2Body_GetLocalPoint = Module.cwrap("b2Body_GetLocalPoint", "null", [
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_GetLocalVector = Module.cwrap("b2Body_GetLocalVector", "null", [
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_GetMass = Module.cwrap("b2Body_GetMass", "number", ["number"]);
  var b2Body_GetPosition = Module.cwrap("b2Body_GetPosition", "null", [
    "number",
    "number",
  ]);
  var b2Body_GetTransform = Module.cwrap("b2Body_GetTransform", "null", [
    "number",
    "number",
  ]);
  var b2Body_GetType = Module.cwrap("b2Body_GetType", "number", ["number"]);
  var b2Body_GetWorldCenter = Module.cwrap("b2Body_GetWorldCenter", "null", [
    "number",
    "number",
  ]);
  var b2Body_GetWorldPoint = Module.cwrap("b2Body_GetWorldPoint", "null", [
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_GetWorldVector = Module.cwrap("b2Body_GetWorldVector", "null", [
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_SetAngularVelocity = Module.cwrap(
    "b2Body_SetAngularVelocity",
    "null",
    ["number", "number"]
  );
  var b2Body_SetAwake = Module.cwrap("b2Body_SetAwake", "number", [
    "number",
    "number",
  ]);
  var b2Body_SetFixedRotation = Module.cwrap(
    "b2Body_SetFixedRotation",
    "number",
    ["number", "number"]
  );
  var b2Body_SetLinearVelocity = Module.cwrap(
    "b2Body_SetLinearVelocity",
    "null",
    ["number", "number", "number"]
  );
  var b2Body_SetMassData = Module.cwrap("b2Body_SetMassData", "null", [
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2Body_SetTransform = Module.cwrap("b2Body_SetTransform", "null", [
    "number",
    "number",
    "number",
  ]);
  var b2Body_SetType = Module.cwrap("b2Body_SetType", "null", [
    "number",
    "number",
  ]);
  var b2Body_SetGravityScale = Module.cwrap("b2Body_SetGravityScale", "null", [
    "number",
    "number",
  ]);
  var b2Body_GetGravityScale = Module.cwrap(
    "b2Body_GetGravityScale",
    "number",
    ["number"]
  );
  var b2Body_ResetMassData = Module.cwrap("b2Body_ResetMassData", "null", [
    "number",
  ]);
  var b2Body_GetLinearVelocityFromWorldPoint = Module.cwrap(
    "b2Body_GetLinearVelocityFromWorldPoint",
    "null",
    ["number", "number", "number"]
  );
  var b2Body_SetLinearDamping = Module.cwrap(
    "b2Body_SetLinearDamping",
    "null",
    ["number", "number"]
  );
  var b2Body_SetBullet = Module.cwrap("b2Body_SetBullet", "number", [
    "number",
    "number",
  ]);
  var b2Body_IsAwake = Module.cwrap("b2Body_IsAwake", "number", ["number"]);
  var b2Body_SetSleepingAllowed = Module.cwrap(
    "b2Body_SetSleepingAllowed",
    "number",
    ["number", "number"]
  );
  var b2Body_xf_offset = Offsets.b2Body.xf;
  var b2Body_userData_offset = Offsets.b2Body.userData;

  function b2Body(ptr) {
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
    this.ptr = ptr;
    this.fixtures = [];
  }
  b2Body.prototype.ApplyAngularImpulse = function (impulse, wake) {
    b2Body_ApplyAngularImpulse(this.ptr, impulse, wake);
  };
  b2Body.prototype.ApplyLinearImpulse = function (
    impulseX,
    impulseY,
    pointX,
    pointY,
    wake
  ) {
    b2Body_ApplyLinearImpulse(
      this.ptr,
      impulseX,
      impulseY,
      pointX,
      pointY,
      wake
    );
  };
  b2Body.prototype.ApplyForce = function (
    forceX,
    forceY,
    pointX,
    pointY,
    wake
  ) {
    b2Body_ApplyForce(this.ptr, forceX, forceY, pointX, pointY, wake);
  };
  b2Body.prototype.ApplyForceToCenter = function (forceX, forceY, wake) {
    b2Body_ApplyForceToCenter(this.ptr, forceX, forceY, wake);
  };
  b2Body.prototype.ApplyTorque = function (torque, wake) {
    b2Body_ApplyTorque(this.ptr, torque, wake);
  };
  b2Body.prototype.CreateFixtureFromDef = function (fixtureDef) {
    var fixture = new b2Fixture();
    fixture.FromFixtureDef(fixtureDef);
    fixture._SetPtr(fixtureDef.shape._CreateFixture(this, fixtureDef));
    fixture.body = this;
    b2World._Push(fixture, this.fixtures);
    world.fixturesLookup[fixture.ptr] = fixture;
    fixture.SetFilterData(fixtureDef.filter);
    return fixture;
  };
  b2Body.prototype.CreateFixtureFromShape = function (shape, density) {
    var fixtureDef = new b2FixtureDef();
    fixtureDef.shape = shape;
    fixtureDef.density = density;
    return this.CreateFixtureFromDef(fixtureDef);
  };
  b2Body.prototype.DestroyFixture = function (fixture) {
    b2Body_DestroyFixture(this.ptr, fixture.ptr);
    b2World._RemoveItem(fixture, this.fixtures);
  };
  b2Body.prototype.GetAngle = function () {
    return b2Body_GetAngle(this.ptr);
  };
  b2Body.prototype.GetAngularVelocity = function () {
    return b2Body_GetAngularVelocity(this.ptr);
  };
  b2Body.prototype.GetInertia = function () {
    return b2Body_GetInertia(this.ptr);
  };
  b2Body.prototype.GetMass = function () {
    return b2Body_GetMass(this.ptr);
  };
  b2Body.prototype.GetLinearVelocity = function () {
    b2Body_GetLinearVelocity(this.ptr, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.GetLocalPoint = function (posX, posY) {
    b2Body_GetLocalPoint(this.ptr, posX, posY, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.GetLocalVector = function (vec) {
    b2Body_GetLocalVector(this.ptr, vec.x, vec.y, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.ResetMassData = function () {
    b2Body_ResetMassData(this.ptr);
  };
  b2Body.prototype.GetPosition = function () {
    b2Body_GetPosition(this.ptr, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.GetTransform = function () {
    var transform = new b2Transform();
    transform.p.x = this.buffer.getFloat32(b2Body_xf_offset, true);
    transform.p.y = this.buffer.getFloat32(b2Body_xf_offset + 4, true);
    transform.q.s = this.buffer.getFloat32(b2Body_xf_offset + 8, true);
    transform.q.c = this.buffer.getFloat32(b2Body_xf_offset + 12, true);
    return transform;
  };
  b2Body.prototype.GetType = function () {
    return b2Body_GetType(this.ptr);
  };
  b2Body.prototype.GetUserData = function () {
    return this.buffer.getUint32(b2Body_userData_offset, true);
  };
  b2Body.prototype.GetWorldCenter = function () {
    b2Body_GetWorldCenter(this.ptr, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.GetWorldPoint = function (vec) {
    b2Body_GetWorldPoint(this.ptr, vec.x, vec.y, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.GetWorldVector = function (vec) {
    b2Body_GetWorldVector(this.ptr, vec.x, vec.y, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.SetAngularVelocity = function (angle) {
    b2Body_SetAngularVelocity(this.ptr, angle);
  };
  b2Body.prototype.SetAwake = function (flag) {
    b2Body_SetAwake(this.ptr, flag);
  };
  b2Body.prototype.IsAwake = function () {
    return b2Body_IsAwake(this.ptr);
  };
  b2Body.prototype.SetFixedRotation = function (flag) {
    b2Body_SetFixedRotation(this.ptr, flag);
  };
  b2Body.prototype.SetLinearVelocity = function (v) {
    b2Body_SetLinearVelocity(this.ptr, v.x, v.y);
  };
  b2Body.prototype.SetMassData = function (massData) {
    b2Body_SetMassData(
      this.ptr,
      massData.mass,
      massData.center.x,
      massData.center.y,
      massData.I
    );
  };
  b2Body.prototype.SetTransform = function (v, angle) {
    b2Body_SetTransform(this.ptr, v.x, v.y, angle);
  };
  b2Body.prototype.SetType = function (type) {
    b2Body_SetType(this.ptr, type);
  };
  b2Body.prototype.SetGravityScale = function (scale) {
    b2Body_SetGravityScale(this.ptr, scale);
  };
  b2Body.prototype.GetGravityScale = function () {
    return b2Body_GetGravityScale(this.ptr);
  };
  b2Body.prototype.GetLinearVelocityFromWorldPoint = function (posX, posY) {
    b2Body_GetLinearVelocityFromWorldPoint(
      this.ptr,
      posX,
      posY,
      _vec2Buf.byteOffset
    );
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2Body.prototype.SetLinearDamping = function (damp) {
    b2Body_SetLinearDamping(this.ptr, damp);
  };
  b2Body.prototype.SetAngularDamping = function (damp) {
    b2Body_SetGravityScale(this.ptr, damp);
  };
  b2Body.prototype.SetBullet = function (flag) {
    b2Body_SetBullet(this.ptr, flag);
  };
  b2Body.prototype.SetSleepingAllowed = function (flag) {
    b2Body_SetSleepingAllowed(this.ptr, flag);
  };
  var b2_staticBody = 0;
  var b2_kinematicBody = 1;
  var b2_dynamicBody = 2;

  function b2BodyDef() {
    this.active = true;
    this.allowSleep = true;
    this.angle = 0;
    this.angularVelocity = 0;
    this.angularDamping = 0;
    this.awake = true;
    this.bullet = false;
    this.fixedRotation = false;
    this.gravityScale = 1.0;
    this.linearDamping = 0;
    this.linearVelocity = new b2Vec2();
    this.position = new b2Vec2();
    this.type = b2_staticBody;
    this.userData = null;
  }
  b2World.BeginContactBody = function (contactPtr) {
    if (world.listener.BeginContactBody === undefined) {
      return;
    }
    var contact = new b2Contact(contactPtr);
    world.listener.BeginContactBody(contact);
  };
  b2World.EndContactBody = function (contactPtr) {
    if (world.listener.EndContactBody === undefined) {
      return;
    }
    var contact = new b2Contact(contactPtr);
    world.listener.EndContactBody(contact);
  };
  b2World.PreSolve = function (contactPtr, oldManifoldPtr) {
    if (world.listener.PreSolve === undefined) {
      return;
    }
    world.listener.PreSolve(
      new b2Contact(contactPtr),
      new b2Manifold(oldManifoldPtr)
    );
  };
  b2World.PostSolve = function (contactPtr, impulsePtr) {
    if (world.listener.PostSolve === undefined) {
      return;
    }
    world.listener.PostSolve(
      new b2Contact(contactPtr),
      new b2ContactImpulse(impulsePtr)
    );
  };
  b2World.QueryAABB = function (fixturePtr) {
    return world.queryAABBCallback.ReportFixture(
      world.fixturesLookup[fixturePtr]
    );
  };
  b2World.RayCast = function (
    fixturePtr,
    pointX,
    pointY,
    normalX,
    normalY,
    fraction
  ) {
    return world.rayCastCallback.ReportFixture(
      world.fixturesLookup[fixturePtr],
      new b2Vec2(pointX, pointY),
      new b2Vec2(normalX, normalY),
      fraction
    );
  };
  var b2World_Create = Module.cwrap("b2World_Create", "number", [
    "number",
    "number",
  ]);
  var b2World_DestroyWorld = Module.cwrap("b2World_DestroyWorld", "number", [
    "number",
  ]);
  var b2World_CreateBody = Module.cwrap("b2World_CreateBody", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2World_CreateParticleSystem = Module.cwrap(
    "b2World_CreateParticleSystem",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2World_DestroyBody = Module.cwrap("b2World_DestroyBody", "null", [
    "number",
    "number",
  ]);
  var b2World_DestroyJoint = Module.cwrap("b2World_DestroyJoint", "null", [
    "number",
    "number",
  ]);
  var b2World_DestroyParticleSystem = Module.cwrap(
    "b2World_DestroyParticleSystem",
    "null",
    ["number", "number"]
  );
  var b2World_QueryAABB = Module.cwrap("b2World_QueryAABB", "null", [
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2World_RayCast = Module.cwrap("b2World_RayCast", "null", [
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2World_SetContactListener = Module.cwrap(
    "b2World_SetContactListener",
    "null",
    ["number"]
  );
  var b2World_SetGravity = Module.cwrap("b2World_SetGravity", "null", [
    "number",
    "number",
    "number",
  ]);
  var b2World_Step = Module.cwrap("b2World_Step", "null", [
    "number",
    "number",
    "number",
    "number",
  ]);
  var _transBuf = null;
  var _vec2Buf = null;

  function b2World(gravityX, gravityY) {
    this.bodies = [];
    this.bodiesLookup = {};
    this.fixturesLookup = {};
    this.joints = [];
    this.listener = null;
    this.particleSystems = [];
    this.ptr = b2World_Create(gravityX, gravityY);
    this.queryAABBCallback = null;
    this.rayCastCallback = null;
    this.buffer = new DataView(Module.HEAPU8.buffer, this.ptr);
    var nDataBytes = 4 * Float32Array.BYTES_PER_ELEMENT;
    var dataPtr = Module._malloc(nDataBytes);
    _transBuf = new Uint8Array(Module.HEAPU8.buffer, dataPtr, nDataBytes);
    nDataBytes = 2 * Float32Array.BYTES_PER_ELEMENT;
    dataPtr = Module._malloc(nDataBytes);
    _vec2Buf = new Uint8Array(Module.HEAPU8.buffer, dataPtr, nDataBytes);
  }
  b2World._Push = function (item, list) {
    item.lindex = list.length;
    list.push(item);
  };
  b2World._RemoveItem = function (item, list) {
    var length = list.length;
    var lindex = item.lindex;
    if (length > 1) {
      list[lindex] = list[length - 1];
      list[lindex].lindex = lindex;
    }
    list.pop();
  };
  b2World.prototype.CreateBody = function (bodyDef) {
    var body = new b2Body(
      b2World_CreateBody(
        this.ptr,
        bodyDef.active,
        bodyDef.allowSleep,
        bodyDef.angle,
        bodyDef.angularVelocity,
        bodyDef.angularDamping,
        bodyDef.awake,
        bodyDef.bullet,
        bodyDef.fixedRotation,
        bodyDef.gravityScale,
        bodyDef.linearDamping,
        bodyDef.linearVelocity.x,
        bodyDef.linearVelocity.y,
        bodyDef.position.x,
        bodyDef.position.y,
        bodyDef.type,
        bodyDef.userData
      )
    );
    b2World._Push(body, this.bodies);
    this.bodiesLookup[body.ptr] = body;
    return body;
  };
  b2World.prototype.CreateJoint = function (jointDef) {
    var joint = jointDef.Create(this);
    b2World._Push(joint, this.joints);
    return joint;
  };
  b2World.prototype.CreateParticleSystem = function (psd) {
    var ps = new b2ParticleSystem(
      b2World_CreateParticleSystem(
        this.ptr,
        psd.colorMixingStrength,
        psd.dampingStrength,
        psd.destroyByAge,
        psd.ejectionStrength,
        psd.elasticStrength,
        psd.lifetimeGranularity,
        psd.powderStrength,
        psd.pressureStrength,
        psd.radius,
        psd.repulsiveStrength,
        psd.springStrength,
        psd.staticPressureIterations,
        psd.staticPressureRelaxation,
        psd.staticPressureStrength,
        psd.surfaceTensionNormalStrength,
        psd.surfaceTensionPressureStrength,
        psd.viscousStrength
      )
    );
    b2World._Push(ps, this.particleSystems);
    ps.dampingStrength = psd.dampingStrength;
    ps.radius = psd.radius;
    return ps;
  };
  b2World.prototype.DestroyBody = function (body) {
    b2World_DestroyBody(this.ptr, body.ptr);
    b2World._RemoveItem(body, this.bodies);
  };
  b2World.prototype.DestroyJoint = function (joint) {
    b2World_DestroyJoint(this.ptr, joint.ptr);
    b2World._RemoveItem(joint, this.joints);
  };
  b2World.prototype.DestroyParticleSystem = function (particleSystem) {
    b2World_DestroyParticleSystem(this.ptr, particleSystem.ptr);
    b2World._RemoveItem(particleSystem, this.particleSystems);
  };
  b2World.prototype.QueryAABB = function (callback, aabb) {
    this.queryAABBCallback = callback;
    b2World_QueryAABB(
      this.ptr,
      aabb.lowerBound.x,
      aabb.lowerBound.y,
      aabb.upperBound.x,
      aabb.upperBound.y
    );
  };
  b2World.prototype.RayCast = function (callback, point1, point2) {
    this.rayCastCallback = callback;
    b2World_RayCast(this.ptr, point1.x, point1.y, point2.x, point2.y);
  };
  b2World.prototype.SetContactListener = function (listener) {
    this.listener = listener;
    b2World_SetContactListener(this.ptr);
  };
  b2World.prototype.SetGravity = function (gravityX, gravityY) {
    b2World_SetGravity(this.ptr, gravityX, gravityY);
  };
  b2World.prototype.Step = function (
    steps,
    vIterations,
    pIterations,
    partIterations
  ) {
    if (!partIterations) {
      partIterations = 3;
    }
    b2World_Step(this.ptr, steps, vIterations, pIterations, partIterations);
  };
  b2World.prototype._Destroy_ = function () {
    b2World_DestroyWorld(this.ptr);
  };
  var b2WheelJoint_SetMotorSpeed = Module.cwrap(
    "b2WheelJoint_SetMotorSpeed",
    "null",
    ["number", "number"]
  );
  var b2WheelJoint_SetSpringFrequencyHz = Module.cwrap(
    "b2WheelJoint_SetSpringFrequencyHz",
    "null",
    ["number", "number"]
  );
  var b2WheelJoint_GetReactionForce = Module.cwrap(
    "b2WheelJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2WheelJoint_EnableMotor = Module.cwrap(
    "b2WheelJoint_EnableMotor",
    "number",
    ["number", "number"]
  );
  var b2WheelJoint_GetReactionTorque = Module.cwrap(
    "b2WheelJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2WheelJoint_SetMaxMotorTorque = Module.cwrap(
    "b2WheelJoint_SetMaxMotorTorque",
    "number",
    ["number", "number"]
  );
  var b2WheelJoint_SetSpringDampingRatio = Module.cwrap(
    "b2WheelJoint_SetSpringDampingRatio",
    "number",
    ["number", "number"]
  );
  var b2WheelJoint_GetMotorTorque = Module.cwrap(
    "b2WheelJoint_GetMotorTorque",
    "number",
    ["number", "number"]
  );

  function b2WheelJoint(def) {
    this.next = null;
    this.ptr = null;
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = def.collideConnected;
    this.dampingRatio = def.dampingRatio;
    this.enableMotor = def.enableMotor;
    this.frequencyHz = def.frequencyHz;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.localAxisA = def.localAxisA;
    this.maxMotorTorque = def.maxMotorTorque;
    this.motorSpeed = def.motorSpeed;
    this.userData = def.userData;
  }
  b2WheelJoint.prototype.SetMotorSpeed = function (speed) {
    b2WheelJoint_SetMotorSpeed(this.ptr, speed);
  };
  b2WheelJoint.prototype.SetSpringFrequencyHz = function (hz) {
    b2WheelJoint_SetSpringFrequencyHz(this.ptr, hz);
  };
  b2WheelJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2WheelJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2WheelJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2WheelJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2WheelJoint.prototype.EnableMotor = function (flag) {
    return b2WheelJoint_EnableMotor(this.ptr, flag);
  };
  b2WheelJoint.prototype.SetMaxMotorTorque = function (torque) {
    return b2WheelJoint_SetMaxMotorTorque(this.ptr, torque);
  };
  b2WheelJoint.prototype.SetSpringDampingRatio = function (ratio) {
    return b2WheelJoint_SetSpringDampingRatio(this.ptr, ratio);
  };
  b2WheelJoint.prototype.GetMotorTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2WheelJoint_GetMotorTorque(this.ptr, invdt);
  };
  var b2WheelJointDef_Create = Module.cwrap(
    "b2WheelJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2WheelJointDef_InitializeAndCreate = Module.cwrap(
    "b2WheelJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2WheelJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.dampingRatio = 0.7;
    this.enableMotor = false;
    this.frequencyHz = 2;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.localAxisA = 0;
    this.maxMotorTorque = 0;
    this.motorSpeed = 0;
    this.userData = null;
  }
  b2WheelJointDef.prototype.Create = function (world) {
    var wheelJoint = new b2WheelJoint(this);
    wheelJoint.ptr = b2WheelJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.dampingRatio,
      this.enableMotor,
      this.frequencyHz,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      Math.cos(this.localAxisA),
      Math.sin(this.localAxisA),
      this.maxMotorTorque,
      this.motorSpeed
    );
    return wheelJoint;
  };
  b2WheelJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchor,
    axis
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var wheelJoint = new b2WheelJoint(this);
    wheelJoint.ptr = b2WheelJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchor.x,
      anchor.y,
      Math.cos(axis),
      Math.sin(axis),
      this.collideConnected,
      this.dampingRatio,
      this.enableMotor,
      this.frequencyHz,
      this.maxMotorTorque,
      this.motorSpeed
    );
    b2World._Push(wheelJoint, world.joints);
    return wheelJoint;
  };
  var b2WeldJointDef_Create = Module.cwrap("b2WeldJointDef_Create", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  var b2WeldJointDef_InitializeAndCreate = Module.cwrap(
    "b2WeldJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2WeldJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.dampingRatio = 0;
    this.frequencyHz = 0;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.referenceAngle = 0;
    this.userData = null;
  }
  b2WeldJointDef.prototype.Create = function (world) {
    var weldJoint = new b2WeldJoint(this);
    weldJoint.ptr = b2WeldJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.dampingRatio,
      this.frequencyHz,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      this.referenceAngle
    );
    return weldJoint;
  };
  b2WeldJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchor
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var weldJoint = new b2WeldJoint(this);
    weldJoint.ptr = b2WeldJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchor.x,
      anchor.y,
      this.collideConnected,
      this.dampingRatio,
      this.frequencyHz
    );
    b2World._Push(weldJoint, world.joints);
    return weldJoint;
  };
  var b2WeldJoint_GetReactionForce = Module.cwrap(
    "b2WeldJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2WeldJoint_GetReactionTorque = Module.cwrap(
    "b2WeldJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );

  function b2WeldJoint(def) {
    this.next = null;
    this.ptr = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.dampingRatio = def.dampingRatio;
    this.frequencyHz = def.frequencyHz;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.referenceAngle = def.referenceAngle;
    this.userData = def.userData;
  }
  b2WeldJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2WeldJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2WeldJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2WeldJoint_GetReactionTorque(this.ptr, invdt);
  };
  var b2GearJoint_GetRatio = Module.cwrap("b2GearJoint_GetRatio", "number", [
    "number",
  ]);
  var b2GearJoint_GetReactionForce = Module.cwrap(
    "b2GearJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2GearJoint_GetReactionTorque = Module.cwrap(
    "b2GearJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );

  function b2GearJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.joint1 = def.joint1;
    this.joint2 = def.joint2;
    this.ratio = def.ratio;
    this.userData = def.userData;
  }
  b2GearJoint.prototype.GetRatio = function () {
    return b2GearJoint_GetRatio(this.ptr);
  };
  b2GearJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2GearJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2GearJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2GearJoint_GetReactionTorque(this.ptr, invdt);
  };
  var b2GearJointDef_Create = Module.cwrap("b2GearJointDef_Create", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);

  function b2GearJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.joint1 = null;
    this.joint2 = null;
    this.ratio = 0;
    this.userData = null;
  }
  b2GearJointDef.prototype.Create = function (world) {
    var gearJoint = new b2GearJoint(this);
    gearJoint.ptr = b2GearJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.joint1.ptr,
      this.joint2.ptr,
      this.ratio
    );
    return gearJoint;
  };
  var e_unknownJoint = 0;
  var e_revoluteJoint = 1;
  var e_prismaticJoint = 2;
  var e_distanceJoint = 3;
  var e_pulleyJoint = 4;
  var e_mouseJoint = 5;
  var e_gearJoint = 6;
  var e_wheelJoint = 7;
  var e_weldJoint = 8;
  var e_frictionJoint = 9;
  var e_ropeJoint = 10;
  var e_motorJoint = 11;
  var b2Joint_GetBodyA = Module.cwrap("b2Joint_GetBodyA", "number", ["number"]);
  var b2Joint_GetBodyB = Module.cwrap("b2Joint_GetBodyB", "number", ["number"]);

  function b2Joint() {}
  b2Joint.prototype.GetBodyA = function () {
    return world.bodiesLookup[b2Joint_GetBodyA(this.ptr)];
  };
  b2Joint.prototype.GetBodyB = function () {
    return world.bodiesLookup[b2Joint_GetBodyB(this.ptr)];
  };
  var b2FrictionJointDef_Create = Module.cwrap(
    "b2FrictionJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2FrictionJointDef_InitializeAndCreate = Module.cwrap(
    "b2FrictionJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2FrictionJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.maxForce = 0;
    this.maxTorque = 0;
    this.userData = null;
  }
  b2FrictionJointDef.prototype.Create = function (world) {
    var frictionJoint = new b2FrictionJoint(this);
    frictionJoint.ptr = b2FrictionJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      this.maxForce,
      this.maxTorque
    );
    return frictionJoint;
  };
  b2FrictionJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchor
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var frictionJoint = new b2FrictionJoint(this);
    frictionJoint.ptr = b2FrictionJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchor.x,
      anchor.y,
      this.collideConnected,
      this.maxForce,
      this.maxTorque
    );
    b2World._Push(frictionJoint, world.joints);
    return frictionJoint;
  };
  var b2FrictionJoint_GetReactionForce = Module.cwrap(
    "b2FrictionJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2FrictionJoint_GetReactionTorque = Module.cwrap(
    "b2FrictionJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2FrictionJoint_SetMaxForce = Module.cwrap(
    "b2FrictionJoint_SetMaxForce",
    "number",
    ["number", "number"]
  );
  var b2FrictionJoint_SetMaxTorque = Module.cwrap(
    "b2FrictionJoint_SetMaxTorque",
    "number",
    ["number", "number"]
  );

  function b2FrictionJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.maxForce = def.maxForce;
    this.maxTorque = def.maxTorque;
    this.userData = def.userData;
  }
  b2FrictionJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2FrictionJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2FrictionJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2FrictionJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2FrictionJoint.prototype.SetMaxForce = function (maxForce) {
    return b2FrictionJoint_SetMaxForce(this.ptr, maxForce);
  };
  b2FrictionJoint.prototype.SetMaxTorque = function (torque) {
    return b2FrictionJoint_SetMaxTorque(this.ptr, torque);
  };
  var b2RevoluteJoint_EnableLimit = Module.cwrap(
    "b2RevoluteJoint_EnableLimit",
    "number",
    ["number", "number"]
  );
  var b2RevoluteJoint_EnableMotor = Module.cwrap(
    "b2RevoluteJoint_EnableMotor",
    "number",
    ["number", "number"]
  );
  var b2RevoluteJoint_GetJointAngle = Module.cwrap(
    "b2RevoluteJoint_GetJointAngle",
    "number",
    ["number"]
  );
  var b2RevoluteJoint_IsLimitEnabled = Module.cwrap(
    "b2RevoluteJoint_IsLimitEnabled",
    "number",
    ["number"]
  );
  var b2RevoluteJoint_IsMotorEnabled = Module.cwrap(
    "b2RevoluteJoint_IsMotorEnabled",
    "number",
    ["number"]
  );
  var b2RevoluteJoint_SetMotorSpeed = Module.cwrap(
    "b2RevoluteJoint_SetMotorSpeed",
    "number",
    ["number", "number"]
  );
  var b2RevoluteJoint_GetReactionForce = Module.cwrap(
    "b2RevoluteJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2RevoluteJoint_GetReactionTorque = Module.cwrap(
    "b2RevoluteJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2RevoluteJoint_GetJointSpeed = Module.cwrap(
    "b2RevoluteJoint_GetJointSpeed",
    "null",
    ["number", "number"]
  );
  var b2RevoluteJoint_GetMotorTorque = Module.cwrap(
    "b2RevoluteJoint_GetMotorTorque",
    "null",
    ["number", "number", "number"]
  );
  var b2RevoluteJoint_SetMaxMotorTorque = Module.cwrap(
    "b2RevoluteJoint_SetMaxMotorTorque",
    "null",
    ["number", "number", "number"]
  );
  var b2RevoluteJoint_SetLimits = Module.cwrap(
    "b2RevoluteJoint_SetLimits",
    "null",
    ["number", "number", "number", "number"]
  );
  var b2RevoluteJoint_SetReferenceAngle = Module.cwrap(
    "b2RevoluteJoint_SetReferenceAngle",
    "null",
    ["number", "number", "number"]
  );

  function b2RevoluteJoint(def) {
    this.next = null;
    this.ptr = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.referenceAngle = def.referenceAngle;
    this.collideConnected = def.collideConnected;
    this.enableLimit = def.enableLimit;
    this.enableMotor = def.enableMotor;
    this.lowerAngle = def.lowerAngle;
    this.maxMotorTorque = def.maxMotorTorque;
    this.motorSpeed = def.motorSpeed;
    this.upperAngle = def.upperAngle;
    this.userData = def.userData;
  }
  b2RevoluteJoint.prototype = new b2Joint();
  b2RevoluteJoint.prototype.EnableLimit = function (flag) {
    b2RevoluteJoint_EnableLimit(this.ptr, flag);
  };
  b2RevoluteJoint.prototype.EnableMotor = function (flag) {
    b2RevoluteJoint_EnableMotor(this.ptr, flag);
  };
  b2RevoluteJoint.prototype.GetJointAngle = function () {
    return b2RevoluteJoint_GetJointAngle(this.ptr);
  };
  b2RevoluteJoint.prototype.IsLimitEnabled = function () {
    return b2RevoluteJoint_IsLimitEnabled(this.ptr);
  };
  b2RevoluteJoint.prototype.IsMotorEnabled = function () {
    return b2RevoluteJoint_IsMotorEnabled(this.ptr);
  };
  b2RevoluteJoint.prototype.SetMotorSpeed = function (speed) {
    b2RevoluteJoint_SetMotorSpeed(this.ptr, speed);
    this.motorSpeed = speed;
  };
  b2RevoluteJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2RevoluteJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2RevoluteJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2RevoluteJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2RevoluteJoint.prototype.GetJointSpeed = function () {
    return b2RevoluteJoint_GetJointSpeed(this.ptr);
  };
  b2RevoluteJoint.prototype.GetMotorTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2RevoluteJoint_GetMotorTorque(this.ptr, invdt);
  };
  b2RevoluteJoint.prototype.SetMaxMotorTorque = function (torque) {
    b2RevoluteJoint_SetMaxMotorTorque(this.ptr, torque);
  };
  b2RevoluteJoint.prototype.SetLimtis = function (lower, upper) {
    b2RevoluteJoint_SetLimits(this.ptr, lower, upper);
  };
  b2RevoluteJoint.prototype.SetReferenceAngle = function (angle) {
    b2RevoluteJoint_SetReferenceAngle(this.ptr, angle);
  };
  var b2RevoluteJointDef_Create = Module.cwrap(
    "b2RevoluteJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2RevoluteJointDef_InitializeAndCreate = Module.cwrap(
    "b2RevoluteJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2RevoluteJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.enableLimit = false;
    this.enableMotor = false;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.lowerAngle = 0;
    this.maxMotorTorque = 0;
    this.motorSpeed = 0;
    this.referenceAngle = 0;
    this.upperAngle = 0;
    this.userData = null;
  }
  b2RevoluteJointDef.prototype.Create = function (world) {
    var revoluteJoint = new b2RevoluteJoint(this);
    revoluteJoint.ptr = b2RevoluteJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.enableLimit,
      this.enableMotor,
      this.lowerAngle,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      this.maxMotorTorque,
      this.motorSpeed,
      this.referenceAngle,
      this.upperAngle
    );
    return revoluteJoint;
  };
  b2RevoluteJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchor
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var revoluteJoint = new b2RevoluteJoint(this);
    revoluteJoint.ptr = b2RevoluteJointDef_InitializeAndCreate(
      world.ptr,
      bodyA.ptr,
      bodyB.ptr,
      anchor.x,
      anchor.y,
      this.collideConnected,
      this.enableLimit,
      this.enableMotor,
      this.lowerAngle,
      this.maxMotorTorque,
      this.motorSpeed,
      this.upperAngle
    );
    b2World._Push(revoluteJoint, world.joints);
    return revoluteJoint;
  };
  var b2MotorJoint_SetAngularOffset = Module.cwrap(
    "b2MotorJoint_SetAngularOffset",
    "null",
    ["number", "number"]
  );
  var b2MotorJoint_SetLinearOffset = Module.cwrap(
    "b2MotorJoint_SetLinearOffset",
    "null",
    ["number", "number", "number"]
  );
  var b2MotorJoint_GetReactionForce = Module.cwrap(
    "b2MotorJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2MotorJoint_GetReactionTorque = Module.cwrap(
    "b2MotorJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );

  function b2MotorJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.angularOffset = def.angularOffset;
    this.correctionFactor = def.correctionFactor;
    this.linearOffset = def.linearOffset;
    this.maxForce = def.maxForce;
    this.maxTorque = def.maxTorque;
    this.userData = def.userData;
  }
  b2MotorJoint.prototype.SetAngularOffset = function (angle) {
    b2MotorJoint_SetAngularOffset(this.ptr, angle);
  };
  b2MotorJoint.prototype.SetLinearOffset = function (v) {
    b2MotorJoint_SetLinearOffset(this.ptr, v.x, v.y);
  };
  b2MotorJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2MotorJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2MotorJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2MotorJoint_GetReactionTorque(this.ptr, invdt);
  };
  var b2MotorJointDef_Create = Module.cwrap(
    "b2MotorJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2MotorJointDef_InitializeAndCreate = Module.cwrap(
    "b2MotorJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2MotorJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.angularOffset = 0;
    this.correctionFactor = 0.3;
    this.linearOffset = new b2Vec2();
    this.maxForce = 0;
    this.maxTorque = 0;
    this.userData = null;
  }
  b2MotorJointDef.prototype.Create = function (world) {
    var motorJoint = new b2MotorJoint(this);
    motorJoint.ptr = b2MotorJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.angularOffset,
      this.correctionFactor,
      this.linearOffset.x,
      this.linearOffset.y,
      this.maxForce,
      this.maxTorque
    );
    return motorJoint;
  };
  b2MotorJointDef.prototype.InitializeAndCreate = function (bodyA, bodyB) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var motorJoint = new b2MotorJoint(this);
    motorJoint.ptr = b2MotorJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.correctionFactor,
      this.maxForce,
      this.maxTorque
    );
    b2World._Push(motorJoint, world.joints);
    return motorJoint;
  };
  var b2PulleyJoint_GetReactionForce = Module.cwrap(
    "b2PulleyJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2PulleyJoint_GetReactionTorque = Module.cwrap(
    "b2PulleyJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );

  function b2PulleyJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.groundAnchorA = def.groundAnchorA;
    this.groundAnchorB = def.groundAnchorB;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.lengthA = def.lengthA;
    this.lengthB = def.lengthB;
    this.ratio = def.ratio;
    this.userData = def.userData;
  }
  b2PulleyJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2PulleyJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2PulleyJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2PulleyJoint_GetReactionTorque(this.ptr, invdt);
  };
  var b2PulleyJointDef_Create = Module.cwrap(
    "b2PulleyJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PulleyJointDef_InitializeAndCreate = Module.cwrap(
    "b2PulleyJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2PulleyJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = true;
    this.groundAnchorA = new b2Vec2();
    this.groundAnchorB = new b2Vec2();
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.lengthA = 0;
    this.lengthB = 0;
    this.ratio = 1;
    this.userData = null;
  }
  b2PulleyJointDef.prototype.Create = function (world) {
    var pulleyJoint = new b2PulleyJoint(this);
    pulleyJoint.ptr = b2PulleyJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.groundAnchorA.x,
      this.groundAnchorA.y,
      this.groundAnchorB.x,
      this.groundAnchorB.y,
      this.lengthA,
      this.lengthB,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      this.ratio
    );
    return pulleyJoint;
  };
  b2PulleyJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    groundAnchorA,
    groundAnchorB,
    anchorA,
    anchorB,
    ratio
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var pulleyJoint = new b2PulleyJoint(this);
    pulleyJoint.ptr = b2PulleyJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchorA.x,
      anchorA.y,
      anchorB.x,
      anchorB.y,
      groundAnchorA.x,
      groundAnchorA.y,
      groundAnchorB.x,
      groundAnchorB.y,
      ratio,
      this.collideConnected
    );
    b2World._Push(pulleyJoint, world.joints);
    return pulleyJoint;
  };

  function b2DistanceJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.dampingRatio = def.dampingRatio;
    this.length = def.length;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.frequencyHz = def.frequencyHz;
    this.userData = def.userData;
  }
  var b2DistanceJointDef_Create = Module.cwrap(
    "b2DistanceJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2DistanceJointDef_InitializeAndCreate = Module.cwrap(
    "b2DistanceJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2DistanceJoint_GetReactionForce = Module.cwrap(
    "b2DistanceJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2DistanceJoint_GetReactionTorque = Module.cwrap(
    "b2DistanceJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2DistanceJoint_SetLength = Module.cwrap(
    "b2DistanceJoint_SetLength",
    "number",
    ["number"]
  );
  var b2DistanceJoint_SetFrequency = Module.cwrap(
    "b2DistanceJoint_SetFrequency",
    "number",
    ["number"]
  );
  var b2DistanceJoint_SetDampingRatio = Module.cwrap(
    "b2DistanceJoint_SetDampingRatio",
    "number",
    ["number"]
  );

  function b2DistanceJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.dampingRatio = 0;
    this.length = 1;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.frequencyHz = 0;
    this.userData = null;
  }
  b2DistanceJointDef.prototype.Create = function (world) {
    var distanceJoint = new b2DistanceJoint(this);
    distanceJoint.ptr = b2DistanceJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.dampingRatio,
      this.frequencyHz,
      this.length,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y
    );
    return distanceJoint;
  };
  b2DistanceJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchorA,
    anchorB
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var distanceJoint = new b2DistanceJoint(this);
    distanceJoint.ptr = b2DistanceJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchorA.x,
      anchorA.y,
      anchorB.x,
      anchorB.y,
      this.collideConnected,
      this.dampingRatio,
      this.frequencyHz
    );
    b2World._Push(distanceJoint, world.joints);
    return distanceJoint;
  };
  b2DistanceJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2DistanceJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2DistanceJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2DistanceJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2DistanceJoint.prototype.SetLength = function (length) {
    b2DistanceJoint_SetLength(this.ptr, length);
  };
  b2DistanceJoint.prototype.SetFrequency = function (hz) {
    b2DistanceJoint_SetFrequency(this.ptr, hz);
  };
  b2DistanceJoint.prototype.SetDampingRatio = function (ratio) {
    b2DistanceJoint_SetDampingRatio(this.ptr, ratio);
  };
  var b2PrismaticJoint_EnableLimit = Module.cwrap(
    "b2PrismaticJoint_EnableLimit",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_EnableMotor = Module.cwrap(
    "b2PrismaticJoint_EnableMotor",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_GetJointTranslation = Module.cwrap(
    "b2PrismaticJoint_GetJointTranslation",
    "number",
    ["number"]
  );
  var b2PrismaticJoint_GetMotorSpeed = Module.cwrap(
    "b2PrismaticJoint_GetMotorSpeed",
    "number",
    ["number"]
  );
  var b2PrismaticJoint_GetMotorForce = Module.cwrap(
    "b2PrismaticJoint_GetMotorForce",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_IsLimitEnabled = Module.cwrap(
    "b2PrismaticJoint_IsLimitEnabled",
    "number",
    ["number"]
  );
  var b2PrismaticJoint_IsMotorEnabled = Module.cwrap(
    "b2PrismaticJoint_IsMotorEnabled",
    "number",
    ["number"]
  );
  var b2PrismaticJoint_SetMotorSpeed = Module.cwrap(
    "b2PrismaticJoint_SetMotorSpeed",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_GetReactionForce = Module.cwrap(
    "b2PrismaticJoint_GetReactionForce",
    "null",
    ["number", "number"]
  );
  var b2PrismaticJoint_GetReactionTorque = Module.cwrap(
    "b2PrismaticJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_SetMaxMotorForce = Module.cwrap(
    "b2PrismaticJoint_SetMaxMotorForce",
    "number",
    ["number", "number"]
  );
  var b2PrismaticJoint_SetLocalAxisA = Module.cwrap(
    "b2PrismaticJoint_SetLocalAxisA",
    "number",
    ["number", "number", "number"]
  );
  var b2PrismaticJoint_SetLimits = Module.cwrap(
    "b2PrismaticJoint_SetLimits",
    "number",
    ["number", "number", "number"]
  );

  function b2PrismaticJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.enableLimit = def.enableLimit;
    this.enableMotor = def.enableMotor;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.localAxisA = def.localAxisA;
    this.lowerTranslation = def.lowerTranslation;
    this.maxMotorForce = def.maxMotorForce;
    this.motorSpeed = def.motorSpeed;
    this.referenceAngle = def.referenceAngle;
    this.upperTranslation = def.upperTranslation;
    this.userData = def.userData;
  }
  b2PrismaticJoint.prototype = new b2Joint();
  b2PrismaticJoint.prototype.EnableLimit = function (flag) {
    b2PrismaticJoint_EnableLimit(this.ptr, flag);
  };
  b2PrismaticJoint.prototype.EnableMotor = function (flag) {
    b2PrismaticJoint_EnableMotor(this.ptr, flag);
  };
  b2PrismaticJoint.prototype.GetJointTranslation = function () {
    return b2PrismaticJoint_GetJointTranslation(this.ptr);
  };
  b2PrismaticJoint.prototype.GetMotorSpeed = function () {
    return b2PrismaticJoint_GetMotorSpeed(this.ptr);
  };
  b2PrismaticJoint.prototype.GetMotorForce = function (hz) {
    return b2PrismaticJoint_GetMotorForce(this.ptr, hz);
  };
  b2PrismaticJoint.prototype.IsLimitEnabled = function () {
    return b2PrismaticJoint_IsLimitEnabled(this.ptr);
  };
  b2PrismaticJoint.prototype.IsMotorEnabled = function () {
    return b2PrismaticJoint_IsMotorEnabled(this.ptr);
  };
  b2PrismaticJoint.prototype.SetMotorSpeed = function (speed) {
    b2PrismaticJoint_SetMotorSpeed(this.ptr, speed);
  };
  b2PrismaticJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2PrismaticJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2PrismaticJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2PrismaticJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2PrismaticJoint.prototype.SetLocalAxisA = function (axis) {
    var axisX = Math.cos(axis);
    var axisY = Math.sin(axis);
    b2PrismaticJoint_SetLocalAxisA(this.ptr, axisX, axisY);
  };
  b2PrismaticJoint.prototype.SetMaxMotorForce = function (force) {
    b2PrismaticJoint_SetMaxMotorForce(this.ptr, force);
  };
  b2PrismaticJoint.prototype.SetLimits = function (lower, upper) {
    b2PrismaticJoint_SetLimits(this.ptr, lower, upper);
  };
  var b2PrismaticJointDef_Create = Module.cwrap(
    "b2PrismaticJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2PrismaticJointDef_InitializeAndCreate = Module.cwrap(
    "b2PrismaticJointDef_InitializeAndCreate",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2PrismaticJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.enableLimit = false;
    this.enableMotor = false;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.localAxisA = 0;
    this.lowerTranslation = 0;
    this.maxMotorForce = 0;
    this.motorSpeed = 0;
    this.referenceAngle = 0;
    this.upperTranslation = 0;
    this.userData = null;
  }
  b2PrismaticJointDef.prototype.Create = function (world) {
    var prismaticJoint = new b2PrismaticJoint(this);
    prismaticJoint.ptr = b2PrismaticJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.enableLimit,
      this.enableMotor,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      Math.cos(this.localAxisA),
      Math.sin(this.localAxisA),
      this.lowerTranslation,
      this.maxMotorForce,
      this.motorSpeed,
      this.referenceAngle,
      this.upperTranslation
    );
    return prismaticJoint;
  };
  b2PrismaticJointDef.prototype.InitializeAndCreate = function (
    bodyA,
    bodyB,
    anchor,
    axis
  ) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    var prismaticJoint = new b2PrismaticJoint(this);
    prismaticJoint.ptr = b2PrismaticJointDef_InitializeAndCreate(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      anchor.x,
      anchor.y,
      Math.cos(axis),
      Math.sin(axis),
      this.collideConnected,
      this.enableLimit,
      this.enableMotor,
      this.lowerTranslation,
      this.maxMotorForce,
      this.motorSpeed,
      this.upperTranslation
    );
    b2World._Push(prismaticJoint, world.joints);
    return prismaticJoint;
  };
  var b2RopeJoint_GetReactionForce = Module.cwrap(
    "b2RopeJoint_GetReactionForce",
    "null",
    ["number", "number", "number"]
  );
  var b2RopeJoint_GetReactionTorque = Module.cwrap(
    "b2RopeJoint_GetReactionTorque",
    "number",
    ["number", "number"]
  );
  var b2RopeJoint_SetMaxLength = Module.cwrap(
    "b2RopeJoint_SetMaxLength",
    "number",
    ["number", "number"]
  );

  function b2RopeJoint(def) {
    this.next = null;
    this.ptr = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.localAnchorA = def.localAnchorA;
    this.localAnchorB = def.localAnchorB;
    this.maxLength = def.maxLength;
    this.userData = def.userData;
  }
  b2RopeJoint.prototype.GetReactionForce = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    b2RopeJoint_GetReactionForce(this.ptr, invdt, _vec2Buf.byteOffset);
    var result = new Float32Array(
      _vec2Buf.buffer,
      _vec2Buf.byteOffset,
      _vec2Buf.length
    );
    return new b2Vec2(result[0], result[1]);
  };
  b2RopeJoint.prototype.GetReactionTorque = function (dt) {
    var invdt = dt > 0 ? 1 / dt : 1;
    return b2RopeJoint_GetReactionTorque(this.ptr, invdt);
  };
  b2RopeJoint.prototype.SetMaxLength = function (length) {
    length = Math.max(0.005, length);
    return b2RopeJoint_SetMaxLength(this.ptr, length);
  };
  var b2RopeJointDef_Create = Module.cwrap("b2RopeJointDef_Create", "number", [
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);

  function b2RopeJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.localAnchorA = new b2Vec2();
    this.localAnchorB = new b2Vec2();
    this.maxLength = 0.005;
    this.userData = null;
  }
  b2RopeJointDef.prototype.Create = function (world) {
    var ropeJoint = new b2RopeJoint(this);
    ropeJoint.ptr = b2RopeJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.localAnchorA.x,
      this.localAnchorA.y,
      this.localAnchorB.x,
      this.localAnchorB.y,
      Math.max(0.005, this.maxLength)
    );
    return ropeJoint;
  };
  var b2MouseJoint_SetTarget = Module.cwrap("b2MouseJoint_SetTarget", "null", [
    "number",
    "number",
    "number",
  ]);

  function b2MouseJoint(def) {
    this.ptr = null;
    this.next = null;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = def.collideConnected;
    this.dampingRatio = def.dampingRatio;
    this.frequencyHz = def.frequencyHz;
    this.maxForce = def.maxForce;
    this.target = def.target;
    this.userData = def.userData;
  }
  b2MouseJoint.prototype.SetTarget = function (p) {
    b2MouseJoint_SetTarget(this.ptr, p.x, p.y);
  };
  var b2MouseJointDef_Create = Module.cwrap(
    "b2MouseJointDef_Create",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );

  function b2MouseJointDef() {
    this.bodyA = null;
    this.bodyB = null;
    this.collideConnected = false;
    this.dampingRatio = 0.7;
    this.frequencyHz = 5;
    this.maxForce = 0;
    this.target = new b2Vec2();
    this.userData = null;
  }
  b2MouseJointDef.prototype.Create = function (world) {
    var mouseJoint = new b2MouseJoint(this);
    mouseJoint.ptr = b2MouseJointDef_Create(
      world.ptr,
      this.bodyA.ptr,
      this.bodyB.ptr,
      this.collideConnected,
      this.dampingRatio,
      this.frequencyHz,
      this.maxForce,
      this.target.x,
      this.target.y
    );
    return mouseJoint;
  };
  var b2Contact_flags_offset = Offsets.b2Contact.flags;
  var b2Contact_fixtureA_offset = Offsets.b2Contact.fixtureA;
  var b2Contact_fixtureB_offset = Offsets.b2Contact.fixtureB;
  var b2Contact_tangentSpeed_offset = Offsets.b2Contact.tangentSpeed;
  var e_enabledFlag = 4;
  var b2Contact_GetManifold = Module.cwrap("b2Contact_GetManifold", "number", [
    "number",
  ]);
  var b2Contact_GetWorldManifold = Module.cwrap(
    "b2Contact_GetWorldManifold",
    "number",
    ["number"]
  );

  function b2Contact(ptr) {
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
    this.ptr = ptr;
  }
  b2Contact.prototype.GetFixtureA = function () {
    var fixAPtr = this.buffer.getUint32(b2Contact_fixtureA_offset, true);
    return world.fixturesLookup[fixAPtr];
  };
  b2Contact.prototype.GetFixtureB = function () {
    var fixBPtr = this.buffer.getUint32(b2Contact_fixtureB_offset, true);
    return world.fixturesLookup[fixBPtr];
  };
  b2Contact.prototype.GetManifold = function () {
    return new b2Manifold(b2Contact_GetManifold(this.ptr));
  };
  b2Contact.prototype.GetWorldManifold = function () {
    return new b2WorldManifold(b2Contact_GetWorldManifold(this.ptr));
  };
  b2Contact.prototype.SetTangentSpeed = function (speed) {
    this.buffer.setFloat32(b2Contact_tangentSpeed_offset, speed, true);
  };
  b2Contact.prototype.SetEnabled = function (enable) {
    var flags = this.buffer.getUint32(b2Contact_flags_offset, true);
    if (enable) {
      flags = flags | e_enabledFlag;
    } else {
      flags = flags & ~e_enabledFlag;
    }
    this.buffer.setUint32(b2Contact_flags_offset, flags, true);
  };
  b2Contact.prototype.IsEnabled = function () {
    var flags = this.buffer.getUint32(b2Contact_flags_offset, true);
    return flags & e_enabledFlag;
  };

  function b2Filter() {
    this.categoryBits = 1;
    this.maskBits = 65535;
    this.groupIndex = 0;
  }
  var b2Fixture_isSensor_offset = Offsets.b2Fixture.isSensor;
  var b2Fixture_userData_offset = Offsets.b2Fixture.userData;
  var b2Fixture_filter_categoryBits_offset =
    Offsets.b2Fixture.filterCategoryBits;
  var b2Fixture_filter_maskBits_offset = Offsets.b2Fixture.filterMaskBits;
  var b2Fixture_filter_groupIndex_offset = Offsets.b2Fixture.filterGroupIndex;

  function b2Fixture() {
    this.body = null;
    this.buffer = null;
    this.ptr = null;
    this.shape = null;
  }
  var b2Fixture_TestPoint = Module.cwrap("b2Fixture_TestPoint", "number", [
    "number",
    "number",
    "number",
  ]);
  var b2Fixture_Refilter = Module.cwrap("b2Fixture_Refilter", "null", [
    "number",
  ]);
  var b2Fixture_SetRestitution = Module.cwrap(
    "b2Fixture_SetRestitution",
    "null",
    ["number", "number"]
  );
  var b2Fixture_SetDensity = Module.cwrap("b2Fixture_SetDensity", "null", [
    "number",
    "number",
  ]);
  var b2Fixture_SetFriction = Module.cwrap("b2Fixture_SetFriction", "null", [
    "number",
    "number",
  ]);
  var b2Fixture_SetSensor = Module.cwrap("b2Fixture_SetSensor", "null", [
    "number",
    "number",
  ]);
  b2Fixture.prototype._SetPtr = function (ptr) {
    this.ptr = ptr;
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
  };
  b2Fixture.prototype.FromFixtureDef = function (fixtureDef) {
    this.density = fixtureDef.density;
    this.friction = fixtureDef.friction;
    this.isSensor = fixtureDef.isSensor;
    this.restitution = fixtureDef.restitution;
    this.shape = fixtureDef.shape;
    this.userData = fixtureDef.userData;
    this.vertices = [];
  };
  b2Fixture.prototype.GetUserData = function () {
    return this.buffer.getUint32(b2Fixture_userData_offset, true);
  };
  b2Fixture.prototype.SetFilterData = function (filter) {
    this.buffer.setUint16(
      b2Fixture_filter_categoryBits_offset,
      filter.categoryBits,
      true
    );
    this.buffer.setUint16(
      b2Fixture_filter_maskBits_offset,
      filter.maskBits,
      true
    );
    this.buffer.setUint16(
      b2Fixture_filter_groupIndex_offset,
      filter.groupIndex,
      true
    );
    this.Refilter();
  };
  b2Fixture.prototype.SetSensor = function (flag) {
    this.buffer.setUint32(b2Fixture_isSensor_offset, flag, true);
  };
  b2Fixture.prototype.Refilter = function () {
    b2Fixture_Refilter(this.ptr);
  };
  b2Fixture.prototype.TestPoint = function (p) {
    return b2Fixture_TestPoint(this.ptr, p.x, p.y);
  };
  b2Fixture.prototype.SetRestitution = function (restitution) {
    return b2Fixture_SetRestitution(this.ptr, restitution);
  };
  b2Fixture.prototype.SetDensity = function (density) {
    return b2Fixture_SetDensity(this.ptr, density);
  };
  b2Fixture.prototype.SetFriction = function (friction) {
    return b2Fixture_SetFriction(this.ptr, friction);
  };
  b2Fixture.prototype.SetSensor = function (flag) {
    return b2Fixture_SetSensor(this.ptr, flag);
  };

  function b2FixtureDef() {
    this.density = 0.0;
    this.friction = 0.2;
    this.isSensor = false;
    this.restitution = 0.0;
    this.shape = null;
    this.userData = null;
    this.filter = new b2Filter();
  }

  function b2ContactImpulse(ptr) {
    this.ptr = ptr;
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
  }
  b2ContactImpulse.prototype.GetNormalImpulse = function (i) {
    return this.buffer.getFloat32(i * 4, true);
  };
  b2ContactImpulse.prototype.GetTangentImpulse = function (i) {
    return this.buffer.getFloat32(i * 4 + 8, true);
  };
  b2ContactImpulse.prototype.GetCount = function (i) {
    return this.buffer.getInt32(16, true);
  };

  function b2ParticleSystemDef() {
    this.colorMixingStrength = 1 / 128;
    this.dampingStrength = 1.0;
    this.destroyByAge = true;
    this.ejectionStrength = 0.5;
    this.elasticStrength = 0.25;
    this.lifetimeGranularity = 1.0 / 60.0;
    this.powderStrength = 0.5;
    this.pressureStrength = 0.05;
    this.radius = 1.0;
    this.repulsiveStrength = 1.0;
    this.springStrength = 0.25;
    this.staticPressureIterations = 8;
    this.staticPressureRelaxation = 0.2;
    this.staticPressureStrength = 0.2;
    this.surfaceTensionNormalStrength = 0.2;
    this.surfaceTensionPressureStrength = 0.2;
    this.viscousStrength = 0.25;
  }
  var b2ParticleSystem_CreateParticle = Module.cwrap(
    "b2ParticleSystem_CreateParticle",
    "number",
    [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]
  );
  var b2ParticleSystem_GetColorBuffer = Module.cwrap(
    "b2ParticleSystem_GetColorBuffer",
    "number",
    ["number"]
  );
  var b2ParticleSystem_GetParticleCount = Module.cwrap(
    "b2ParticleSystem_GetParticleCount",
    "number",
    ["number"]
  );
  var b2ParticleSystem_GetParticleLifetime = Module.cwrap(
    "b2ParticleSystem_GetParticleLifetime",
    "number",
    ["number", "number"]
  );
  var b2ParticleSystem_GetPositionBuffer = Module.cwrap(
    "b2ParticleSystem_GetPositionBuffer",
    "number",
    ["number"]
  );
  var b2ParticleSystem_GetVelocityBuffer = Module.cwrap(
    "b2ParticleSystem_GetVelocityBuffer",
    "number",
    ["number"]
  );
  var b2ParticleSystem_SetDamping = Module.cwrap(
    "b2ParticleSystem_SetDamping",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetDensity = Module.cwrap(
    "b2ParticleSystem_SetDensity",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetGravityScale = Module.cwrap(
    "b2ParticleSystem_SetGravityScale",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetMaxParticleCount = Module.cwrap(
    "b2ParticleSystem_SetMaxParticleCount",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetParticleLifetime = Module.cwrap(
    "b2ParticleSystem_SetParticleLifetime",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleSystem_SetRadius = Module.cwrap(
    "b2ParticleSystem_SetRadius",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_ParticleApplyLinearImpulse = Module.cwrap(
    "b2ParticleSystem_ParticleApplyLinearImpulse",
    "null",
    ["number", "number", "number", "number"]
  );
  var b2ParticleSystem_ParticleApplyForce = Module.cwrap(
    "b2ParticleSystem_ParticleApplyForce",
    "null",
    ["number", "number", "number", "number"]
  );
  var b2ParticleSystem_SetPaused = Module.cwrap(
    "b2ParticleSystem_SetPaused",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_DestroyParticle = Module.cwrap(
    "b2ParticleSystem_DestroyParticle",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_GetUserDataBuffer = Module.cwrap(
    "b2ParticleSystem_GetUserDataBuffer",
    "number",
    ["number"]
  );
  var b2ParticleSystem_SetParticleFlags = Module.cwrap(
    "b2ParticleSystem_SetParticleFlags",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleSystem_GetParticleFlags = Module.cwrap(
    "b2ParticleSystem_GetParticleFlags",
    "number",
    ["number", "number"]
  );
  var b2ParticleSystem_SetViscousStrength = Module.cwrap(
    "b2ParticleSystem_SetViscousStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetPressureStrength = Module.cwrap(
    "b2ParticleSystem_SetPressureStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetElasticStrength = Module.cwrap(
    "b2ParticleSystem_SetElasticStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetSpringStrength = Module.cwrap(
    "b2ParticleSystem_SetSpringStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetTensileSmoothing = Module.cwrap(
    "b2ParticleSystem_SetTensileSmoothing",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetTensileTension = Module.cwrap(
    "b2ParticleSystem_SetTensileTension",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetRepulsiveStrength = Module.cwrap(
    "b2ParticleSystem_SetRepulsiveStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetPowderStrength = Module.cwrap(
    "b2ParticleSystem_SetPowderStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetEjectionStrength = Module.cwrap(
    "b2ParticleSystem_SetEjectionStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetStaticPressureStrength = Module.cwrap(
    "b2ParticleSystem_SetStaticPressureStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetStaticPressureRelaxation = Module.cwrap(
    "b2ParticleSystem_SetStaticPressureRelaxation",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetColorMixingStrength = Module.cwrap(
    "b2ParticleSystem_SetColorMixingStrength",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetStaticPressureIterations = Module.cwrap(
    "b2ParticleSystem_SetStaticPressureIterations",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetGroupParticleFlags = Module.cwrap(
    "b2ParticleSystem_SetGroupParticleFlags",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleSystem_SwitchOneParticleFlagInGroup = Module.cwrap(
    "b2ParticleSystem_SwitchOneParticleFlagInGroup",
    "null",
    ["number", "number", "number", "number"]
  );
  var b2ParticleSystem_SetAllParticleFlags = Module.cwrap(
    "b2ParticleSystem_SetAllParticleFlags",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SwitchOneParticleFlag = Module.cwrap(
    "b2ParticleSystem_SwitchOneParticleFlag",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleSystem_SetLifetimeGranularity = Module.cwrap(
    "b2ParticleSystem_SetLifetimeGranularity",
    "null",
    ["number", "number"]
  );
  var b2ParticleSystem_SetParticleColor = Module.cwrap(
    "b2ParticleSystem_SetParticleColor",
    "null",
    ["number", "number", "number", "number", "number"]
  );
  var b2ParticleSystem_GetParticleIndexFromHandle = Module.cwrap(
    "b2ParticleSystem_GetParticleIndexFromHandle",
    "number",
    ["number", "number"]
  );
  var b2ParticleSystem_GetParticleHandleFromIndex = Module.cwrap(
    "b2ParticleSystem_GetParticleHandleFromIndex",
    "number",
    ["number", "number"]
  );
  var b2ParticleSystem_GetArrayOfHandleUids = Module.cwrap(
    "b2ParticleSystem_GetArrayOfHandleUids",
    "number",
    ["number"]
  );
  var b2ParticleSystem_GetGroupBufferBoundaries = Module.cwrap(
    "b2ParticleSystem_GetGroupBufferBoundaries",
    "number",
    ["number", "number"]
  );
  var b2ParticleSystem_SetStrictContactCheck = Module.cwrap(
    "b2ParticleSystem_SetStrictContactCheck",
    "null",
    ["number", "number"]
  );

  function b2ParticleSystem(ptr) {
    this.dampingStrength = 1.0;
    this.density = 1.0;
    this.ptr = ptr;
    this.particleGroups = [];
    this.radius = 1.0;
    this.gravityScale = 1.0;
  }
  b2ParticleSystem.prototype.CreateParticle = function (pd) {
    return b2ParticleSystem_CreateParticle(
      this.ptr,
      pd.color.r,
      pd.color.g,
      pd.color.b,
      pd.color.a,
      pd.flags,
      pd.group.ptr,
      pd.lifetime,
      pd.position.x,
      pd.position.y,
      pd.userData,
      pd.velocity.x,
      pd.velocity.y
    );
  };
  b2ParticleSystem.prototype.CreateParticleGroup = function (pgd) {
    var particleGroup = new b2ParticleGroup(
      pgd.shape._CreateParticleGroup(this, pgd)
    );
    var len = this.particleGroups.length;
    for (var i = 0; i < len; i++) {
      if (this.particleGroups[i].ptr === particleGroup.ptr) {
        return particleGroup;
      }
    }
    this.particleGroups.push(particleGroup);
    return particleGroup;
  };
  b2ParticleSystem.prototype.DestroyParticlesInShape = function (shape, xf) {
    return shape._DestroyParticlesInShape(this, xf);
  };
  b2ParticleSystem.prototype.GetColorBuffer = function () {
    var count = b2ParticleSystem_GetParticleCount(this.ptr) * 4;
    var offset = b2ParticleSystem_GetColorBuffer(this.ptr);
    return new Uint8Array(Module.HEAPU8.buffer, offset, count);
  };
  b2ParticleSystem.prototype.GetParticleLifetime = function (index) {
    return b2ParticleSystem_GetParticleLifetime(this.ptr, index);
  };
  b2ParticleSystem.prototype.GetParticleCount = function () {
    return b2ParticleSystem_GetParticleCount(this.ptr);
  };
  b2ParticleSystem.prototype.GetPositionBuffer = function () {
    var count = b2ParticleSystem_GetParticleCount(this.ptr) * 2;
    var offset = b2ParticleSystem_GetPositionBuffer(this.ptr);
    return new Float32Array(Module.HEAPU8.buffer, offset, count);
  };
  b2ParticleSystem.prototype.GetVelocityBuffer = function () {
    var count = b2ParticleSystem_GetParticleCount(this.ptr) * 2;
    var offset = b2ParticleSystem_GetVelocityBuffer(this.ptr);
    return new Float32Array(Module.HEAPU8.buffer, offset, count);
  };
  b2ParticleSystem.prototype.SetDamping = function (damping) {
    this.dampingStrength = damping;
    b2ParticleSystem_SetDamping(this.ptr, damping);
  };
  b2ParticleSystem.prototype.SetDensity = function (density) {
    this.density = density;
    b2ParticleSystem_SetDensity(this.ptr, density);
  };
  b2ParticleSystem.prototype.SetGravityScale = function (gravityScale) {
    this.gravityScale = gravityScale;
    b2ParticleSystem_SetGravityScale(this.ptr, gravityScale);
  };
  b2ParticleSystem.prototype.SetMaxParticleCount = function (count) {
    b2ParticleSystem_SetMaxParticleCount(this.ptr, count);
  };
  b2ParticleSystem.prototype.SetParticleLifetime = function (index, lifetime) {
    b2ParticleSystem_SetParticleLifetime(this.ptr, index, lifetime);
  };
  b2ParticleSystem.prototype.SetRadius = function (radius) {
    this.radius = radius;
    b2ParticleSystem_SetRadius(this.ptr, radius);
  };
  b2ParticleSystem.prototype.ParticleApplyLinearImpulse = function (
    index,
    impulseX,
    impulseY
  ) {
    b2ParticleSystem_ParticleApplyLinearImpulse(
      this.ptr,
      index,
      impulseX,
      impulseY
    );
  };
  b2ParticleSystem.prototype.ParticleApplyForce = function (
    index,
    forceX,
    forceY
  ) {
    b2ParticleSystem_ParticleApplyForce(this.ptr, index, forceX, forceY);
  };
  b2ParticleSystem.prototype.SetPaused = function (paused) {
    b2ParticleSystem_SetPaused(this.ptr, paused);
  };
  b2ParticleSystem.prototype.DestroyParticle = function (index) {
    b2ParticleSystem_DestroyParticle(this.ptr, index);
  };
  b2ParticleSystem.prototype.GetUserDataBuffer = function () {
    var count = b2ParticleSystem_GetParticleCount(this.ptr);
    var offset = b2ParticleSystem_GetUserDataBuffer(this.ptr);
    return new Float32Array(Module.HEAPU8.buffer, offset, count);
  };
  b2ParticleSystem.prototype.SetParticleFlags = function (index, flags) {
    b2ParticleSystem_SetParticleFlags(this.ptr, index, flags);
  };
  b2ParticleSystem.prototype.GetParticleFlags = function (index) {
    return b2ParticleSystem_GetParticleFlags(this.ptr, index);
  };
  b2ParticleSystem.prototype.SetViscousStrength = function (strength) {
    b2ParticleSystem_SetViscousStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetPressureStrength = function (strength) {
    b2ParticleSystem_SetPressureStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetElasticStrength = function (strength) {
    b2ParticleSystem_SetElasticStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetSpringStrength = function (strength) {
    b2ParticleSystem_SetSpringStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetTensileSmoothing = function (strength) {
    b2ParticleSystem_SetTensileSmoothing(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetTensileTension = function (strength) {
    b2ParticleSystem_SetTensileTension(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetRepulsiveStrength = function (strength) {
    b2ParticleSystem_SetRepulsiveStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetPowderStrength = function (strength) {
    b2ParticleSystem_SetPowderStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetEjectionStrength = function (strength) {
    b2ParticleSystem_SetEjectionStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetStaticPressureStrength = function (strength) {
    b2ParticleSystem_SetStaticPressureStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetStaticPressureRelaxation = function (strength) {
    b2ParticleSystem_SetStaticPressureRelaxation(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetColorMixingStrength = function (strength) {
    b2ParticleSystem_SetColorMixingStrength(this.ptr, strength);
  };
  b2ParticleSystem.prototype.SetStaticPressureIterations = function (
    iterations
  ) {
    b2ParticleSystem_SetStaticPressureIterations(this.ptr, iterations);
  };
  b2ParticleSystem.prototype.SetGroupParticleFlags = function (group, flags) {
    b2ParticleSystem_SetGroupParticleFlags(this.ptr, group.ptr, flags);
  };
  b2ParticleSystem.prototype.SwitchOneParticleFlagInGroup = function (
    group,
    flag,
    turnOn
  ) {
    b2ParticleSystem_SwitchOneParticleFlagInGroup(
      this.ptr,
      group.ptr,
      flag,
      turnOn
    );
  };
  b2ParticleSystem.prototype.SetAllParticleFlags = function (flags) {
    b2ParticleSystem_SetAllParticleFlags(this.ptr, flags);
  };
  b2ParticleSystem.prototype.SwitchOneParticleFlag = function (flag, turnOn) {
    b2ParticleSystem_SwitchOneParticleFlag(this.ptr, flag, turnOn);
  };
  b2ParticleSystem.prototype.SetLifetimeGranularity = function (gran) {
    b2ParticleSystem_SetLifetimeGranularity(this.ptr, gran);
  };
  b2ParticleSystem.prototype.SetParticleColor = function (index, r, g, b, a) {
    b2ParticleSystem_SetParticleColor(this.ptr, index, r, g, b, a);
  };
  b2ParticleSystem.prototype.GetParticleHandleFromIndex = function (index) {
    return b2ParticleSystem_GetParticleHandleFromIndex(this.ptr, index);
  };
  b2ParticleSystem.prototype.GetParticleIndexFromHandle = function (handle) {
    return b2ParticleSystem_GetParticleIndexFromHandle(this.ptr, handle);
  };
  b2ParticleSystem.prototype.GetArrayOfHandleUids = function () {
    var count = b2ParticleSystem_GetParticleCount(this.ptr);
    var offset = b2ParticleSystem_GetArrayOfHandleUids(this.ptr);
    return new Uint32Array(Module.HEAPU8.buffer, offset, count);
  };
  b2ParticleSystem.prototype.GetGroupBufferBoundaries = function (group) {
    var offset = b2ParticleSystem_GetGroupBufferBoundaries(this.ptr, group.ptr);
    return new Uint32Array(Module.HEAPU8.buffer, offset, 2);
  };
  b2ParticleSystem.prototype.SetStrictContactCheck = function (enable) {
    b2ParticleSystem_SetStrictContactCheck(this.ptr, enable);
  };
  var b2_solidParticleGroup = 1 << 0;
  var b2_rigidParticleGroup = 1 << 1;
  var b2_particleGroupCanBeEmpty = 1 << 2;
  var b2_particleGroupWillBeDestroyed = 1 << 3;
  var b2_particleGroupNeedsUpdateDepth = 1 << 4;
  var b2_particleGroupInternalMask =
    b2_particleGroupWillBeDestroyed | b2_particleGroupNeedsUpdateDepth;
  var b2ParticleGroup_ApplyForce = Module.cwrap(
    "b2ParticleGroup_ApplyForce",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleGroup_ApplyLinearImpulse = Module.cwrap(
    "b2ParticleGroup_ApplyLinearImpulse",
    "null",
    ["number", "number", "number"]
  );
  var b2ParticleGroup_DestroyParticles = Module.cwrap(
    "b2ParticleGroup_DestroyParticles",
    "null",
    ["number", "number"]
  );
  var b2ParticleGroup_GetBufferIndex = Module.cwrap(
    "b2ParticleGroup_GetBufferIndex",
    "number",
    ["number"]
  );
  var b2ParticleGroup_GetParticleCount = Module.cwrap(
    "b2ParticleGroup_GetParticleCount",
    "number",
    ["number"]
  );
  var b2ParticleGroup_groupFlags_offset = Offsets.b2ParticleGroup.groupFlags;

  function b2ParticleGroup(ptr) {
    this.buffer = new DataView(Module.HEAPU8.buffer, ptr);
    this.ptr = ptr;
  }
  b2ParticleGroup.prototype.ApplyForce = function (forceX, forceY) {
    b2ParticleGroup_ApplyForce(this.ptr, forceX, forceY);
  };
  b2ParticleGroup.prototype.ApplyLinearImpulse = function (impulseX, impulseY) {
    b2ParticleGroup_ApplyLinearImpulse(this.ptr, impulseX, impulseY);
  };
  b2ParticleGroup.prototype.DestroyParticles = function (flag) {
    b2ParticleGroup_DestroyParticles(this.ptr, flag);
  };
  b2ParticleGroup.prototype.GetBufferIndex = function () {
    return b2ParticleGroup_GetBufferIndex(this.ptr);
  };
  b2ParticleGroup.prototype.GetGroupFlags = function () {
    return this.buffer.getUint32(b2ParticleGroup_groupFlags_offset, true);
  };
  b2ParticleGroup.prototype.GetParticleCount = function () {
    return b2ParticleGroup_GetParticleCount(this.ptr);
  };
  b2ParticleGroup.prototype.SetGroupFlags = function (flags) {
    this.buffer.setUint32(b2ParticleGroup_groupFlags_offset, flags, true);
  };

  function b2ParticleGroupDef() {
    this.angle = 0;
    this.angularVelocity = 0;
    this.color = new b2ParticleColor(0, 0, 0, 0);
    this.flags = 0;
    this.group = new b2ParticleGroup(null);
    this.groupFlags = 0;
    this.lifetime = 0.0;
    this.linearVelocity = new b2Vec2();
    this.position = new b2Vec2();
    this.positionData = null;
    this.particleCount = 0;
    this.shape = null;
    this.strength = 1;
    this.stride = 0;
    this.userData = null;
  }
  var b2_waterParticle = 0;
  var b2_zombieParticle = 1 << 1;
  var b2_wallParticle = 1 << 2;
  var b2_springParticle = 1 << 3;
  var b2_elasticParticle = 1 << 4;
  var b2_viscousParticle = 1 << 5;
  var b2_powderParticle = 1 << 6;
  var b2_tensileParticle = 1 << 7;
  var b2_colorMixingParticle = 1 << 8;
  var b2_destructionListenerParticle = 1 << 9;
  var b2_barrierParticle = 1 << 10;
  var b2_staticPressureParticle = 1 << 11;
  var b2_reactiveParticle = 1 << 12;
  var b2_repulsiveParticle = 1 << 13;
  var b2_fixtureContactListenerParticle = 1 << 14;
  var b2_particleContactListenerParticle = 1 << 15;
  var b2_fixtureContactFilterParticle = 1 << 16;
  var b2_particleContactFilterParticle = 1 << 17;

  function b2ParticleColor(r, g, b, a) {
    if (r === undefined) {
      r = 0;
    }
    if (g === undefined) {
      g = 0;
    }
    if (b === undefined) {
      b = 0;
    }
    if (a === undefined) {
      a = 0;
    }
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
  b2ParticleColor.prototype.Set = function (r, g, b, a) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  };

  function b2ParticleDef() {
    this.color = new b2ParticleColor(0, 0, 0, 0);
    this.flags = 0;
    this.group = 0;
    this.lifetime = 0.0;
    this.position = new b2Vec2();
    this.userData = null;
    this.velocity = new b2Vec2();
  }
  var world;
  var setWorld = function (e) {
    world = e;
  };
  var Links = {
    addOnPostRun: addOnPostRun,
    world: world,
    setWorld: setWorld,
    Box2D: Module,
    b2World: b2World,
    b2Max: b2Max,
    b2Min: b2Min,
    b2Clamp: b2Clamp,
    b2Vec2: b2Vec2,
    b2Rot: b2Rot,
    b2Transform: b2Transform,
    b2AABB: b2AABB,
    b2Manifold: b2Manifold,
    b2WorldManifold: b2WorldManifold,
    b2EdgeShape: b2EdgeShape,
    b2PolygonShape: b2PolygonShape,
    b2MassData: b2MassData,
    b2ChainShape: b2ChainShape,
    b2CircleShape: b2CircleShape,
    b2Body: b2Body,
    b2BodyDef: b2BodyDef,
    b2WheelJoint: b2WheelJoint,
    b2WheelJointDef: b2WheelJointDef,
    b2WeldJointDef: b2WeldJointDef,
    b2WeldJoint: b2WeldJoint,
    b2GearJoint: b2GearJoint,
    b2GearJointDef: b2GearJointDef,
    b2Joint: b2Joint,
    b2FrictionJointDef: b2FrictionJointDef,
    b2FrictionJoint: b2FrictionJoint,
    b2RevoluteJoint: b2RevoluteJoint,
    b2RevoluteJointDef: b2RevoluteJointDef,
    b2MotorJoint: b2MotorJoint,
    b2MotorJointDef: b2MotorJointDef,
    b2PulleyJoint: b2PulleyJoint,
    b2PulleyJointDef: b2PulleyJointDef,
    b2DistanceJoint: b2DistanceJoint,
    b2DistanceJointDef: b2DistanceJointDef,
    b2PrismaticJoint: b2PrismaticJoint,
    b2PrismaticJointDef: b2PrismaticJointDef,
    b2RopeJoint: b2RopeJoint,
    b2RopeJointDef: b2RopeJointDef,
    b2MouseJoint: b2MouseJoint,
    b2MouseJointDef: b2MouseJointDef,
    b2Contact: b2Contact,
    b2Filter: b2Filter,
    b2Fixture: b2Fixture,
    b2FixtureDef: b2FixtureDef,
    b2ContactImpulse: b2ContactImpulse,
    b2ParticleSystemDef: b2ParticleSystemDef,
    b2ParticleSystem: b2ParticleSystem,
    b2ParticleGroup: b2ParticleGroup,
    b2ParticleGroupDef: b2ParticleGroupDef,
    b2ParticleDef: b2ParticleDef,
    b2ParticleColor: b2ParticleColor,
    b2_waterParticle: b2_waterParticle,
    b2_zombieParticle: b2_zombieParticle,
    b2_wallParticle: b2_wallParticle,
    b2_springParticle: b2_springParticle,
    b2_elasticParticle: b2_elasticParticle,
    b2_viscousParticle: b2_viscousParticle,
    b2_powderParticle: b2_powderParticle,
    b2_tensileParticle: b2_tensileParticle,
    b2_colorMixingParticle: b2_colorMixingParticle,
    b2_destructionListenerParticle: b2_destructionListenerParticle,
    b2_barrierParticle: b2_barrierParticle,
    b2_staticPressureParticle: b2_staticPressureParticle,
    b2_reactiveParticle: b2_reactiveParticle,
    b2_repulsiveParticle: b2_repulsiveParticle,
    b2_fixtureContactListenerParticle: b2_fixtureContactListenerParticle,
    b2_particleContactListenerParticle: b2_particleContactListenerParticle,
    b2_fixtureContactFilterParticle: b2_fixtureContactFilterParticle,
    b2_particleContactFilterParticle: b2_particleContactFilterParticle,
    b2_solidParticleGroup: b2_solidParticleGroup,
    b2_rigidParticleGroup: b2_rigidParticleGroup,
    b2_particleGroupCanBeEmpty: b2_particleGroupCanBeEmpty,
    b2_particleGroupWillBeDestroyed: b2_particleGroupWillBeDestroyed,
    b2_particleGroupNeedsUpdateDepth: b2_particleGroupNeedsUpdateDepth,
    b2_particleGroupInternalMask: b2_particleGroupInternalMask,
    e_unknownJoint: e_unknownJoint,
    e_revoluteJoint: e_revoluteJoint,
    e_prismaticJoint: e_prismaticJoint,
    e_distanceJoint: e_distanceJoint,
    e_pulleyJoint: e_pulleyJoint,
    e_mouseJoint: e_mouseJoint,
    e_gearJoint: e_gearJoint,
    e_wheelJoint: e_wheelJoint,
    e_weldJoint: e_weldJoint,
    e_frictionJoint: e_frictionJoint,
    e_ropeJoint: e_ropeJoint,
    e_motorJoint: e_motorJoint,
  };
  addOnPostRun(LFJS.c3callback);
  return Links;
};
