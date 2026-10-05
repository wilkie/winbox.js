#!/usr/bin/env node
/**
 * Builds DOSBox 0.74-3 as the oracle runs it, with one addition: every
 * access to the OPL's ports written to the file `DOSBOX_OPL_TRACE` names,
 * as `<milliseconds> <w|r> <port> <byte>`, the time `PIC_FullIndex()`.
 *
 * DOSBox's own capture, the `.dro` file, is the reference; it leaves out a
 * write of a register's value again, the timers, the status reads and
 * everything before the first note (`dro.mjs`). The trace keeps them all,
 * and run through the same filter it gives the `.dro` a stock DOSBox wrote
 * write for write and millisecond for millisecond (`kb/topics/adlib.md`).
 *
 *   node scripts/oracle/build-dosbox-trace.mjs
 *   node scripts/oracle/record.mjs adlibout --display vgasound --capture \
 *     --dosbox oracle/.cache/dosbox-trace/dosbox-0.74-3/src/dosbox
 *
 * DOSBox's source and the SDL 1.2 headers it builds against (sdl12-compat,
 * the SDL 1.2 the host's DOSBox runs on) are fetched into
 * `oracle/.cache/dosbox-trace`, never the repository. Needs a C++ compiler,
 * make, and the host's libSDL-1.2.so.0.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache', 'dosbox-trace');
const DOSBOX =
  'https://sourceforge.net/projects/dosbox/files/dosbox/0.74-3/dosbox-0.74-3.tar.gz/download';
const SDL = 'https://github.com/libsdl-org/sdl12-compat/archive/refs/tags/release-1.2.68.tar.gz';
const LIBSDL = '/lib/x86_64-linux-gnu/libSDL-1.2.so.0';

const sh = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', cwd: CACHE, ...options });

mkdirSync(CACHE, { recursive: true });

if (!existsSync(join(CACHE, 'dosbox-0.74-3'))) {
  sh('curl', ['-sSL', '-o', 'dosbox.tar.gz', DOSBOX]);
  sh('tar', ['xzf', 'dosbox.tar.gz']);
}

if (!existsSync(join(CACHE, 'sdl12-compat-release-1.2.68'))) {
  sh('curl', ['-sSL', '-o', 'sdl12-compat.tar.gz', SDL]);
  sh('tar', ['xzf', 'sdl12-compat.tar.gz']);
}

/* The trace, in `adlib.cpp`'s port handlers: the only change. */
const adlib = join(CACHE, 'dosbox-0.74-3', 'src', 'hardware', 'adlib.cpp');
const source = readFileSync(adlib, 'latin1');
const handlers = `static Bitu OPL_Read(Bitu port,Bitu iolen) {
	return module->PortRead( port, iolen );
}

void OPL_Write(Bitu port,Bitu val,Bitu iolen) {
	module->PortWrite( port, val, iolen );
}`;
const traced = `/* Trace of every port access, for the oracle (not part of DOSBox). */
static FILE * opl_trace = 0;
static bool opl_trace_checked = false;
static void OPL_Trace(char kind, Bitu port, Bitu val) {
	if (!opl_trace_checked) {
		opl_trace_checked = true;
		const char * path = getenv("DOSBOX_OPL_TRACE");
		if (path) opl_trace = fopen(path, "w");
	}
	if (opl_trace) {
		fprintf(opl_trace, "%.6f %c %03x %02x\\n", PIC_FullIndex(), kind, (unsigned)port, (unsigned)val);
		fflush(opl_trace);
	}
}

static Bitu OPL_Read(Bitu port,Bitu iolen) {
	Bitu val = module->PortRead( port, iolen );
	OPL_Trace('r', port, val);
	return val;
}

void OPL_Write(Bitu port,Bitu val,Bitu iolen) {
	OPL_Trace('w', port, val);
	module->PortWrite( port, val, iolen );
}`;

if (!source.includes('OPL_Trace')) {
  if (!source.includes(handlers)) {
    throw new Error(`${adlib} is not DOSBox 0.74-3's`);
  }

  writeFileSync(adlib, source.replace(handlers, traced), 'latin1');
}

/* An sdl-config for the headers, linking the host's library. */
const bin = join(CACHE, 'bin');
const lib = join(CACHE, 'lib');

mkdirSync(bin, { recursive: true });
mkdirSync(lib, { recursive: true });

if (!existsSync(join(lib, 'libSDL.so'))) {
  symlinkSync(LIBSDL, join(lib, 'libSDL.so'));
}

writeFileSync(
  join(bin, 'sdl-config'),
  [
    '#!/bin/sh',
    'for a in "$@"; do',
    '  case "$a" in',
    '    --version) echo 1.2.15 ;;',
    `    --cflags) echo "-I${join(CACHE, 'sdl12-compat-release-1.2.68', 'include', 'SDL')} -D_GNU_SOURCE=1 -D_REENTRANT" ;;`,
    `    --libs) echo "-L${lib} -lSDL" ;;`,
    '    --prefix|--exec-prefix) echo /usr ;;',
    '  esac',
    'done',
    '',
  ].join('\n')
);
chmodSync(join(bin, 'sdl-config'), 0o755);

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
const tree = join(CACHE, 'dosbox-0.74-3');

sh('./configure', ['--disable-opengl', 'CXXFLAGS=-O2 -fpermissive -w'], { cwd: tree, env });
sh('make', ['-j8'], { cwd: tree, env });

console.log(`\n${join(tree, 'src', 'dosbox')}`);
