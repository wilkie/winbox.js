//! The hardware-captured conformance vectors, run against the Rust core
//! alone: no JavaScript core to take an instruction it leaves, as there is
//! none in the native engine. Each vector's one instruction is run by
//! [`Cpu::run`], and whatever stops it -- an opcode not interpreted, a fault
//! the core does not take, memory it leaves to a host -- is a failure, by
//! its kind.
//!
//! The vectors and the rules for comparing them are the JavaScript suites'
//! (`test/conformance/oracle.ts` and `oracle386.ts`): the 80286's from
//! <https://github.com/SingleStepTests/80286>, the 80386's from
//! <https://github.com/SingleStepTests/80386>, each set aside, skipped and
//! masked as those suites do, and sampled as `pnpm test:conformance` samples
//! them -- the first 250 of each 80286 opcode, the first 100 of each 80386
//! file. Fetch them with `node scripts/fetch-cpu-tests.mjs` (`--cpu 386
//! --all` for the 80386's); they are not committed.
//!
//! ```text
//! cargo test --release -p winbox-cpu --test conformance -- --ignored --nocapture
//! ```
//!
//! `CONFORMANCE_SAMPLE` changes the sample, `CONFORMANCE_ONLY` (a list of
//! files by name, `F6.6,660FAF`) narrows the run, and `CONFORMANCE_VERBOSE`
//! prints every file rather than only those with failures.

use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use winbox_cpu::{Bus, CS, Cpu, DS, ES, Exit, FS, GS, SS, X87};

/// The FLAGS bits the JavaScript core models, as `oracle.ts` compares them.
const FLAG_MASK: u32 = 0x7fd5;

/// The suite's vectors' directory, under the repository's `test/conformance`.
fn vectors(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/conformance")
        .join(name)
}

fn sample(default: usize) -> usize {
    std::env::var("CONFORMANCE_SAMPLE")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn only() -> Option<HashSet<String>> {
    std::env::var("CONFORMANCE_ONLY").ok().map(|list| {
        list.split(',')
            .map(|name| name.trim().to_uppercase())
            .collect()
    })
}

/// Memory as the JavaScript core's `Memory` keeps it: mebibyte blocks made
/// as they are written, and a block never written read as its garbage,
/// `0x1234 % address`. What a test writes is noted, to be cleared for the
/// next.
struct Memory {
    bytes: Vec<u8>,
    written: Vec<u32>,
    blocks: [bool; 4],
}

impl Memory {
    fn new() -> Self {
        Self {
            bytes: vec![0; 4 << 20],
            written: Vec::new(),
            blocks: [false; 4],
        }
    }

    fn clear(&mut self) {
        for &at in &self.written {
            self.bytes[at as usize] = 0;
        }

        self.written.clear();
        self.blocks = [false; 4];
    }

    fn garbage(at: u32) -> u8 {
        if at == 0 { 0 } else { (0x1234 % at) as u8 }
    }

    fn present(&self, at: u32) -> bool {
        self.blocks
            .get((at >> 20) as usize)
            .copied()
            .unwrap_or(false)
    }
}

impl Bus for Memory {
    fn read8(&self, at: u32) -> Option<u8> {
        Some(if self.present(at) {
            self.bytes[at as usize]
        } else {
            Self::garbage(at)
        })
    }

    fn write8(&mut self, at: u32, value: u8) -> Option<()> {
        if let Some(byte) = self.bytes.get_mut(at as usize) {
            *byte = value;
            self.written.push(at);
            self.blocks[(at >> 20) as usize] = true;
        }

        Some(())
    }

    /// A word in a block never written is its first byte's garbage twice,
    /// as `readGarbage` makes it.
    fn read16(&self, at: u32) -> Option<u16> {
        if !self.present(at) {
            let byte = u16::from(Self::garbage(at));

            return Some(byte | byte << 8);
        }

        Some(u16::from(self.read8(at)?) | (u16::from(self.read8(at.wrapping_add(1))?) << 8))
    }
}

/// How a vector went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    /// Stopped by an opcode the core does not interpret.
    Unimplemented,
    /// Stopped by a fault the core did not take.
    Fault,
    /// Stopped for a host: memory, a segment load, `HLT`.
    Host,
    Register,
    Memory,
    Flags,
}

