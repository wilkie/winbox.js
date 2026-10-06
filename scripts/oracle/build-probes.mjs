#!/usr/bin/env node
/**
 * Compiles the oracle probes into real 16-bit Windows executables.
 *
 * Not a simulation of one: these come out as NE binaries with the same header
 * and the same import tables as any Windows 3.1 application, which means the
 * loader, the linker and the thunk machinery are all under test alongside the
 * functions being probed. A probe that cannot be loaded is telling us
 * something too.
 *
 *   node scripts/oracle/build-probes.mjs
 *   node scripts/oracle/build-probes.mjs strings     # just one
 *
 * Needs the toolchain from fetch-toolchain.mjs. Writes oracle/build/probes/.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCOM = join(ROOT, 'oracle', '.cache', 'watcom');
const PROBES = join(ROOT, 'oracle', 'probes');
const BUILD = join(ROOT, 'oracle', 'build', 'probes');

function log(...args) {
  console.log(...args);
}

const TOOLS = join(WATCOM, 'binl64');

/**
 * Runs a Watcom tool.
 *
 * The tools have to be reached through PATH rather than by absolute path:
 * `wlink` locates its own initialisation file -- the one that defines what
 * `system windows` means -- by searching PATH for itself, and invoked any
 * other way it silently loses every 16-bit target and fails much later with a
 * pile of undefined symbols.
 */
function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WATCOM,
        PATH: `${TOOLS}:${process.env.PATH ?? ''}`,
        // The 16-bit compiler finds its headers through INCLUDE, not a flag.
        INCLUDE: [join(WATCOM, 'h'), join(WATCOM, 'h', 'win'), PROBES].join(':'),
      },
    });

    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));

    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} is missing; run scripts/oracle/fetch-toolchain.mjs`)
          : error
      )
    );

    child.on('close', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`${basename(command)} exited ${code}:\n${output.trim()}`))
    );
  });
}

/**
 * Confirms the linker produced a Windows executable and reports its imports.
 *
 * An NE file starts with a DOS stub whose header points at the real one, and
 * the byte at 0x36 of that header says which operating system it targets --
 * 2 for Windows. Reading the module reference table back out is a cheap way to
 * see that the probe really does import from KERNEL and USER rather than
 * having been quietly linked as something else.
 */
async function describe(path) {
  const data = await readFile(path);

  if (data.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${basename(path)} is not an executable`);
  }

  const header = data.readUInt16LE(0x3c);

  if (data.readUInt16LE(header) !== 0x454e) {
    throw new Error(`${basename(path)} is not an NE executable`);
  }

  if (data.readUInt8(header + 0x36) !== 2) {
    throw new Error(`${basename(path)} does not target Windows`);
  }

  const count = data.readUInt16LE(header + 0x1e);
  const table = data.readUInt16LE(header + 0x28);
  const names = data.readUInt16LE(header + 0x2a);

  const modules = [];

  for (let index = 0; index < count; index++) {
    const at = header + names + data.readUInt16LE(header + table + index * 2);
    modules.push(data.subarray(at + 1, at + 1 + data.readUInt8(at)).toString('ascii'));
  }

  return { bytes: data.length, modules };
}

/**
 * Compiles and links a probe's library: `<name>.dll.c`, built as
 * `<NAME>D.DLL` so that its module's name is not the program's. An
 * installable driver is one, and a probe measuring what Windows sends a
 * driver brings its own.
 */
async function buildLibrary(name) {
  const source = join(PROBES, `${name}.dll.c`);
  const object = join(BUILD, `${name}d.o`);
  const library = join(BUILD, `${name.toUpperCase()}D.DLL`);

  /* -bd builds for a library, and -zu does not take SS for DS: a library's
   * code runs on its callers' stacks. */
  await run(
    'wcc',
    ['-bt=windows', '-bd', '-zu', '-ml', '-zW', '-q', '-w4', `-fo=${object}`, source],
    BUILD
  );
  await run(
    'wlink',
    ['system', 'windows_dll', 'option', 'quiet', 'name', library, 'file', object],
    BUILD
  );
  await rm(object, { force: true });

  return library;
}

/**
 * Compiles and links a probe's second program: `<name>.child.c`, built as
 * `<NAME>C.EXE`. A probe measuring how one program starts another brings
 * the other.
 */
