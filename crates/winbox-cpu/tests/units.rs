//! The processor's cases that the hardware vectors do not reach
//! (`tests/conformance.rs`): divide errors,
//! which the vectors skip wherever the part faults; the 80386's extensions
//! and immediates under the size prefixes, pinned where a program of the
//! corpus found them wrong; and protected-mode segmentation, where the
//! vectors are all real mode. Each case keeps its source with it. What the core leaves to its host -- which fault a
//! protected-mode access raises -- is held in `winbox-win16`'s
//! `fault_vector.rs`.

use winbox_cpu::{AX, BP, BX, CS, CX, Cpu, DI, DS, ES, Exit, SP, SS, VecBus};

const CF: u16 = 0x0001;
const ZF: u16 = 0x0040;

fn reg32(cpu: &Cpu<VecBus>, index: usize) -> u32 {
    u32::from(cpu.regs[index]) | (u32::from(cpu.high[index]) << 16)
}

fn set_reg32(cpu: &mut Cpu<VecBus>, index: usize, value: u32) {
    cpu.regs[index] = value as u16;
    cpu.high[index] = (value >> 16) as u16;
}

/// A real-mode machine: CS and DS 1000h,
/// SS 2000h, SP 1000h, `code` at 1000h:0000.
fn real(code: &[u8]) -> Cpu<VecBus> {
    let mut cpu = Cpu::new(VecBus(vec![0; 0x80000]));

    for (segment, selector) in [(CS, 0x1000), (DS, 0x1000), (ES, 0x1000), (SS, 0x2000)] {
        cpu.load_segment(segment, selector).unwrap();
    }

    cpu.regs[SP] = 0x1000;
    cpu.ip = 0;
    cpu.bus.0[0x10000..0x10000 + code.len()].copy_from_slice(code);
    cpu
}

/// Runs one instruction; it must not stop.
fn step(cpu: &mut Cpu<VecBus>) {
    assert_eq!(cpu.run(1), (1, Exit::Budget));
}

mod divide_errors {
    //! A divide error is interrupt 0,
    //! raised when the quotient will not fit the destination -- which
    //! includes every divide by zero. The one exception is a signed byte
    //! divide whose quotient works out to exactly -128, which the part
    //! allows through rather than faulting. Being a fault rather than a
    //! trap, the pushed address is that of the offending instruction. The
    //! vectors cannot cover this: they skip every vector whose instruction
    //! faults on hardware.

    use super::*;

    const HANDLER_SEGMENT: u16 = 0x4000;
    const HANDLER_OFFSET: u16 = 0x0100;
    // F6 /6 and F6 /7 with mod=11, rm=011: the byte divides by BL.
    const DIV_BL: [u8; 2] = [0xf6, 0xf3];
    const IDIV_BL: [u8; 2] = [0xf6, 0xfb];

    fn machine(code: &[u8], ax: u16, bx: u16) -> Cpu<VecBus> {
        let mut cpu = real(code);

        // Vector 0 at the handler, through the real-mode table at nought.
        cpu.interrupt_table = Some(0);
        cpu.bus.0[0..2].copy_from_slice(&HANDLER_OFFSET.to_le_bytes());
        cpu.bus.0[2..4].copy_from_slice(&HANDLER_SEGMENT.to_le_bytes());
        cpu.regs[AX] = ax;
        cpu.regs[BX] = bx;
        cpu
    }

    /// The divide error taken: the frame pushed, IP and CS.
    fn divide_error(cpu: &mut Cpu<VecBus>) -> (u16, u16) {
        step(cpu);
        assert_eq!(
            (cpu.segments[CS].selector, cpu.ip),
            (HANDLER_SEGMENT, HANDLER_OFFSET)
        );

        let at = 0x20000 + usize::from(cpu.regs[SP]);
        let word = |offset: usize| {
            u16::from_le_bytes([cpu.bus.0[at + offset], cpu.bus.0[at + offset + 1]])
        };

        (word(0), word(2))
    }

    #[test]
    fn div_raises_interrupt_0_when_dividing_by_zero() {
        divide_error(&mut machine(&DIV_BL, 0x1234, 0));
    }

    #[test]
    fn div_raises_interrupt_0_when_the_quotient_will_not_fit() {
        // 0xff00 / 2 is 0x7f80, far wider than the byte destination. A
        // fault pushes the address of the instruction that faulted.
        assert_eq!(divide_error(&mut machine(&DIV_BL, 0xff00, 2)), (0, 0x1000));
    }

