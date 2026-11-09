//! The core's speed: instructions a millisecond for four fixed workloads,
//! each in real mode and in protected mode.
//!
//! `cargo run --release -p winbox-cpu --example bench`, from the
//! repository's root; `BENCH_MS` sets each run's length in milliseconds
//! (2,000 by default). The numbers are only worth setting beside each other,
//! on one machine on one day: a change's cost is a ratio. Run it a few
//! times and take the median; single runs move by several percent.
//!
//! The workloads are four, `alu`, `memory`, `stack` and `mixed`: each a
//! straight run of instructions closed by a short jump back to its top, run
//! for ever with nothing of the host's in between. The same
//! instructions were timed under the recorder's DOSBox, Windows running
//! them as the body of a `LOOP` (the `cpurate` probe,
//! `oracle/fixtures/timings/cpurate.json`); where that recording is
//! there, its medians are printed beside these, protected mode being
//! where Windows ran them.

use std::time::Instant;

use winbox_cpu::{AX, BP, BX, CS, CX, Cpu, DS, DX, ES, Exit, SP, SS, VecBus};

/// Instructions run between reads of the clock, to keep it off the hot
/// path.
const BATCH: u64 = 20_000;

/// Where the workload, its data and its stack are, as real-mode segments;
/// in protected mode the same places are selectors 08h, 10h and 18h of a
/// table at `GDT_BASE`.
const CODE_SEGMENT: u32 = 0x1000;
const DATA_SEGMENT: u32 = 0x2000;
const STACK_SEGMENT: u32 = 0x3000;
const GDT_BASE: u32 = 0x8_0000;

struct Workload {
    name: &'static str,
    what: &'static str,
    code: &'static [u8],
}

#[rustfmt::skip]
const WORKLOADS: [Workload; 4] = [
    Workload {
        name: "alu",
        what: "register-only arithmetic, no memory operands",
        code: &[
            0x01, 0xd8,       // add ax, bx
            0x29, 0xc8,       // sub ax, cx
            0x31, 0xd0,       // xor ax, dx
            0x21, 0xd8,       // and ax, bx
            0x09, 0xc8,       // or  ax, cx
            0xd1, 0xe0,       // shl ax, 1
            0x40,             // inc ax
            0x48,             // dec ax
            0xeb, 0xf0,       // jmp back to the top
        ],
    },
    Workload {
        name: "memory",
        what: "byte and word loads and stores through a base register",
        code: &[
            0x8a, 0x07,       // mov al, [bx]
            0x88, 0x07,       // mov [bx], al
            0x8b, 0x07,       // mov ax, [bx]
            0x89, 0x07,       // mov [bx], ax
            0x8b, 0x47, 0x10, // mov ax, [bx+10h]
            0x89, 0x47, 0x20, // mov [bx+20h], ax
            0xeb, 0xf0,       // jmp back to the top
        ],
    },
    Workload {
        name: "stack",
        what: "pushes and pops, the shape of a call frame",
        code: &[
            0x50,             // push ax
            0x53,             // push bx
            0x51,             // push cx
            0x59,             // pop  cx
            0x5b,             // pop  bx
            0x58,             // pop  ax
            0xeb, 0xf8,       // jmp back to the top
        ],
    },
    Workload {
        name: "mixed",
        what: "arithmetic against memory, the shape of compiled code",
        code: &[
            0x8b, 0x07,       // mov ax, [bx]
            0x03, 0x47, 0x02, // add ax, [bx+2]
            0x89, 0x47, 0x04, // mov [bx+4], ax
            0x2b, 0x47, 0x06, // sub ax, [bx+6]
            0x89, 0x07,       // mov [bx], ax
            0x43,             // inc bx
            0x4b,             // dec bx
            0xeb, 0xef,       // jmp back to the top
        ],
    },
];