const KINDS: [Kind; 6] = [
    Kind::Unimplemented,
    Kind::Fault,
    Kind::Host,
    Kind::Register,
    Kind::Memory,
    Kind::Flags,
];

#[derive(Debug, Default)]
struct Summary {
    file: String,
    total: usize,
    passed: usize,
    skipped: usize,
    kinds: BTreeMap<Kind, usize>,
    /// The opcode byte each `Unimplemented` stop named, and how often.
    unimplemented: BTreeMap<u8, usize>,
    example: Option<String>,
}

impl Summary {
    fn fail(&mut self, kind: Kind, name: &str, bytes: &[u8], detail: &str) {
        *self.kinds.entry(kind).or_default() += 1;

        if self.example.is_none() {
            let bytes: Vec<String> = bytes.iter().map(|byte| format!("{byte:02x}")).collect();

            self.example = Some(format!("{name} ({}): {detail}", bytes.join(" ")));
        }
    }
}

/// Runs the instruction at CS:IP: `Err` with how it stopped, if it did.
fn step(cpu: &mut Cpu<Memory>, summary: &mut Summary) -> Result<(), (Kind, String)> {
    let (ran, exit) = cpu.run(1);

    if ran == 1 {
        return Ok(());
    }

    Err(match exit {
        Exit::Unimplemented(opcode) => {
            *summary.unimplemented.entry(opcode).or_default() += 1;
            (Kind::Unimplemented, format!("unimplemented {opcode:02x}"))
        }
        Exit::Fault(vector) => (Kind::Fault, format!("fault {vector}")),
        other => (Kind::Host, format!("{other:?}")),
    })
}

/// A fresh real-mode machine on `memory`, with the unit the JavaScript
/// core always has.
fn machine(memory: Memory) -> Cpu<Memory> {
    let mut cpu = Cpu::new(memory);

    cpu.fpu = Some(X87::default());
    cpu.interrupt_table = Some(0);
    cpu
}

/// The machine made afresh for the next test, on the same memory cleared.
fn fresh(cpu: Cpu<Memory>) -> Cpu<Memory> {
    let mut memory = cpu.bus;

    memory.clear();
    machine(memory)
}

/// Every file's summary, the files run on as many threads as there are.
fn run_all<F>(files: Vec<String>, run: F) -> Vec<Summary>
where
    F: Fn(&str, Memory) -> (Summary, Memory) + Sync,
{
    let queue = Mutex::new(files);
    let done = Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map_or(4, usize::from);

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut memory = Memory::new();

                loop {
                    let Some(file) = queue.lock().unwrap().pop() else {
                        break;
                    };
                    let (summary, back) = run(&file, memory);

                    memory = back;
                    done.lock().unwrap().push(summary);
                }
            });
        }
    });

    let mut summaries = done.into_inner().unwrap();

    summaries.sort_by(|a, b| a.file.cmp(&b.file));
    summaries
}