    #[test]
    fn div_does_not_fault_when_the_quotient_fits() {
        let mut cpu = machine(&DIV_BL, 100, 7);

        step(&mut cpu);
        assert_ne!(cpu.segments[CS].selector, HANDLER_SEGMENT);
        // 100 / 7: AL 14, AH 2.
        assert_eq!(cpu.regs[AX], 0x020e);
    }

    #[test]
    fn idiv_raises_interrupt_0_when_dividing_by_zero() {
        divide_error(&mut machine(&IDIV_BL, 0x1234, 0));
    }

    #[test]
    fn idiv_does_not_fault_when_the_quotient_fits() {
        // -20 / 3: -6, truncated toward zero, remainder -2.
        let mut cpu = machine(&IDIV_BL, 0xffec, 3);

        step(&mut cpu);
        assert_ne!(cpu.segments[CS].selector, HANDLER_SEGMENT);
        assert_eq!(cpu.regs[AX], 0xfefa);
    }

    #[test]
    fn idiv_lets_a_quotient_of_exactly_minus_128_through_instead_of_faulting() {
        // Taken from the hardware vectors: this overflows a signed byte,
        // so it ought to fault, and the part returns a result anyway.
        let mut cpu = machine(&IDIV_BL, 0x81c1, 0x007c);

        step(&mut cpu);
        assert_ne!(cpu.segments[CS].selector, HANDLER_SEGMENT);
        assert_eq!(cpu.regs[AX], 0xc180);
    }
}

mod operand_size {
    //! Immediates and the 80386's
    //! extensions under the size prefixes. Found by Slam! of the corpus,
    //! whose 32-bit arithmetic looped for ever: a byte immediate is
    //! sign-extended to the whole 32 bits, and TEST's immediate is 32 bits
    //! wide rather than 16. EDI is the register each case reads.

    use super::*;

    /// Runs one instruction with EDI `edi`, after `before`.
    fn run(code: &[u8], edi: u32, before: impl FnOnce(&mut Cpu<VecBus>)) -> Cpu<VecBus> {
        let mut cpu = real(code);

        set_reg32(&mut cpu, DI, edi);
        before(&mut cpu);
        step(&mut cpu);
        cpu
    }

