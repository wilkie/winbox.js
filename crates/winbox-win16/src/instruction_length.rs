//! How long an instruction is, as KERNEL works it out to step over the one
//! a program faulted on when Ignore is chosen (`KRNL386.EXE` seg1 `a2f4`),
//! as winbox.js's `instruction-length.ts` follows it: its prefixes, its
//! opcode, and the operands its encoding says follow -- a ModR/M byte and
//! its displacement, a SIB byte with 32-bit addressing, an immediate or an
//! address. 16-bit operands and addresses unless a prefix says 32. `None`
//! for what it does not know, which cannot be stepped over: among them
//! `mov` into CS or SS.

/// The prefixes KERNEL steps over besides the two sizes: the segments,
/// `LOCK`, `REPNE` and `REP`.
const PREFIXES: [u8; 9] = [0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0xf0, 0xf2, 0xf3];

/// The length of the instruction whose bytes `read` gives, by their offset
/// from its first; `None` where KERNEL does not know it, or where a byte
/// cannot be read, which stops KERNEL's reading as a fault would.
#[allow(clippy::too_many_lines)]
pub fn instruction_length(read: impl Fn(u16) -> Option<u8>) -> Option<u16> {
    let mut at: u16 = 0;
    let mut operand32 = false;
    let mut address32 = false;

    loop {
        let byte = read(at)?;

        if byte == 0x66 {
            operand32 = !operand32;
        } else if byte == 0x67 {
            address32 = !address32;
        } else if !PREFIXES.contains(&byte) {
            break;
        }

        at += 1;

        if at > 14 {
            return None;
        }
    }

    let word: u16 = if operand32 { 4 } else { 2 };
    let address: u16 = if address32 { 4 } else { 2 };
    let opcode = read(at)?;

    at += 1;

    // The bytes a ModR/M byte brings: itself, a SIB byte, a displacement.
    let modrm = |at: &mut u16| -> Option<()> {
        let byte = read(*at)?;
        let mode = byte >> 6;
        let rm = byte & 7;

        *at += 1;

        if mode == 3 {
            return Some(());
        }

        if address32 {
            let mut base = rm;

            if rm == 4 {
                base = read(*at)? & 7;
                *at += 1;
            }

            *at += match (mode, base) {
                (1, _) => 1,
                (2, _) | (0, 5) => 4,
                _ => 0,
            };
        } else {
            *at += match (mode, rm) {
                (1, _) => 1,
                (2, _) | (0, 6) => 2,
                _ => 0,
            };
        }

        Some(())
    };

    if opcode == 0x0f {
        let second = read(at)?;

        at += 1;

        if (0x80..=0x8f).contains(&second) {
            return Some(at + word);
        }

        if second <= 0x03
            || (0x90..=0x9f).contains(&second)
            || (0x20..=0x23).contains(&second)
            || [
                0xa3, 0xa5, 0xab, 0xad, 0xaf, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xbb, 0xbc, 0xbd,
                0xbe, 0xbf,
            ]
            .contains(&second)
        {
            modrm(&mut at)?;
            return Some(at);
        }

        if matches!(second, 0xa4 | 0xac | 0xba) {
            modrm(&mut at)?;
            return Some(at + 1);
        }

        if [0x06, 0x08, 0x09, 0xa0, 0xa1, 0xa2, 0xa8, 0xa9].contains(&second) {
            return Some(at);
        }

        return None;
    }

    // The arithmetic rows: ModR/M forms, then AL and AX with an immediate.
    if opcode < 0x40 && opcode & 7 < 6 {
        let form = opcode & 7;

        if form < 4 {
            modrm(&mut at)?;
            return Some(at);
        }

        return Some(at + if form == 4 { 1 } else { word });
    }

    if opcode == 0x8e {
        let reg = (read(at)? >> 3) & 7;

        if reg == 1 || reg == 2 || reg > 5 {
            return None;
        }

        modrm(&mut at)?;
        return Some(at);
    }

    if (0x84..=0x8f).contains(&opcode)
        || [0x62, 0x63, 0xc4, 0xc5, 0xfe, 0xff].contains(&opcode)
        || (0xd0..=0xd3).contains(&opcode)
        || (0xd8..=0xdf).contains(&opcode)
    {
        modrm(&mut at)?;
        return Some(at);
    }

    if matches!(opcode, 0x69 | 0x81 | 0xc7) {
        modrm(&mut at)?;
        return Some(at + word);
    }

    if [0x6b, 0x80, 0x82, 0x83, 0xc0, 0xc1, 0xc6].contains(&opcode) {
        modrm(&mut at)?;
        return Some(at + 1);
    }

    if opcode == 0xf6 || opcode == 0xf7 {
        let reg = (read(at)? >> 3) & 7;

        modrm(&mut at)?;

        return Some(
            at + match (reg < 2, opcode) {
                (true, 0xf6) => 1,
                (true, _) => word,
                _ => 0,
            },
        );
    }

    if (0x70..=0x7f).contains(&opcode)
        || (0xb0..=0xb7).contains(&opcode)
        || (0xe0..=0xe7).contains(&opcode)
        || [0x6a, 0xa8, 0xcd, 0xd4, 0xd5, 0xeb].contains(&opcode)
    {
        return Some(at + 1);
    }

    if (0xb8..=0xbf).contains(&opcode) || [0x68, 0xa9, 0xe8, 0xe9].contains(&opcode) {
        return Some(at + word);
    }

    if (0xa0..=0xa3).contains(&opcode) {
        return Some(at + address);
    }

    if opcode == 0x9a || opcode == 0xea {
        return Some(at + word + 2);
    }

    if opcode == 0xc2 || opcode == 0xca {
        return Some(at + 2);
    }

    if opcode == 0xc8 {
        return Some(at + 3);
    }

    // The rest take nothing after them.
    Some(at)
}

