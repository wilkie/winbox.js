export function wsprintf(lpszOutput, lpszFormat, lpvArgList) {
    let memory = this.machine.memory;

    let argvSegment = ((lpvArgList >> 16) & 0xffff) >> 3;
    let argvOffset = lpvArgList & 0xffff;

    let destSegment = ((lpszOutput >> 16) & 0xffff) >> 3;
    let destOffset = lpszOutput & 0xffff;

    let origOffset = destOffset;

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

            let width = 0;
            let precision = 0;
            let parsingPrecision = false;
            let padRight = false;
            let padZeros = false;
            let hexPrefix = false;
            let longValue = false;

            for ( ; i < lpszFormat.length; i++) {
                chr = lpszFormat.charAt(i);

                switch (chr) {
                    // TODO: prefixes, width/precision, other types
                    case '%':
                        // Output a percent
                        memory.write8(destSegment, destOffset, "%".charCodeAt(0));
                        destOffset++;
                        chr = 0;
                        break;

                    case '-':
                        padRight = true;
                        break;

                    case '#':
                        hexPrefix = true;
                        break;

                    case '0':
                        padZeros = true;
                        break;

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
                            let count = 0;
                            do {
                                if (precision && count >= precision) {
                                    break;
                                }

                                data = memory.read8(segment, offset);

                                if (data != 0) {
                                    memory.write8(destSegment, destOffset, data);
                                    destOffset++;
                                }

                                offset++;
                                count++;
                            } while (data != 0);
                        }
                        chr = 0;
                        break;

                    case 'l':
                        longValue = true;
                        break;

                    case 'X':
                    case 'x':
                    case 'u':
                    case 'd':
                        {
                            let value = memory.read16(argvSegment, argvOffset);
                            argvOffset += 2;
                            if (longValue) {
                                value <<= 16;
                                value = value | memory.read16(argvSegment, argvOffset);
                                argvOffset += 2;
                            }
                            else {
                                // Ensure it is signed 32-bit
                                value = value >= 0x8000 ? value | ~0xffff : value;
                            }

                            // Unsigned integer
                            if (chr == 'u') {
                                value = value >>> 0;
                                chr = 'd';
                            }

                            let string = "";

                            if (chr == 'd') {
                                string = value.toString(10);
                            }
                            else if (chr == 'x' || chr == 'X') {
                                string = value.toString(16);
                                if (hexPrefix) {
                                    string = "0x" + string;
                                }
                                if (chr == 'X') {
                                    string = string.toUpperCase();
                                }
                            }

                            if (precision && string.length < precision) {
                                string = string.padStart(precision, '0');
                            }

                            // Pad string
                            if (width && string.length < width) {
                                if (padRight) {
                                    if (padZeros) {
                                        string = string.padEnd(width, '0');
                                    }
                                    else {
                                        string = string.padEnd(width, ' ');
                                    }
                                }
                                else {
                                    if (padZeros) {
                                        string = string.padStart(width, '0');
                                    }
                                    else {
                                        string = string.padStart(width, ' ');
                                    }
                                }
                            }

                            for (let j = 0; j < string.length; j++) {
                                let subCode = string.charCodeAt(j);
                                memory.write8(destSegment, destOffset, subCode);
                                destOffset++;
                            }
                        }
                        chr = 0;
                        break;

                    case '.':
                        // Switch to precision
                        parsingPrecision = true;
                        break;

                    default:
                        // Parse numeric widths, etc
                        if (chr >= '0' && chr <= '9') {
                            chr = chr - '0';

                            if (parsingPrecision) {
                                precision *= 10;
                                precision += chr;
                            }
                            else {
                                width *= 10;
                                width += chr;
                            }
                        }
                        break;
                }

                if (chr == 0) {
                    break;
                }
            }
        }
        else {
            memory.write8(destSegment, destOffset, code);
            destOffset++;
        }
    }

    memory.write8(destSegment, destOffset, 0);
    return destOffset - origOffset;
}