    fn write16(cpu: &mut Cpu<VecBus>, linear: usize, value: u16) {
        cpu.bus.0[linear..linear + 2].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn zero_extends_a_byte_into_a_word_register() {
        // movzx di, byte [0x100], the byte F0h
        let cpu = run(&[0x0f, 0xb6, 0x3e, 0x00, 0x01], 0x1234_5678, |cpu| {
            cpu.bus.0[0x10100] = 0xf0;
        });

        assert_eq!(reg32(&cpu, DI), 0x1234_00f0);
        assert_eq!(cpu.ip, 5);
    }

    #[test]
    fn exchanges_eax_with_a_double_word_register_and_does_nothing_with_itself() {
        // xchg eax, edi
        let cpu = run(&[0x66, 0x97], 0x1234_5678, |cpu| {
            set_reg32(cpu, AX, 0xcafe_f00d);
        });

        assert_eq!(reg32(&cpu, DI), 0xcafe_f00d);
        assert_eq!(reg32(&cpu, AX), 0x1234_5678);
        assert_eq!(run(&[0x66, 0x90], 0, |_| {}).ip, 2);
    }

    #[test]
    fn moves_a_word_into_a_word_register_leaving_the_high_word() {
        // movsx di, word [0x100], the word 8001h
        let cpu = run(&[0x0f, 0xbf, 0x3e, 0x00, 0x01], 0x1234_5678, |cpu| {
            write16(cpu, 0x10100, 0x8001);
        });

        assert_eq!(reg32(&cpu, DI), 0x1234_8001);
    }

    #[test]
    fn tests_a_bit_given_in_the_instruction() {
        // bt word [0x100], 4
        let cpu = run(&[0x0f, 0xba, 0x26, 0x00, 0x01, 0x04], 0, |cpu| {
            write16(cpu, 0x10100, 0x0010);
        });

        assert_eq!(cpu.flags & CF, CF);
        assert_eq!(cpu.ip, 6);
    }

    #[test]
    fn sets_clears_and_turns_over_a_bit() {
        // bts di, 3 ; the bit number modulo sixteen
        assert_eq!(
            run(&[0x0f, 0xba, 0xef, 0x13], 0x0000, |_| {}).regs[DI],
            0x0008
        );
        // btr di, 0
        assert_eq!(
            run(&[0x0f, 0xba, 0xf7, 0x00], 0x00ff, |_| {}).regs[DI],
            0x00fe
        );
        // btc di, 15
        assert_eq!(
            run(&[0x0f, 0xba, 0xff, 0x0f], 0x0000, |_| {}).regs[DI],
            0x8000
        );
    }

    #[test]
    fn reaches_past_a_memory_operand_with_a_bit_number_in_a_register() {
        // bts word [0x100], di with di = 17: the word after, its bit 1
        let cpu = run(&[0x0f, 0xab, 0x3e, 0x00, 0x01], 17, |_| {});

        assert_eq!(cpu.bus.0[0x10102..0x10104], [0x02, 0x00]);
        assert_eq!(cpu.bus.0[0x10100..0x10102], [0, 0]);
    }

    #[test]
    fn finds_the_lowest_and_the_highest_bit_set() {
        // bsf di, word [0x100] ; bsr
        let low = run(&[0x0f, 0xbc, 0x3e, 0x00, 0x01], 0, |cpu| {
            write16(cpu, 0x10100, 0x0a0);
        });
        let high = run(&[0x0f, 0xbd, 0x3e, 0x00, 0x01], 0, |cpu| {
            write16(cpu, 0x10100, 0x0a0);
        });
        let none = run(&[0x0f, 0xbc, 0x3e, 0x00, 0x01], 0x1234, |cpu| {
            write16(cpu, 0x10100, 0);
        });

        assert_eq!(low.regs[DI], 5);
        assert_eq!(high.regs[DI], 7);
        assert_eq!(none.flags & ZF, ZF);
        assert_eq!(none.regs[DI], 0x1234);
    }

    #[test]
    fn reads_a_scaled_index_with_no_base_and_a_32_bit_displacement() {
        // jmp [cs:ecx*2 + 0x10], ecx = 1: the word at 0x12
        let cpu = run(
            &[0x67, 0x2e, 0xff, 0x24, 0x4d, 0x10, 0x00, 0x00, 0x00],
            0,
            |cpu| {
                write16(cpu, 0x10012, 0x4321);
                set_reg32(cpu, CX, 1);
            },
        );

        assert_eq!(cpu.ip, 0x4321);
    }

    #[test]
    fn addresses_the_stack_segment_by_default_through_ebp() {
        // mov ax, [ebp+4]
        let cpu = run(&[0x67, 0x8b, 0x45, 0x04], 0, |cpu| {
            write16(cpu, 0x20014, 0xbeef);
            write16(cpu, 0x10014, 0x1111);
            set_reg32(cpu, BP, 0x10);
        });

        assert_eq!(cpu.regs[AX], 0xbeef);
    }

    #[test]
    fn sign_extends_the_byte_of_83h_to_32_bits() {
        // cmp edi, -1
        let cpu = run(&[0x66, 0x83, 0xff, 0xff], 0xffff_ffff, |_| {});

        assert_eq!(cpu.flags & ZF, ZF);
        assert_eq!(cpu.ip, 4);
    }

    #[test]
    fn reads_a_32_bit_immediate_for_test() {
        // test edi, 0x80000000
        let cpu = run(
            &[0x66, 0xf7, 0xc7, 0x00, 0x00, 0x00, 0x80],
            0x8000_0000,
            |_| {},
        );

        assert_eq!(cpu.flags & ZF, 0);
        assert_eq!(cpu.ip, 7);
    }

    #[test]
    fn leaves_the_rest_of_f7h_to_the_16_bit_decode() {
        // not edi
        assert_eq!(run(&[0x66, 0xf7, 0xd7], 0x0000_ffff, |_| {}).ip, 3);
    }

    #[test]
    fn tests_a_byte_with_f6hs_byte_immediate_the_prefix_changing_nothing() {
        // test byte [di], 80h under 66h, as the Win386 supervisor's 32-bit
        // code has it (`kb/topics/win386.md`): a byte, whatever the
        // operand size.
        let cpu = run(&[0x66, 0xf6, 0x05, 0x80], 0x100, |cpu| {
            cpu.bus.0[0x10100] = 0x80;
        });

        assert_eq!(cpu.flags & ZF, 0);
        assert_eq!(cpu.ip, 4);
    }

    #[test]
    fn reads_a_32_bit_address_under_67h_twice() {
        // mov di, [edi+100h] with 67h twice
        let cpu = run(
            &[0x67, 0x67, 0x8b, 0xbf, 0x00, 0x01, 0x00, 0x00],
            0,
            |cpu| write16(cpu, 0x10100, 0xbeef),
        );

        assert_eq!(cpu.regs[DI], 0xbeef);
        assert_eq!(cpu.ip, 8);
    }

    #[test]
    fn xlat_under_the_address_size_prefix_adds_al_to_the_whole_of_ebx() {
        // xlat with 67h, EBX 10h
        let cpu = run(&[0x67, 0xd7], 0, |cpu| {
            set_reg32(cpu, BX, 0x10);
            cpu.regs[AX] = 2;
            cpu.bus.0[0x10012] = 0x5a;
        });

        assert_eq!(cpu.regs[AX] & 0xff, 0x5a);
    }
}

mod protected_mode {
    //! Hand-built scenarios
    //! asserting what a 386 is specified to do, as no published
    //! protected-mode corpus exists. A GDT descriptor is eight bytes: limit
    //! 15:0, base 15:0, base 23:16, P | DPL | S | type, G | D/B | limit
    //! 19:16, base 31:24. The table is at 10000h, 100h bytes; 08h is
    //! based at 20000h and 10h at 30000h, each a limit of `FFFFh`.