#[allow(clippy::cast_precision_loss)]
fn report(part: &str, summaries: &[Summary]) -> (usize, usize) {
    let verbose = std::env::var("CONFORMANCE_VERBOSE").is_ok();
    let mut unimplemented: BTreeMap<u8, usize> = BTreeMap::new();
    let (mut total, mut passed) = (0, 0);
    let mut kinds: BTreeMap<Kind, usize> = BTreeMap::new();

    println!("\n{part}: file, passed/total, then failures by kind and the first");

    for summary in summaries {
        total += summary.total;
        passed += summary.passed;

        for (opcode, count) in &summary.unimplemented {
            *unimplemented.entry(*opcode).or_default() += count;
        }

        for (kind, count) in &summary.kinds {
            *kinds.entry(*kind).or_default() += count;
        }

        if summary.passed == summary.total && !verbose {
            continue;
        }

        let failures: Vec<String> = KINDS
            .iter()
            .filter_map(|kind| {
                summary
                    .kinds
                    .get(kind)
                    .map(|count| format!("{kind:?} {count}"))
            })
            .collect();

        println!(
            "  {:10} {:4}/{:4}  {}  {}",
            summary.file,
            summary.passed,
            summary.total,
            failures.join(", "),
            summary.example.as_deref().unwrap_or("")
        );
    }

    println!("{part}: failures by kind: {kinds:?}");
    println!("{part}: unimplemented, by opcode byte: {unimplemented:02x?}");
    println!(
        "{part}: {passed}/{total} vectors ({:.1}%) across {} files",
        100.0 * passed as f64 / total.max(1) as f64,
        summaries.len()
    );

    (passed, total)
}

/* ---- the 80286's vectors: JSON, a file to an opcode ---- */

const REGISTERS16: [(&str, usize); 8] = [
    ("ax", 0),
    ("cx", 1),
    ("dx", 2),
    ("bx", 3),
    ("sp", 4),
    ("bp", 5),
    ("si", 6),
    ("di", 7),
];

const SEGMENTS16: [(&str, usize); 4] = [("es", ES), ("cs", CS), ("ss", SS), ("ds", DS)];

fn number(value: &serde_json::Value) -> u32 {
    value.as_u64().expect("a number") as u32
}

fn ram(value: &serde_json::Value) -> Vec<(u32, u8)> {
    value
        .as_array()
        .expect("RAM")
        .iter()
        .map(|pair| (number(&pair[0]), number(&pair[1]) as u8))
        .collect()
}

/// Whether the prefixes include LOCK: a 286 ignores it, a 386 does not.
fn lock_prefixed(bytes: &[u8]) -> bool {
    for &byte in bytes {
        if byte == 0xf0 {
            return true;
        }

        if ![0x26, 0x2e, 0x36, 0x3e, 0xf2, 0xf3].contains(&byte) {
            return false;
        }
    }

    false
}

/// A byte shifted left or right by 16 or 24, which the 386 and the 286
/// leave CF differently for (`oracle.ts`, `byteShiftBy16Or24`).
fn byte_shift_by_16_or_24(bytes: &[u8], cx: u32) -> bool {
    let at = bytes
        .iter()
        .position(|byte| ![0x26, 0x2e, 0x36, 0x3e, 0xf2, 0xf3, 0xf0].contains(byte))
        .unwrap_or(bytes.len());
    let opcode = bytes.get(at).copied().unwrap_or(0);
    let modrm = bytes.get(at + 1).copied().unwrap_or(0);
    let operation = (modrm >> 3) & 7;

    if (opcode != 0xc0 && opcode != 0xd2) || !(4..=6).contains(&operation) {
        return false;
    }

    let (mode, rm) = (modrm >> 6, modrm & 7);
    let displacement = match mode {
        1 => 1,
        2 => 2,
        0 if rm == 6 => 2,
        _ => 0,
    };
    let count = if opcode == 0xd2 {
        cx & 0x1f
    } else {
        u32::from(bytes.get(at + 2 + displacement).copied().unwrap_or(0)) & 0x1f
    };

    count == 16 || count == 24
}

