export function GetProcAddress(hinst, lpszProcName) {
    // Get a reference to the module in question
    let module = this.handles.resolve(hinst);

    // We can ask for a proc by name or by ordinal number
    if (lpszProcName instanceof String || (typeof lpszProcName) == 'string') {
        // TODO: lookup by name
    }
    else {
        // lpszProcName is an ordinal number
        module = this.modules.load(module);
        let ordinal = lpszProcName;

        // Look up the ordinal
        let info = module.lookup(ordinal);

        let segment = info.segment;
        let offset = info.offset;

        return (((segment << 3) | 0x3) << 16) | offset;
    }
}