    use super::*;

    const GDT_BASE: usize = 0x10000;
    const CODE_SELECTOR: u16 = 0x08;
    const DATA_SELECTOR: u16 = 0x10;

    #[derive(Clone, Copy)]
    struct Descriptor {
        base: u32,
        limit: u32,
        present: bool,
        dpl: u8,
        granular: bool,
        big: bool,
        /// The access byte whole, in place of present, DPL and a
        /// read/write data segment.
        access: Option<u8>,
    }

    const fn plain(base: u32, limit: u32) -> Descriptor {
        Descriptor {
            base,
            limit,
            present: true,
            dpl: 0,
            granular: false,
            big: false,
            access: None,
        }
    }

    fn write_descriptor(cpu: &mut Cpu<VecBus>, index: usize, d: Descriptor) {
        let at = GDT_BASE + index * 8;
        let access = d
            .access
            .unwrap_or((if d.present { 0x80 } else { 0 }) | (d.dpl << 5) | 0x12);

        cpu.bus.0[at..at + 8].copy_from_slice(&[
            d.limit as u8,
            (d.limit >> 8) as u8,
            d.base as u8,
            (d.base >> 8) as u8,
            (d.base >> 16) as u8,
            access,
            (if d.granular { 0x80 } else { 0 })
                | (if d.big { 0x40 } else { 0 })
                | ((d.limit >> 16) & 0x0f) as u8,
            (d.base >> 24) as u8,
        ]);
    }

    /// A machine in protected mode with the table in place, and these
    /// descriptors besides.
    fn protected(descriptors: &[(usize, Descriptor)]) -> Cpu<VecBus> {
        let mut cpu = Cpu::new(VecBus(vec![0; 0x80000]));

        cpu.gdt_base = GDT_BASE as u32;
        cpu.gdt_limit = 0xff;
        write_descriptor(&mut cpu, 1, plain(0x20000, 0xffff));
        write_descriptor(&mut cpu, 2, plain(0x30000, 0xffff));

        for &(index, descriptor) in descriptors {
            write_descriptor(&mut cpu, index, descriptor);
        }

        cpu.protected = true;
        cpu
    }

    mod descriptor_decoding {
        use super::*;

        fn loaded(descriptor: Descriptor) -> Cpu<VecBus> {
            let mut cpu = protected(&[(3, descriptor)]);

            cpu.load_segment(DS, 0x18).unwrap();
            cpu
        }

        #[test]
        fn decodes_a_base_spread_across_three_fields() {
            assert_eq!(
                loaded(plain(0x1234_5678, 0xffff)).segments[DS].base,
                0x1234_5678
            );
        }

        #[test]
        fn decodes_a_twenty_bit_limit() {
            assert_eq!(
                loaded(plain(0, 0xfabcd)).segments[DS].past_limit,
                0xfabcd + 1
            );
        }

