"use strict";

/**
 * This manages all loaded modules known to the system.
 */
export class ModuleManager {
    constructor(memory) {
        // Keep track of the modules we know of
        this._modules = {};

        // Keep track of the modules in memory
        this._loaded = {};

        // And the special system segments
        this._segments = {};

        // Retain memory
        this._memory = memory;
    }

    load(module) {
        if (this._loaded[module.name]) {
            return this._loaded[module.name];
        }

        let loadedModule = {
            instance: module,
        };

        // Keep track of it
        this._loaded[module.name] = loadedModule;

        // Assign it a segment
        loadedModule.segment = 4096 + Object.keys(this._loaded).length;

        console.log("loading", module.name, "@", loadedModule.segment, "with", module.exports.length);
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

        let code = new Uint8Array(1000 * loadedModule.step);

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
                tuple = [module.stub, "Unknown", 0];
            }

            let pop = tuple[2] || 0;
            let popl = (pop & 0xff);
            let poph = (pop >> 0xff) & 0xff;

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
        this._memory.map(loadedModule.segment, new DataView(code.buffer));

        return loadedModule;
    }

    /**
     * Register a module as a library.
     */
    register(module) {
        this._modules[module.name] = module;
    }

    /**
     * Returns the module information for the given name, if known.
     */
    fromName(name) {
        return this._modules[name];
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