fn run_286_file(file: &str, memory: Memory, sample: usize) -> (Summary, Memory) {
    let path = vectors("vectors").join(format!("{file}.json"));
    let tests: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).expect("vectors")).expect("JSON");
    let mut summary = Summary {
        file: file.to_string(),
        ..Summary::default()
    };
    let mut cpu = machine(memory);

    for test in tests.as_array().expect("tests").iter().take(sample) {
        let bytes: Vec<u8> = test["bytes"]
            .as_array()
            .expect("bytes")
            .iter()
            .map(|byte| number(byte) as u8)
            .collect();
        let name = test["name"].as_str().unwrap_or("");
        let initial = &test["initial"]["regs"];

        if lock_prefixed(&bytes) || byte_shift_by_16_or_24(&bytes, number(&initial["cx"])) {
            summary.skipped += 1;
            continue;
        }

        cpu = fresh(cpu);

        for (at, value) in ram(&test["initial"]["ram"]) {
            cpu.bus.write8(at, value);
        }

        for (name, index) in SEGMENTS16 {
            cpu.load_segment(index, number(&initial[name]) as u16)
                .expect("a real-mode load");
        }

        for (name, index) in REGISTERS16 {
            cpu.regs[index] = number(&initial[name]) as u16;
        }

        cpu.ip = number(&initial["ip"]) as u16;
        cpu.flags = (number(&initial["flags"]) & FLAG_MASK) as u16 | 2;

        let outcome = step(&mut cpu, &mut summary);
        let last = &test["final"]["regs"];

        if outcome.is_ok() {
            /* A stack access past its limit: #GP on the 286, #SS on the
             * 386, which the 386's own vectors test. */
            let handler = |cpu: &Cpu<Memory>, entry: u32| {
                (
                    cpu.bus.read16(entry * 4 + 2).unwrap(),
                    cpu.bus.read16(entry * 4).unwrap(),
                )
            };
            let (gp_cs, gp_ip) = handler(&cpu, 13);
            let (ss_cs, ss_ip) = handler(&cpu, 12);

            if last["cs"].as_u64() == Some(u64::from(gp_cs))
                && last["ip"].as_u64().map(|ip| (ip as u16).wrapping_sub(1)) == Some(gp_ip)
                && cpu.segments[CS].selector == ss_cs
                && cpu.ip == ss_ip
                && (gp_cs, gp_ip) != (ss_cs, ss_ip)
            {
                summary.skipped += 1;
                continue;
            }
        }

        summary.total += 1;

        let result = outcome.and_then(|()| compare_286(&cpu, test));

        match result {
            Ok(()) => summary.passed += 1,
            Err((kind, detail)) => summary.fail(kind, name, &bytes, &detail),
        }
    }

    (summary, cpu.bus)
}

fn compare_286(cpu: &Cpu<Memory>, test: &serde_json::Value) -> Result<(), (Kind, String)> {
    let last = &test["final"]["regs"];

    for (name, value) in last.as_object().expect("registers") {
        if name == "flags" {
            continue;
        }

        let value = number(value) as u16;
        let (expected, actual) = if name == "ip" {
            (value.wrapping_sub(1), cpu.ip)
        } else if let Some(&(_, index)) = REGISTERS16.iter().find(|(n, _)| n == name) {
            (value, cpu.regs[index])
        } else if let Some(&(_, index)) = SEGMENTS16.iter().find(|(n, _)| n == name) {
            (value, cpu.segments[index].selector)
        } else {
            continue;
        };

        if expected != actual {
            return Err((
                Kind::Register,
                format!("{name}: expected {expected:x}, got {actual:x}"),
            ));
        }
    }

    for (at, expected) in ram(&test["final"]["ram"]) {
        let actual = cpu.bus.read8(at).unwrap();

        if actual != expected {
            return Err((
                Kind::Memory,
                format!("[{at:x}]: expected {expected:x}, got {actual:x}"),
            ));
        }
    }

    if let Some(flags) = last.get("flags") {
        let expected = number(flags) & FLAG_MASK;
        let actual = u32::from(cpu.flags) & FLAG_MASK;

        if expected != actual {
            return Err((
                Kind::Flags,
                format!("flags: expected {expected:04x}, got {actual:04x}"),
            ));
        }
    }

    Ok(())
}

#[test]
#[ignore = "slow, and needs the vectors: node scripts/fetch-cpu-tests.mjs"]
fn vectors_286() {
    let directory = vectors("vectors");
    let Ok(entries) = fs::read_dir(&directory) else {
        println!("no 80286 vectors at {}", directory.display());
        return;
    };
    let only = only();
    let files: Vec<String> = entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;

            name.strip_suffix(".json").map(str::to_string)
        })
        .filter(|name| {
            only.as_ref()
                .is_none_or(|only| only.contains(&name.to_uppercase()))
        })
        .collect();
    let sample = sample(250);
    let summaries = run_all(files, |file, memory| run_286_file(file, memory, sample));

    report("80286", &summaries);
}

