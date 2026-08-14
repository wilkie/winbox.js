export function wsprintf(lpszOutput, lpszFormat, lpvArgList) {
  const cpu = this.machine.cpu.core;

  const argvSegment = (lpvArgList >> 16) & 0xffff;
  let argvOffset = lpvArgList & 0xffff;

  const destSegment = (lpszOutput >> 16) & 0xffff;
  let destOffset = lpszOutput & 0xffff;

  const origOffset = destOffset;

  // Parse the format string for %s, etc, and write to the output string
  for (let i = 0; i < lpszFormat.length; i++) {
    const code = lpszFormat.charCodeAt(i);
    let chr = lpszFormat.charAt(i);

    if (code == 0) {
      break;
    } else if (chr == '%') {
      // Format token
      i++;

      let width = 0;
      let precision = 0;
      let parsingPrecision = false;

      /* Whether the conversion has been dealt with and the scan should stop.
       *
       * This used to be signalled by assigning 0 to `chr` and testing `chr ==
       * 0`, which is true for the string '0' as well -- so `%04X` ended at its
       * zero-padding flag, printed "4X" as literal text, and never consumed
       * its argument. Everything after it in the list then read from the wrong
       * place.
       */
      let done = false;
      let padRight = false;
      let padZeros = false;
      let hexPrefix = false;
      let longValue = false;

      for (; i < lpszFormat.length; i++) {
        chr = lpszFormat.charAt(i);

        switch (chr) {
          // TODO: prefixes, width/precision, other types
          case '%':
            // Output a percent
            cpu.write8(destSegment, destOffset, '%'.charCodeAt(0));
            destOffset++;
            done = true;
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
              let offset = cpu.read16(argvSegment, argvOffset);
              argvOffset += 2;
              const segment = cpu.read16(argvSegment, argvOffset);
              argvOffset += 2;

              let data = 0;
              let count = 0;
              do {
                if (precision && count >= precision) {
                  break;
                }

                data = cpu.read8(segment, offset);

                if (data != 0) {
                  cpu.write8(destSegment, destOffset, data);
                  destOffset++;
                }

                offset++;
                count++;
              } while (data != 0);
            }
            done = true;
            break;

          case 'l':
            longValue = true;
            break;

          case 'X':
          case 'x':
          case 'u':
          case 'd':
            {
              let value = cpu.read16(argvSegment, argvOffset);
              argvOffset += 2;
              if (longValue) {
                value = value | (cpu.read16(argvSegment, argvOffset) << 16);
                argvOffset += 2;
              } else {
                // Ensure it is signed 32-bit
                value = value >= 0x8000 ? value | ~0xffff : value;
              }

              // Unsigned integer
              if (chr == 'u') {
                value = value >>> 0;
                chr = 'd';
              }

              let string = '';

              if (chr == 'd') {
                string = value.toString(10);
              } else if (chr == 'x' || chr == 'X') {
                string = value.toString(16);
                if (hexPrefix) {
                  string = '0x' + string;
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
                  } else {
                    string = string.padEnd(width, ' ');
                  }
                } else {
                  if (padZeros) {
                    string = string.padStart(width, '0');
                  } else {
                    string = string.padStart(width, ' ');
                  }
                }
              }

              for (let j = 0; j < string.length; j++) {
                const subCode = string.charCodeAt(j);
                cpu.write8(destSegment, destOffset, subCode);
                destOffset++;
              }
            }
            done = true;
            break;

          case '.':
            // Switch to precision
            parsingPrecision = true;
            break;

          default:
            // Parse numeric widths, etc
            if (chr >= '0' && chr <= '9') {
              const digit = Number(chr);

              if (parsingPrecision) {
                precision *= 10;
                precision += digit;
              } else {
                width *= 10;
                width += digit;
              }
            }
            break;
        }

        if (done) {
          break;
        }
      }
    } else {
      cpu.write8(destSegment, destOffset, code);
      destOffset++;
    }
  }

  cpu.write8(destSegment, destOffset, 0);
  return destOffset - origOffset;
}