        #[test]
        fn reports_the_descriptor_privilege_level() {
            let cpu = protected(&[(
                3,
                Descriptor {
                    dpl: 2,
                    ..plain(0, 0xffff)
                },
            )]);

            assert_eq!((cpu.access_rights(0x18).unwrap() >> 13) & 3, 2);
        }

        #[test]
        fn reports_a_segment_that_is_not_present() {
            let cpu = protected(&[(
                3,
                Descriptor {
                    present: false,
                    ..plain(0, 0xffff)
                },
            )]);

            assert_eq!(cpu.access_rights(0x18).unwrap() & 0x8000, 0);
        }

        #[test]
        fn reports_the_default_operand_size() {
            assert!(
                loaded(Descriptor {
                    big: true,
                    ..plain(0, 0xffff)
                })
                .segments[DS]
                    .big
            );
        }

        #[test]
        fn scales_a_granular_limit_to_bytes() {
            // With the granularity bit set the limit counts 4 KiB units,
            // and the last byte of the final unit is addressable, so a
            // limit of 1 covers offsets up to 0x1FFF.
            assert_eq!(
                loaded(Descriptor {
                    granular: true,
                    ..plain(0, 1)
                })
                .segments[DS]
                    .past_limit,
                0x2000
            );
        }
    }

    mod real_mode {
        use super::*;

        #[test]
        fn treats_the_selector_as_a_paragraph_number() {
            let mut cpu = Cpu::new(VecBus(vec![0; 0x100]));

            cpu.load_segment(DS, 0x1234).unwrap();
            assert_eq!(
                (cpu.segments[DS].base, cpu.segments[DS].past_limit),
                (0x12340, 0x10000)
            );
        }

        #[test]
        fn does_not_read_the_descriptor_table() {
            // Nothing in real mode consults the GDT, so a garbage table
            // register is harmless -- the state the machine boots in.
            let mut cpu = Cpu::new(VecBus(vec![0; 0x100]));

            cpu.gdt_base = 0xdead0;
            cpu.gdt_limit = 0;
            cpu.load_segment(DS, 0x8000).unwrap();
            assert_eq!(cpu.segments[DS].base, 0x80000);
        }
    }

    mod translation {
        use super::*;

        #[test]
        fn addresses_memory_through_the_descriptor_base() {
            // mov al, [0x40]
            let mut cpu = protected(&[]);

            cpu.bus.0[0x20000..0x20003].copy_from_slice(&[0xa0, 0x40, 0x00]);
            cpu.load_segment(CS, CODE_SELECTOR).unwrap();
            cpu.load_segment(DS, DATA_SELECTOR).unwrap();
            cpu.bus.0[0x30040] = 0x5a;
            step(&mut cpu);
            assert_eq!(cpu.regs[AX] & 0xff, 0x5a);
        }

        #[test]
        fn keeps_the_loaded_descriptor_when_the_table_entry_changes_underneath() {
            // The part caches a descriptor when the selector is loaded and
            // does not watch the table afterwards.
            let mut cpu = protected(&[]);

            cpu.load_segment(DS, DATA_SELECTOR).unwrap();
            write_descriptor(&mut cpu, 2, plain(0x50000, 0xffff));
            assert_eq!(cpu.segments[DS].base, 0x30000);

            cpu.load_segment(DS, DATA_SELECTOR).unwrap();
            assert_eq!(cpu.segments[DS].base, 0x50000);
        }
    }

    mod faults {
        use super::*;

        #[test]
        fn allows_an_access_that_ends_exactly_on_the_limit() {
            // The limit is the offset of the segment's last addressable
            // byte, so an access that finishes on it is inside.
            let mut cpu = protected(&[(3, plain(0x40000, 0x00ff))]);

            cpu.bus.0[0x20000..0x20002].copy_from_slice(&[0x8a, 0x07]);
            cpu.load_segment(CS, CODE_SELECTOR).unwrap();
            cpu.load_segment(DS, 0x18).unwrap();
            cpu.regs[BX] = 0x00ff;
            step(&mut cpu);
        }

        #[test]
        fn accepts_the_last_descriptor_the_table_has_room_for() {
            let mut cpu = protected(&[(0x1f, plain(0x70000, 0xffff))]);

            cpu.load_segment(DS, 0x1f << 3).unwrap();
            assert_eq!(cpu.segments[DS].base, 0x70000);
        }
    }