/* ---- the 80386's vectors: MOO, a file to an opcode and its prefixes ---- */

/// The 32-bit register file's order in `RG32` and `RM32` chunks.
const MOO_REGISTERS: [&str; 20] = [
    "cr0", "cr3", "eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp", "cs", "ds", "es", "fs",
    "gs", "ss", "eip", "eflags", "dr6", "dr7",
];

const GENERAL32: [(&str, usize); 8] = [
    ("eax", 0),
    ("ecx", 1),
    ("edx", 2),
    ("ebx", 3),
    ("esp", 4),
    ("ebp", 5),
    ("esi", 6),
    ("edi", 7),
];

const SEGMENTS32: [(&str, usize); 6] = [
    ("cs", CS),
    ("ss", SS),
    ("ds", DS),
    ("es", ES),
    ("fs", FS),
    ("gs", GS),
];

#[derive(Debug, Default, Clone)]
struct State {
    regs: BTreeMap<&'static str, u32>,
    masks: BTreeMap<&'static str, u32>,
    ram: Vec<(u32, u8)>,
}

#[derive(Debug, Default)]
struct MooTest {
    name: String,
    bytes: Vec<u8>,
    initial: State,
    last: State,
    hash: String,
}

struct Chunks<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Iterator for Chunks<'a> {
    type Item = ([u8; 4], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        if self.at + 8 > self.data.len() {
            return None;
        }

        let kind: [u8; 4] = self.data[self.at..self.at + 4].try_into().ok()?;
        let length = u32::from_le_bytes(self.data[self.at + 4..self.at + 8].try_into().ok()?);
        let start = self.at + 8;
        let end = (start + length as usize).min(self.data.len());

        self.at = end;
        Some((kind, &self.data[start..end]))
    }
}

fn chunks(data: &[u8]) -> Chunks<'_> {
    Chunks { data, at: 0 }
}

fn le32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().expect("four bytes"))
}

fn registers(data: &[u8]) -> BTreeMap<&'static str, u32> {
    let present = le32(data, 0);
    let mut at = 4;
    let mut out = BTreeMap::new();

    for (bit, name) in MOO_REGISTERS.iter().enumerate() {
        if present & (1 << bit) != 0 {
            out.insert(*name, le32(data, at));
            at += 4;
        }
    }

    out
}

fn state(data: &[u8]) -> State {
    let mut state = State::default();

    for (kind, payload) in chunks(data) {
        match &kind {
            b"RG32" => state.regs = registers(payload),
            b"RM32" => state.masks = registers(payload),
            b"RAM " => {
                let count = le32(payload, 0) as usize;

                for entry in 0..count {
                    let at = 4 + entry * 5;

                    state.ram.push((le32(payload, at), payload[at + 4]));
                }
            }
            _ => {}
        }
    }

    state
}

fn prefixed(data: &[u8]) -> &[u8] {
    let length = le32(data, 0) as usize;

    &data[4..4 + length]
}

/// A MOO file's tests, and the masks every test in it shares.
fn parse_moo(path: &Path) -> (BTreeMap<&'static str, u32>, Vec<MooTest>) {
    let mut data = Vec::new();

    flate2::read::GzDecoder::new(fs::File::open(path).expect("vectors"))
        .read_to_end(&mut data)
        .expect("gzip");

    let mut masks = BTreeMap::new();
    let mut tests = Vec::new();

    for (kind, payload) in chunks(&data) {
        match &kind {
            b"RM32" => masks = registers(payload),
            b"TEST" => {
                let mut test = MooTest::default();

                for (part, body) in chunks(&payload[4..]) {
                    match &part {
                        b"NAME" => test.name = String::from_utf8_lossy(prefixed(body)).into(),
                        b"BYTS" => test.bytes = prefixed(body).to_vec(),
                        b"INIT" => test.initial = state(body),
                        b"FINA" => test.last = state(body),
                        b"HASH" => {
                            test.hash = body.iter().fold(String::new(), |mut hash, byte| {
                                let _ = write!(hash, "{byte:02x}");
                                hash
                            });
                        }
                        _ => {}
                    }
                }

                tests.push(test);
            }
            _ => {}
        }
    }

    (masks, tests)
}