async function buildChild(name) {
  const source = join(PROBES, `${name}.child.c`);
  const object = join(BUILD, `${name}c.o`);
  const executable = join(BUILD, `${name.toUpperCase()}C.EXE`);

  await run('wcc', ['-bt=windows', '-ml', '-zW', '-q', '-w4', `-fo=${object}`, source], BUILD);

  /* A child that defines `IMPORTS_PROBE_LIBRARY` imports from the probe's
   * library by its name, as a program imports a DLL of its own: linked
   * against an import library made from the DLL. */
  const imports = (await readFile(source, 'latin1')).includes('#define IMPORTS_PROBE_LIBRARY');
  const importLibrary = join(BUILD, `${name}d.lib`);

  if (imports) {
    await rm(importLibrary, { force: true });
    await run(
      'wlib',
      ['-q', '-n', importLibrary, `+${join(BUILD, `${name.toUpperCase()}D.DLL`)}`],
      BUILD
    );
  }

  await run(
    'wlink',
    [
      'system',
      'windows',
      'option',
      'quiet',
      'name',
      executable,
      'file',
      object,
      ...(imports ? ['library', importLibrary] : []),
    ],
    BUILD
  );
  await rm(object, { force: true });
  await rm(importLibrary, { force: true });

  return executable;
}

/** Compiles and links one probe. */
async function build(name) {
  const source = join(PROBES, `${name}.c`);
  const object = join(BUILD, `${name}.o`);
  const executable = join(BUILD, `${name.toUpperCase()}.EXE`);

  /* -bt=windows targets Win16, -ml is the large memory model so that far
   * pointers are the default, and -zW generates the windowed prologue that
   * every exported entry point needs.
   */
  await run('wcc', ['-bt=windows', '-ml', '-zW', '-q', '-w4', `-fo=${object}`, source], BUILD);

  /* `system windows` brings the library paths and the NE output format with
   * it, so there is nothing to spell out here.
   *
   * `TOOLHELP` is not among the libraries it brings, and one probe needs it:
   * the heap census walks the global heap and reads other modules' blocks, and
   * those four entry points live nowhere else. Naming the library for every
   * probe would add an import to programs that make no use of it, so it is
   * added only for the source that mentions it. `SHELL` likewise.
   */
  const text = await readFile(source, 'latin1');
  const extra = [
    ...(text.includes('<toolhelp.h>') ? ['library', 'toolhelp'] : []),
    /* And `SHELL`, for the registration database's calls. */
    ...(text.includes('<shellapi.h>') ? ['library', 'shell'] : []),
    /* And `MMSYSTEM`, for the multimedia devices. */
    ...(text.includes('<mmsystem.h>') ? ['library', 'mmsystem'] : []),
  ];

  await run(
    'wlink',
    ['system', 'windows', 'option', 'quiet', 'name', executable, 'file', object, ...extra],
    BUILD
  );

  await rm(object, { force: true });

  if (await stat(join(PROBES, `${name}.dll.c`)).catch(() => null)) {
    await buildLibrary(name);
  }

  if (await stat(join(PROBES, `${name}.child.c`)).catch(() => null)) {
    await buildChild(name);
  }

  /* A probe that measures resources brings its own, in a script of the same
   * name, bound into the program once it is linked. `-s0` keeps the linker's
   * order of the segments. */
  const script = join(PROBES, `${name}.rc`);

  if (await stat(script).catch(() => null)) {
    const compiled = join(BUILD, `${name}.res`);

    await run('wrc', ['-q', '-r', '-bt=windows', script, `-fo=${compiled}`], BUILD);
    await run('wrc', ['-q', '-bt=windows', '-s0', compiled, executable], BUILD);
    await rm(compiled, { force: true });
  }

  return { name, executable, ...(await describe(executable)) };
}

async function main() {
  const wanted = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));

  if (!(await stat(join(TOOLS, 'wcc')).catch(() => null))) {
    throw new Error('no toolchain; run scripts/oracle/fetch-toolchain.mjs first');
  }

  const sources = (await readdir(PROBES))
    .filter(
      (entry) => entry.endsWith('.c') && !entry.endsWith('.dll.c') && !entry.endsWith('.child.c')
    )
    .map((entry) => entry.slice(0, -2))
    .filter((name) => wanted.length === 0 || wanted.includes(name))
    .sort();

  if (sources.length === 0) {
    throw new Error(
      wanted.length ? `no probe named ${wanted.join(', ')}` : `no probes in ${PROBES}`
    );
  }

  await mkdir(BUILD, { recursive: true });

  const built = [];

  for (const name of sources) {
    built.push(await build(name));
    log(`  ${name}`);
  }

  log(`\n${built.length} probes in ${BUILD}`);

  for (const probe of built) {
    log(
      `  ${basename(probe.executable).padEnd(14)}${String(probe.bytes).padStart(7)} bytes` +
        `   imports ${probe.modules.join(', ')}`
    );
  }

  log('\nNext: node scripts/oracle/record.mjs');
}

main().catch((error) => {
  console.error(`build-probes: ${error.message}`);
  process.exitCode = 1;
});