    mod expand_down {
        //! A data segment that grows toward zero inverts the check: the
        //! limit is the last offset *outside* the segment, and it runs from
        //! there up to the top of the address space the B bit selects
        //! (Intel 80386 manual, expand-down data segments). Which fault an
        //! access below the limit raises is named in `fault_vector.rs`.
        //! DOSBox 0.74 checks no segment's limit, this one's or any other's
        //! (the `seglim` probe), so these are the manual's.

        use super::*;

        /// Selector 18h: data at 40000h, expanding down past `limit`, the
        /// B bit `big`.
        fn expanding_down(limit: u32, big: bool) -> Cpu<VecBus> {
            let mut cpu = protected(&[(
                3,
                Descriptor {
                    access: Some(0x96),
                    big,
                    ..plain(0x40000, limit)
                },
            )]);

            cpu.load_segment(CS, CODE_SELECTOR).unwrap();
            cpu.load_segment(DS, 0x18).unwrap();
            cpu
        }

        #[test]
        fn allows_an_access_above_the_limit() {
            // mov al, [bx]
            let mut cpu = expanding_down(0x0fff, false);

            cpu.bus.0[0x20000..0x20002].copy_from_slice(&[0x8a, 0x07]);
            cpu.bus.0[0x42000] = 0x5a;
            cpu.regs[BX] = 0x2000;
            step(&mut cpu);
            assert_eq!(cpu.regs[AX] & 0xff, 0x5a);
        }

        #[test]
        fn faults_at_and_below_the_limit() {
            for (bx, size) in [(0x0fff, 1), (0x0000, 1), (0x0fff, 2)] {
                // mov al, [bx] or mov ax, [bx]: the word at 0FFFh has its
                // first byte at the limit.
                let mut cpu = expanding_down(0x0fff, false);

                cpu.bus.0[0x20000..0x20002]
                    .copy_from_slice(&[if size == 1 { 0x8a } else { 0x8b }, 0x07]);
                cpu.regs[BX] = bx;
                assert_eq!(cpu.run(1), (0, Exit::Fault(13)), "{size} at {bx:04x}");
            }
        }

        #[test]
        fn ends_at_ffffh_without_the_b_bit() {
            // mov ax, [bx] at FFFFh: its second byte past the top.
            let mut cpu = expanding_down(0x0fff, false);

            cpu.bus.0[0x20000..0x20002].copy_from_slice(&[0x8b, 0x07]);
            cpu.regs[BX] = 0xffff;
            assert_eq!(cpu.run(1), (0, Exit::Fault(13)));
        }

        #[test]
        fn runs_past_ffffh_with_the_b_bit() {
            // mov ax, [ebx], EBX 0000FFFFh and 00010000h.
            for (high, low, at) in [(0, 0xffff, 0x4ffff), (1, 0, 0x50000)] {
                let mut cpu = expanding_down(0x0fff, true);

                cpu.bus.0[0x20000..0x20003].copy_from_slice(&[0x67, 0x8b, 0x03]);
                cpu.bus.0[at] = 0x34;
                cpu.bus.0[at + 1] = 0x12;
                cpu.high[BX] = high;
                cpu.regs[BX] = low;
                step(&mut cpu);
                assert_eq!(cpu.regs[AX], 0x1234);
            }
        }
    }

    mod looking_at_a_selector {
        //! VERR, VERW, LAR and LSL. Each reports in the zero flag, and none
        //! faults for a selector it cannot use: that is what they are for.
        //! The selector is in AX; LAR and LSL answer in BX.

        use super::*;

        const VERR: [u8; 3] = [0x0f, 0x00, 0xe0];
        const VERW: [u8; 3] = [0x0f, 0x00, 0xe8];
        const LAR: [u8; 3] = [0x0f, 0x02, 0xd8];
        const LSL: [u8; 3] = [0x0f, 0x03, 0xd8];

        fn run(cpu: &mut Cpu<VecBus>, code: &[u8], selector: u16) -> bool {
            cpu.load_segment(CS, CODE_SELECTOR).unwrap();
            cpu.ip = 0;
            cpu.regs[AX] = selector;
            cpu.regs[BX] = 0x1234;
            cpu.bus.0[0x20000..0x20000 + code.len()].copy_from_slice(code);
            step(cpu);
            cpu.flags & ZF != 0
        }