/// Tests the suite has since found bad, by hash.
fn revoked() -> HashSet<String> {
    fs::read_to_string(vectors("vectors386").join("revocation_list.txt"))
        .unwrap_or_default()
        .lines()
        .map(|line| line.trim().to_lowercase())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
}

/// The flags each opcode defines, as masks of those to compare: the suite's
/// `80386.csv`, keyed by opcode and, for a group, member (`C1.4`).
fn defined_flags() -> BTreeMap<String, u32> {
    let text = fs::read_to_string(vectors("vectors386").join("80386.csv")).unwrap_or_default();
    let mut lines = text.lines();
    let head: Vec<&str> = lines.next().unwrap_or("").split(',').collect();
    let column = |name: &str| head.iter().position(|cell| *cell == name);
    let (Some(op), Some(member), Some(mask)) = (column("op"), column("ex"), column("f_umask"))
    else {
        return BTreeMap::new();
    };
    let mut masks = BTreeMap::new();

    for line in lines {
        let cells: Vec<&str> = line.split(',').collect();
        let (Some(code), Some(value)) = (cells.get(op), cells.get(mask)) else {
            continue;
        };

        if code.is_empty() || value.is_empty() {
            continue;
        }

        let key = match cells.get(member) {
            Some(member) if !member.is_empty() => format!("{code}.{member}"),
            _ => (*code).to_string(),
        };

        // As `parseInt(mask, 16)` reads it, a leading `0x` and all.
        let digits = value
            .strip_prefix("0x")
            .or_else(|| value.strip_prefix("0X"))
            .unwrap_or(value);

        if let Ok(value) = u32::from_str_radix(digits, 16) {
            masks.insert(key.to_uppercase(), value);
        }
    }

    masks
}

/// A file's name without its size prefixes: `6766C1.4` is `C1.4`.
fn base_of(stem: &str) -> String {
    let mut name = stem.to_uppercase();

    while name.len() > 2 && (name.starts_with("66") || name.starts_with("67")) {
        name = name[2..].to_string();
    }

    name
}

/// IN, OUT, INS, OUTS and HLT, which `oracle386.ts` sets aside.
const SET_ASIDE: [u8; 13] = [
    0x6c, 0x6d, 0x6e, 0x6f, 0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef, 0xf4,
];

fn opcode_of(bytes: &[u8]) -> Option<u8> {
    bytes.iter().copied().find(|byte| {
        ![
            0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0x66, 0x67, 0xf0, 0xf2, 0xf3,
        ]
        .contains(byte)
    })
}