#[cfg(test)]
mod tests {
    use super::instruction_length;

    fn length(bytes: &[u8]) -> Option<u16> {
        instruction_length(|at| bytes.get(usize::from(at)).copied())
    }

    #[test]
    fn a_segment_load_from_a_register_is_two_bytes() {
        assert_eq!(length(&[0x8e, 0xc0]), Some(2));
    }

    #[test]
    fn a_move_into_cs_or_ss_cannot_be_stepped_over() {
        assert_eq!(length(&[0x8e, 0xc8]), None);
        assert_eq!(length(&[0x8e, 0xd0]), None);
    }

    #[test]
    fn displacements_and_immediates_are_counted() {
        // cmp ax, [000a]
        assert_eq!(length(&[0x3b, 0x06, 0x0a, 0x00]), Some(4));
        // push word es:[bx+2c]
        assert_eq!(length(&[0x26, 0xff, 0x77, 0x2c]), Some(4));
        // mov word [bp-2], 1234h
        assert_eq!(length(&[0xc7, 0x46, 0xfe, 0x34, 0x12]), Some(5));
        // mov eax, [ebx+ecx*4+12345678h]
        assert_eq!(
            length(&[0x66, 0x67, 0x8b, 0x84, 0x8b, 0x78, 0x56, 0x34, 0x12]),
            Some(9)
        );
        // test byte [si], 1, and not word [si]
        assert_eq!(length(&[0xf6, 0x04, 0x01]), Some(3));
        assert_eq!(length(&[0xf7, 0x14]), Some(2));
    }

    #[test]
    fn a_two_byte_opcode_it_does_not_know_is_not_stepped_over() {
        assert_eq!(length(&[0x0f, 0x31]), None);
        assert_eq!(length(&[0x0f, 0x84, 0x00, 0x10]), Some(4));
    }

    #[test]
    fn bytes_that_cannot_be_read_end_the_reading() {
        assert_eq!(length(&[0x3b, 0x06, 0x0a]), Some(4));
        assert_eq!(length(&[0x66]), None);
    }
}