        fn with_access(base: u32, limit: u32, access: u8) -> Descriptor {
            Descriptor {
                access: Some(access),
                ..plain(base, limit)
            }
        }

        #[test]
        fn finds_a_read_write_data_segment_readable_and_writable() {
            let mut cpu = protected(&[(3, plain(0x40000, 0xff))]);

            assert!(run(&mut cpu, &VERR, 0x18));
            assert!(run(&mut cpu, &VERW, 0x18));
        }

        #[test]
        fn finds_a_read_only_data_segment_readable_not_writable() {
            let mut cpu = protected(&[(3, with_access(0x40000, 0xff, 0x90))]);

            assert!(run(&mut cpu, &VERR, 0x18));
            assert!(!run(&mut cpu, &VERW, 0x18));
        }

        #[test]
        fn finds_readable_code_readable_execute_only_code_not_and_neither_writable() {
            let mut cpu = protected(&[
                (3, with_access(0x40000, 0xff, 0x9a)),
                (4, with_access(0x40000, 0xff, 0x98)),
            ]);

            assert!(run(&mut cpu, &VERR, 0x18));
            assert!(!run(&mut cpu, &VERW, 0x18));
            assert!(!run(&mut cpu, &VERR, 0x20));
        }

        #[test]
        fn does_not_check_whether_the_segment_is_present() {
            let mut cpu = protected(&[(
                3,
                Descriptor {
                    present: false,
                    ..plain(0x40000, 0xff)
                },
            )]);

            assert!(run(&mut cpu, &VERR, 0x18));
        }

        #[test]
        fn clears_the_zero_flag_without_a_fault_for_the_null_selector_and_one_past_the_table() {
            let mut cpu = protected(&[]);

            assert!(!run(&mut cpu, &VERR, 0x00));
            assert!(!run(&mut cpu, &VERW, 0x3));
            assert!(!run(&mut cpu, &VERR, 0x100));
            assert!(!run(&mut cpu, &LSL, 0x100));
            assert_eq!(cpu.regs[BX], 0x1234);
        }

        #[test]
        fn refuses_a_segment_more_privileged_than_the_selector_asks_from() {
            let mut cpu = protected(&[(3, plain(0x40000, 0xff))]);

            assert!(!run(&mut cpu, &VERR, 0x18 | 3));
        }

        #[test]
        fn answers_what_the_table_holds_now_not_what_a_segment_register_loaded() {
            let mut cpu = protected(&[(3, plain(0x40000, 0xff))]);

            cpu.load_segment(ES, 0x18).unwrap();
            write_descriptor(&mut cpu, 3, with_access(0, 0, 0x00));
            assert!(!run(&mut cpu, &VERR, 0x18));
        }

        #[test]
        fn loads_a_limit_in_bytes_with_lsl_and_a_granular_one_scaled() {
            let mut cpu = protected(&[
                (3, plain(0x40000, 0x1234)),
                (
                    4,
                    Descriptor {
                        granular: true,
                        ..plain(0x40000, 0x0000f)
                    },
                ),
            ]);

            assert!(run(&mut cpu, &LSL, 0x18));
            assert_eq!(cpu.regs[BX], 0x1234);
            assert!(run(&mut cpu, &LSL, 0x20));
            assert_eq!(cpu.regs[BX], 0xffff);
        }

        #[test]
        fn loads_the_access_byte_into_the_high_byte_with_lar() {
            let mut cpu = protected(&[(3, with_access(0x40000, 0xff, 0xf2))]);

            assert!(run(&mut cpu, &LAR, 0x18 | 3));
            assert_eq!(cpu.regs[BX], 0xf200);
        }

        #[test]
        fn takes_an_ldt_descriptor_with_lar_and_lsl_but_not_a_call_gate_with_lsl() {
            let mut cpu = protected(&[
                (3, with_access(0x40000, 0x77, 0x82)),
                (4, with_access(0, 0, 0x84)),
            ]);

            assert!(run(&mut cpu, &LSL, 0x18));
            assert_eq!(cpu.regs[BX], 0x77);
            assert!(run(&mut cpu, &LAR, 0x20));
            assert!(!run(&mut cpu, &LSL, 0x20));
            assert!(!run(&mut cpu, &VERR, 0x18));
        }
    }
}