#[allow(clippy::too_many_lines)]
fn run_386_file(
    file: &str,
    memory: Memory,
    sample: usize,
    bad: &HashSet<String>,
    defined: &BTreeMap<String, u32>,
) -> (Summary, Memory) {
    let (file_masks, tests) = parse_moo(&vectors("vectors386").join(format!("{file}.MOO.gz")));
    let defined = defined.get(&base_of(file)).copied().unwrap_or(0xffff);
    let mut summary = Summary {
        file: file.to_string(),
        skipped: tests.iter().filter(|test| bad.contains(&test.hash)).count(),
        ..Summary::default()
    };
    let mut cpu = machine(memory);

    for test in tests
        .iter()
        .filter(|test| !bad.contains(&test.hash))
        .take(sample)
    {
        if opcode_of(&test.bytes).is_some_and(|opcode| SET_ASIDE.contains(&opcode)) {
            summary.skipped += 1;
            continue;
        }

        cpu = fresh(cpu);

        for &(at, value) in &test.initial.ram {
            cpu.bus.write8(at, value);
        }

        let initial = &test.initial.regs;

        for (name, index) in SEGMENTS32 {
            let selector = initial.get(name).copied().unwrap_or(0) as u16;

            cpu.load_segment(index, selector).expect("a real-mode load");
        }

        for (name, index) in GENERAL32 {
            let value = initial.get(name).copied().unwrap_or(0);

            cpu.regs[index] = value as u16;
            cpu.high[index] = (value >> 16) as u16;
        }

        cpu.ip = initial.get("eip").copied().unwrap_or(0) as u16;
        cpu.flags = (initial.get("eflags").copied().unwrap_or(0) & FLAG_MASK) as u16 | 2;

        summary.total += 1;

        let result = step(&mut cpu, &mut summary).and_then(|()| {
            let last = &test.last.regs;
            let mask = |name: &str| {
                test.last
                    .masks
                    .get(name)
                    .or_else(|| file_masks.get(name))
                    .copied()
                    .unwrap_or(u32::MAX)
            };

            for (name, index) in GENERAL32 {
                let Some(&value) = last.get(name) else {
                    continue;
                };
                let expected = value & mask(name);
                let actual =
                    (u32::from(cpu.regs[index]) | u32::from(cpu.high[index]) << 16) & mask(name);

                if expected != actual {
                    return Err((
                        Kind::Register,
                        format!("{name}: expected {expected:x}, got {actual:x}"),
                    ));
                }
            }

            for (name, index) in SEGMENTS32 {
                let Some(&value) = last.get(name) else {
                    continue;
                };
                let (expected, actual) = (value as u16, cpu.segments[index].selector);

                if expected != actual {
                    return Err((
                        Kind::Register,
                        format!("{name}: expected {expected:x}, got {actual:x}"),
                    ));
                }
            }

            if let Some(&eip) = last.get("eip") {
                let expected = (eip as u16).wrapping_sub(1);

                if expected != cpu.ip {
                    return Err((
                        Kind::Register,
                        format!("eip: expected {expected:x}, got {:x}", cpu.ip),
                    ));
                }
            }

            for &(at, expected) in &test.last.ram {
                let actual = cpu.bus.read8(at).unwrap();

                if actual != expected {
                    return Err((
                        Kind::Memory,
                        format!("[{at:x}]: expected {expected:x}, got {actual:x}"),
                    ));
                }
            }

            if let Some(&flags) = last.get("eflags") {
                let kept = FLAG_MASK & mask("eflags") & defined;
                let (expected, actual) = (flags & kept, u32::from(cpu.flags) & kept);

                if expected != actual {
                    return Err((
                        Kind::Flags,
                        format!("flags: expected {expected:04x}, got {actual:04x}"),
                    ));
                }
            }

            Ok(())
        });

        match result {
            Ok(()) => summary.passed += 1,
            Err((kind, detail)) => summary.fail(kind, &test.name, &test.bytes, &detail),
        }
    }

    (summary, cpu.bus)
}

#[test]
#[ignore = "slow, and needs the vectors: node scripts/fetch-cpu-tests.mjs --cpu 386 --all"]
fn vectors_386() {
    let directory = vectors("vectors386");
    let Ok(entries) = fs::read_dir(&directory) else {
        println!("no 80386 vectors at {}", directory.display());
        return;
    };
    let only = only();
    let files: Vec<String> = entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;

            name.strip_suffix(".MOO.gz").map(str::to_string)
        })
        .filter(|name| {
            only.as_ref()
                .is_none_or(|only| only.contains(&name.to_uppercase()))
        })
        .collect();
    let sample = sample(100);
    let bad = revoked();
    let defined = defined_flags();
    let summaries = run_all(files, |file, memory| {
        run_386_file(file, memory, sample, &bad, &defined)
    });

    report("80386", &summaries);
}