/// A read/write data descriptor, present, DPL 0, of `limit` bytes less one
/// at `base`: sized as a Win16 selector is, so that limits are checked as
/// a program's are.
fn write_descriptor(memory: &mut [u8], index: u32, base: u32, limit: u32) {
    let at = (GDT_BASE + index * 8) as usize;

    memory[at..at + 8].copy_from_slice(&[
        limit as u8,
        (limit >> 8) as u8,
        base as u8,
        (base >> 8) as u8,
        (base >> 16) as u8,
        0x92,
        ((limit >> 16) & 0x0f) as u8,
        (base >> 24) as u8,
    ]);
}

/// A core with the workload in place and its registers set.
fn prepare(workload: &Workload, protected: bool) -> Cpu<VecBus> {
    let mut memory = vec![0; 0x10_0000];
    let code_at = (CODE_SEGMENT << 4) as usize;

    memory[code_at..code_at + workload.code.len()].copy_from_slice(workload.code);

    let selectors = if protected {
        write_descriptor(&mut memory, 1, CODE_SEGMENT << 4, 0xffff);
        write_descriptor(&mut memory, 2, DATA_SEGMENT << 4, 0xffff);
        write_descriptor(&mut memory, 3, STACK_SEGMENT << 4, 0xffff);
        [0x08, 0x10, 0x18]
    } else {
        [CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT].map(|segment| segment as u16)
    };
    let mut cpu = Cpu::new(VecBus(memory));

    if protected {
        cpu.gdt_base = GDT_BASE;
        cpu.gdt_limit = 0xff;
        cpu.protected = true;
        cpu.msw = Some(1);
    }

    let [code, data, stack] = selectors;

    for (segment, selector) in [(CS, code), (DS, data), (ES, data), (SS, stack)] {
        cpu.load_segment(segment, selector)
            .expect("the workload's segments");
    }

    cpu.ip = 0;
    cpu.regs[SP] = 0x1000;
    cpu.regs[BP] = 0x0800;
    cpu.regs[BX] = 0x0100;
    cpu.regs[AX] = 0x1234;
    cpu.regs[CX] = 0x00ff;
    cpu.regs[DX] = 0x5678;
    cpu
}

/// One workload run for `milliseconds`: instructions a millisecond.
fn measure(workload: &Workload, protected: bool, milliseconds: f64) -> f64 {
    let mut cpu = prepare(workload, protected);
    let mut batch = || {
        let (ran, exit) = cpu.run(BATCH);

        assert_eq!(
            (ran, exit),
            (BATCH, Exit::Budget),
            "{} stopped before its budget",
            workload.name
        );
    };

    batch();

    let started = Instant::now();
    let mut ran = 0;

    loop {
        batch();
        ran += BATCH;

        let elapsed = started.elapsed().as_secs_f64() * 1000.0;

        if elapsed >= milliseconds {
            // Some billions at most: exact in a double.
            #[allow(clippy::cast_precision_loss)]
            return ran as f64 / elapsed;
        }
    }
}

/// DOSBox's rate for a workload, the median of `cpurate`'s three runs,
/// where the recording is there.
fn dosbox(name: &str) -> Option<f64> {
    let text = std::fs::read_to_string("oracle/fixtures/timings/cpurate.json").ok()?;
    let mut rates: Vec<f64> = text
        .split("\"args\": \"")
        .skip(1)
        .filter(|record| record.starts_with(&format!("{name},")))
        .filter_map(|record| {
            let result = record.split("\"result\": \"").nth(1)?;

            result.split(',').next()?.parse().ok()
        })
        .collect();

    rates.sort_by(f64::total_cmp);
    rates.get(rates.len() / 2).copied()
}

fn main() {
    let milliseconds = std::env::var("BENCH_MS")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(2000.0);

    println!("instructions a millisecond, higher is better ({milliseconds} ms a run)");
    println!("{:<9}{:>10}{:>11}{:>10}", "", "real", "protected", "DOSBox");

    for workload in &WORKLOADS {
        let real = measure(workload, false, milliseconds);
        let protected = measure(workload, true, milliseconds);
        let dosbox =
            dosbox(workload.name).map_or_else(|| "-".to_string(), |rate| format!("{rate:.0}"));

        println!(
            "{:<9}{real:>10.0}{protected:>11.0}{dosbox:>10}   {}",
            workload.name, workload.what
        );
    }
}
