'use strict';

import { Loader } from './loader.js';

/**
 * This manages all loaded modules known to the system.
 */
export class ModuleManager {
  declare _globalAllocator: any;
  declare _handles: any;
  declare _instances: any;
  declare _loaded: any;
  declare _modules: any;
  declare _segments: any;
  constructor(globalAllocator) {
    // Keep track of the modules we know of
    this._modules = {};

    // Keep track of handles of modules
    this._handles = {};

    // Keep track of the modules in memory
    this._loaded = {};

    // And the special system segments
    this._segments = {};

    // We allocate a segment to pretend to be the module's code
    // It contains interrupt thunks instead.
    this._globalAllocator = globalAllocator;
  }

  load(module) {
    // If it is already loaded, return the loader
    if (module instanceof Loader) {
      return module;
    }

    // Now we load the 'fake' modules
    // (Caching the ones we already know)
    if (this._loaded[module.name]) {
      return this._loaded[module.name];
    }

    const loadedModule: any = {
      instance: module,
      name: module.name,
      lookup: function (ordinal) {
        return {
          segment: loadedModule.segment,
          offset: loadedModule.step * (ordinal + 1),
        };
      },
    };

    // Keep track of it
    this._loaded[module.name] = loadedModule;

    // Assign it a segment
    loadedModule.segment = this._globalAllocator.find(4096);

    console.log('loading', module.name, '@', loadedModule.segment, 'with', module.exports.length);
    this._segments[loadedModule.segment] = loadedModule;

    // Craft code stubs for each function.
    // Win16 functions are far-called from the running program.
    // So our craft code fires an interrupt and the position of the
    // instruction pointer tells us the ordinal.
    //
    // int  0x80        // Interrupt
    // retf 0x12        // Return. We need to know the arguments.

    // We know how big the code section needs to be...
    loadedModule.step = 8;

    const code = new Uint8Array(1000 * loadedModule.step);

    // We start after the callback function
    let position = 8;

    // The callback thunk

    // callf
    code[0] = 0x9a; // callf
    code[1] = 0x00; // ip lo
    code[2] = 0x00; // ip hi
    code[3] = 0xff; // cs lo
    code[4] = 0xff; // cs hi

    // int
    code[5] = 0xcd;
    code[6] = 0x81;
    code[7] = 0x00;

    for (let ordinal = 0; ordinal < 1000; ordinal++) {
      let tuple = module.exports[ordinal];
      if (!tuple) {
        tuple = [module.stub, 'Unknown', 0];
      }

      const pop = tuple[2] || 0;
      const popl = pop & 0xff;
      /* The count is a 16-bit immediate, so its high byte is a shift of eight
       * rather than of `0xff`. JavaScript takes a shift count modulo 32, so
       * the mistake read as `pop >> 31` -- zero for every count that fits in a
       * word, which is every count under 256 and so nearly all of them.
       */
      const poph = (pop >> 8) & 0xff;

      // INT 0x80
      code[position + 0] = 0xcd;
      code[position + 1] = 0x80;

      // RETF bytes
      code[position + 2] = 0xca;
      code[position + 3] = popl;
      code[position + 4] = poph;

      // We still skip when there is no implementation.
      position += loadedModule.step;
    }

    // Load the module's code segment
    this._globalAllocator.map(loadedModule.segment, new DataView(code.buffer), { code: true });

    return loadedModule;
  }

  /**
   * Register a module as a library.
   */
  register(module, handle, instance?: number) {
    this._modules[key(module.name)] = module;
    this._handles[module.path] = handle;

    if (instance !== undefined) {
      (this._instances ??= {})[module.path] = instance;
    }
  }

  /** The instance of a module winbox.js keeps, from its file, as `LoadLibrary` answers it; else its handle. */
  instanceFromPath(path) {
    return this._instances?.[path] ?? this._handles[path];
  }

  /** A module let go: its name and its file are found no more. */
  unregister(module) {
    if (this._modules[key(module.name)] === module) {
      delete this._modules[key(module.name)];
    }

    delete this._handles[module.path];
  }

  /** The module loaded from a file of this name, in any directory, if there is one. */
  fromFileName(file) {
    const wanted = String(file).toUpperCase();

    return (
      Object.values(this._modules).find(
        (module: any) =>
          String(module.path ?? '')
            .split('\\')
            .pop()!
            .toUpperCase() === wanted
      ) ?? null
    );
  }

  /**
   * Returns the module information for the given name, if known.
   */
  fromName(name) {
    return this._modules[key(name)];
  }

  handleFromPath(path) {
    return this._handles[path];
  }

  /**
   * Returns the instance information for the given module name, if loaded.
   */
  instanceFor(name) {
    return this._loaded[name];
  }

  /**
   * Returns the module information that is loaded into the given segment.
   */
  fromSegment(segment) {
    return this._segments[segment];
  }
}

/**
 * A module's name as modules are found by it: without regard to case, as
 * KERNEL compares them. BG of the corpus imports `CTL3D`, whose
 * library calls itself `Ctl3d`; its calls into it went unlinked.
 */
function key(name: any) {
  return String(name).toUpperCase();
}
