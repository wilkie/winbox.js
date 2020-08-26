export function wsprintf(lpszOutput, lpszFormat, lpvArgList) {
    let memory = this.machine.memory;

    let argvSegment = ((lpvArgList >> 16) & 0xffff) >> 3;
    let argvOffset = lpvArgList & 0xffff;

    let destSegment = ((lpszOutput >> 16) & 0xffff) >> 3;
    let destOffset = lpszOutput & 0xffff;

    // Parse the format string for %s, etc, and write to the output string
    for (let i = 0; i < lpszFormat.length; i++) {
        let code = lpszFormat.charCodeAt(i);
        let chr = lpszFormat.charAt(i);

        if (code == 0) {
            break;
        }
        else if (chr == '%') {
            // Format token
            i++;
            chr = lpszFormat.charAt(i);

            switch (chr) {
                // TODO: prefixes, width/precision, other types
                case 's':
                    {
                        // Output string
                        // Retrieve string
                        let offset = memory.read16(argvSegment, argvOffset);
                        argvOffset += 2;
                        let segment = memory.read16(argvSegment, argvOffset);
                        segment = segment >> 3;
                        argvOffset += 2;

                        let data = 0;
                        do {
                            data = memory.read8(segment, offset);

                            if (data != 0) {
                                memory.write8(destSegment, destOffset, data);
                                destOffset++;
                            }

                            offset++;
                        } while (data != 0);
                    }
                    break;
                case 'u':
                    {
                        // Unsigned integer
                        let value = memory.read16(argvSegment, argvOffset);
                        argvOffset += 2;

                        let string = value.toString(10);
                        for (let j = 0; j < string.length; j++) {
                            let subCode = string.charCodeAt(j);
                            memory.write8(destSegment, destOffset, subCode);
                            destOffset++;
                        }
                    }
                    break;
            }
        }
        else {
            memory.write8(destSegment, destOffset, code);
            destOffset++;
        }
    }

    memory.write8(destSegment, destOffset, 0);
}
