#!/usr/bin/env python3
"""Writes the test scripts in tests/vectors: register-write sequences,
structured and random, interleaved with Generate calls of varying lengths,
for dosbox-harness/harness.cpp (DOSBox's dbopl.cpp) and tests/dosbox.rs
(the port) to run alike. Deterministic: the same scripts every time."""

import os
import random
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), '..', 'tests', 'vectors')

# The first (modulator) operator slot of each OPL2 channel; the carrier is
# 3 slots on.
MOD = [0, 1, 2, 8, 9, 10, 16, 17, 18]


class Script:
    def __init__(self, rate=44100):
        self.lines = [f'r {rate}']

    def w(self, reg, val):
        self.lines.append(f'w {reg:x} {val & 0xff:x}')

    def g(self, n):
        self.lines.append(f'g {n}')

    def gen(self, total, rng=None, most=512):
        """Generate `total` samples in pieces, random when `rng` is given."""
        while total > 0:
            n = min(total, rng.randint(1, most) if rng else most)
            self.g(n)
            total -= n

    def op(self, ch, which, base, val, bank=0):
        self.w(bank + base + MOD[ch] + 3 * which, val)

    def voice(self, ch, mod, car, c0, bank=0):
        """mod and car are (20h, 40h, 60h, 80h, E0h) values."""
        for which, regs in ((0, mod), (1, car)):
            for base, val in zip((0x20, 0x40, 0x60, 0x80, 0xe0), regs):
                self.op(ch, which, base, val, bank)
        self.w(bank + 0xc0 + ch, c0)

    def key(self, ch, fnum, block, on=True, bank=0):
        self.w(bank + 0xa0 + ch, fnum & 0xff)
        self.w(bank + 0xb0 + ch, (0x20 if on else 0) | (block << 2) | (fnum >> 8))

    def save(self, name):
        with open(os.path.join(OUT, name + '.txt'), 'w') as f:
            f.write('\n'.join(self.lines) + '\n')


PIANO = ((0x01, 0x10, 0xf2, 0x74, 0), (0x01, 0x00, 0xf2, 0x74, 0))
ORGAN = ((0x21, 0x1a, 0xf0, 0x0f, 0), (0x21, 0x00, 0xf0, 0x0f, 0))


def tables():
    s = Script(44100)
    for rate in (8000, 11025, 16000, 22050, 32000, 44100, 48000, 49716, 12345, 96000):
        s.lines.append(f'r {rate}')
        s.lines.append('t')
    s.save('tables')


def addresses():
    s = Script(44100)
    for port in (0x388, 0x389, 0x38a, 0x38b, 0x220, 0x222, 0x228):
        for val in (0x00, 0x05, 0x20, 0xbd, 0xff):
            s.lines.append(f'a {port:x} {val:x}')
    s.w(0x105, 1)
    for port in (0x388, 0x38a, 0x222):
        for val in (0x00, 0x05, 0x20, 0xbd):
            s.lines.append(f'a {port:x} {val:x}')
    s.save('addresses')


def waveforms():
    for rate in (44100, 49716, 22050):
        s = Script(rate)
        rng = random.Random(rate)
        for wse in (0x00, 0x20):
            s.w(0x01, wse)
            for wave in range(4):
                mod = (0x01, 0x3f, 0xf0, 0x0f, wave)
                car = (0x01, 0x00, 0xf0, 0x0f, wave)
                s.voice(0, mod, car, 0x01)
                s.key(0, 0x241, 4)
                s.gen(2000, rng)
                s.voice(0, (0x01, 0x10, 0xf0, 0x0f, wave), car, 0x00)
                s.gen(1500, rng)
                s.key(0, 0x241, 4, on=False)
                s.gen(800, rng)
            # A waveform-select change without a new E0h value.
            s.w(0x01, wse ^ 0x20)
            s.key(0, 0x2ae, 3)
            s.gen(1000, rng)
            s.key(0, 0x2ae, 3, on=False)
            s.gen(500, rng)
        s.save(f'waveforms_{rate}')


def feedback():
    s = Script(44100)
    rng = random.Random(7)
    for fb in range(8):
        for conn in (0, 1):
            s.voice(3, (0x02, 0x08, 0xd4, 0x26, 0), (0x01, 0x04, 0xc3, 0x25, 0), (fb << 1) | conn)
            s.key(3, 0x16b + fb * 40, 3 + conn)
            s.gen(1800, rng)
            s.key(3, 0x16b + fb * 40, 3 + conn, on=False)
            s.gen(600, rng)
    s.save('feedback')


def tremolo_vibrato():
    s = Script(44100)
    rng = random.Random(11)
    for depth in (0x00, 0x40, 0x80, 0xc0):
        s.w(0xbd, depth)
        s.voice(1, (0xc1, 0x12, 0xf1, 0x05, 0), (0xc1, 0x00, 0xf1, 0x05, 0), 0x00)
        s.voice(2, (0x81, 0x3f, 0xf1, 0x05, 0), (0x81, 0x00, 0xf1, 0x05, 0), 0x01)
        s.voice(4, (0x41, 0x3f, 0xf1, 0x05, 0), (0x41, 0x00, 0xf1, 0x05, 0), 0x01)
        s.key(1, 0x3ff, 4)
        s.key(2, 0x200, 5)
        s.key(4, 0x380, 2)
        s.gen(20000, rng)
        s.key(1, 0x3ff, 4, on=False)
        s.key(2, 0x200, 5, on=False)
        s.key(4, 0x380, 2, on=False)
        s.gen(3000, rng)
    s.save('tremolo_vibrato')


def rhythm():
    for rate in (44100, 49716):
        s = Script(rate)
        rng = random.Random(rate + 1)
        # Bass drum on channel 6, hi-hat and snare on 7, tom-tom and cymbal
        # on 8.
        s.voice(6, (0x00, 0x0b, 0xa8, 0x4c, 0), (0x00, 0x00, 0xd6, 0x4f, 0), 0x00)
        s.voice(7, (0x0c, 0x00, 0xd7, 0xf7, 0), (0x12, 0x00, 0xe8, 0x67, 0), 0x00)
        s.voice(8, (0x05, 0x00, 0xf8, 0xb5, 0), (0x01, 0x03, 0xd6, 0x86, 0), 0x00)
        s.key(6, 0x2ae, 1, on=False)
        s.key(7, 0x157, 2, on=False)
        s.key(8, 0x1c8, 2, on=False)
        for bits in (0x10, 0x08, 0x04, 0x02, 0x01, 0x1f, 0x15, 0x0a):
            s.w(0xbd, 0x20 | bits)
            s.gen(3000, rng)
            s.w(0xbd, 0x20)
            s.gen(1500, rng)
        # The bass drum in AM mode, waveforms on the drums, depths on.
        s.w(0x01, 0x20)
        s.w(0xc6, 0x01)
        for slot, wave in ((0x31, 1), (0x34, 2), (0x32, 3), (0x35, 1)):
            s.w(0xe0 + slot, wave)
        s.w(0xbd, 0xff)
        s.gen(4000, rng)
        # Rhythm off, then melodic notes on the same channels.
        s.w(0xbd, 0x00)
        s.gen(1000, rng)
        s.key(6, 0x2ae, 4)
        s.key(7, 0x157, 4)
        s.gen(2000, rng)
        s.w(0xbd, 0x3f)
        s.gen(2000, rng)
        s.save(f'rhythm_{rate}')


def ksl_ksr():
    s = Script(44100)
    rng = random.Random(13)
    for ksl in range(4):
        for ksr in (0, 0x10):
            s.voice(5, (0x01 | ksr, 0x20, 0x86, 0x45, 0), (0x01 | ksr, (ksl << 6) | 0x04, 0x76, 0x45, 0), 0x02)
            for block in (0, 3, 7):
                for fnum in (0x080, 0x2ff, 0x3ff):
                    s.key(5, fnum, block)
                    s.gen(700, rng)
                    s.key(5, fnum, block, on=False)
                    s.gen(300, rng)
    s.save('ksl_ksr')


def envelopes():
    s = Script(44100)
    rng = random.Random(17)
    for egt in (0x00, 0x20):
        for ar, dr in ((15, 0), (0, 5), (1, 1), (7, 3), (12, 12), (14, 15)):
            for sl, rr in ((0, 0), (5, 3), (15, 15), (10, 8)):
                car = (0x01 | egt, 0x00, (ar << 4) | dr, (sl << 4) | rr, 0)
                s.voice(0, (0x01 | egt, 0x3f, 0xff, 0x0f, 0), car, 0x00)
                s.key(0, 0x200, 4)
                s.gen(rng.randint(200, 2500), rng)
                s.key(0, 0x200, 4, on=False)
                s.gen(rng.randint(200, 2500), rng)
                # Key on again during the release.
                s.key(0, 0x200, 4)
                s.gen(300, rng)
                s.key(0, 0x200, 4, on=False)
                s.gen(300, rng)
    s.save('envelopes')


def sweeps():
    s = Script(44100)
    rng = random.Random(19)
    s.voice(0, ORGAN[0], ORGAN[1], 0x00)
    s.voice(8, PIANO[0], PIANO[1], 0x0e)
    s.key(0, 0x100, 0)
    s.key(8, 0x100, 6)
    for step in range(256):
        fnum = (step * 4) & 0x3ff
        block = (step // 32) & 7
        s.w(0xa0, fnum & 0xff)
        s.w(0xb0, 0x20 | (block << 2) | (fnum >> 8))
        s.w(0xa8, (fnum * 3) & 0xff)
        s.w(0xb8, 0x20 | ((7 - block) << 2) | ((fnum * 3) >> 8 & 3))
        s.gen(rng.randint(1, 120), rng)
    # Note select.
    for nts in (0x00, 0x40):
        s.w(0x08, nts)
        for fnum in (0x0ff, 0x100, 0x1ff, 0x200, 0x2ff, 0x300):
            s.w(0x20, 0x11)
            s.w(0xa0, fnum & 0xff)
            s.w(0xb0, 0x20 | (3 << 2) | (fnum >> 8))
            s.gen(400, rng)
    s.save('sweeps')


def opl3():
    s = Script(44100)
    rng = random.Random(23)
    s.w(0x105, 1)
    s.w(0x01, 0x20)
    # Two-operator stereo voices with panning, all 8 waveforms.
    for ch, pan in ((0, 0x10), (1, 0x20), (2, 0x30), (3, 0x00)):
        for bank in (0, 0x100):
            wave = (ch * 2 + (bank >> 8)) & 7
            s.voice(ch, (0x01, 0x18, 0xf3, 0x34, wave), (0x01, 0x00, 0xf3, 0x34, wave), pan | 0x04 | (ch & 1), bank)
            s.key(ch, 0x200 + ch * 0x30, 4, bank=bank)
    s.gen(4000, rng)
    # Four-operator voices on channels 0+3 and 1+4 of both banks.
    s.w(0x104, 0x1b)
    for conn in range(4):
        s.w(0xc0, 0x30 | (conn & 1))
        s.w(0xc3, 0x30 | (conn >> 1))
        s.w(0x1c1, 0x30 | (conn & 1))
        s.w(0x1c4, 0x30 | (conn >> 1))
        s.gen(2500, rng)
    for ch in range(6):
        s.key(ch, 0x200, 4, on=False)
        s.key(ch, 0x200, 4, on=False, bank=0x100)
    s.gen(2000, rng)
    # Rhythm in OPL3 mode.
    s.voice(6, (0x00, 0x0b, 0xa8, 0x4c, 5), (0x00, 0x00, 0xd6, 0x4f, 6), 0x30)
    s.voice(7, (0x0c, 0x00, 0xd7, 0xf7, 7), (0x12, 0x00, 0xe8, 0x67, 4), 0x30)
    s.voice(8, (0x05, 0x00, 0xf8, 0xb5, 0), (0x01, 0x03, 0xd6, 0x86, 1), 0x30)
    s.w(0xbd, 0x3f)
    s.gen(3000, rng)
    s.w(0xbd, 0x20)
    s.gen(1000, rng)
    # Writes to the silent half of a four-operator pair, then OPL3 off.
    s.w(0xa3, 0x55)
    s.w(0xb3, 0x31)
    s.w(0x104, 0x00)
    s.w(0x105, 0x00)
    s.key(0, 0x1a0, 5)
    s.gen(2000, rng)
    s.save('opl3')


def mode_switches():
    s = Script(44100)
    rng = random.Random(29)
    s.voice(6, (0x00, 0x0b, 0xa8, 0x4c, 0), (0x00, 0x00, 0xd6, 0x4f, 0), 0x00)
    s.voice(7, (0x0c, 0x00, 0xd7, 0xf7, 0), (0x12, 0x00, 0xe8, 0x67, 0), 0x00)
    s.voice(8, (0x05, 0x00, 0xf8, 0xb5, 0), (0x01, 0x03, 0xd6, 0x86, 0), 0x00)
    s.voice(0, PIANO[0], PIANO[1], 0x00)
    s.key(0, 0x2ae, 4)
    # Rhythm on in OPL2, then OPL3 on: channel 6 keeps its mono handler.
    s.w(0xbd, 0x3f)
    s.gen(1500, rng)
    s.w(0x105, 1)
    s.gen(1500, rng)
    s.w(0xbd, 0x3f ^ 0x10)
    s.gen(800, rng)
    # A four-operator key-on, then back to two operators without a key-off.
    s.w(0x104, 0x01)
    s.voice(3, ORGAN[0], ORGAN[1], 0x31)
    s.w(0xc0, 0x30)
    s.key(0, 0x1ae, 4)
    s.gen(1500, rng)
    s.w(0x104, 0x00)
    s.gen(1500, rng)
    s.key(0, 0x1ae, 4, on=False)
    s.gen(500, rng)
    # Rhythm on in OPL3, then OPL3 off.
    s.w(0xbd, 0x00)
    s.w(0xbd, 0x3f)
    s.gen(1000, rng)
    s.w(0x105, 0)
    s.gen(1500, rng)
    s.w(0xbd, 0x00)
    s.gen(500, rng)
    s.save('mode_switches')


def random_opl3(seed, rate, writes):
    rng = random.Random(seed)
    s = Script(rate)
    s.w(0x105, 1)
    s.w(0x01, 0x20)
    for _ in range(writes):
        kind = rng.random()
        bank = 0x100 if rng.random() < 0.5 else 0
        if kind < 0.25:
            s.key(rng.randrange(9), rng.randrange(0x400), rng.randrange(8), on=rng.random() < 0.6, bank=bank)
        elif kind < 0.3:
            s.w(0xbd, rng.randrange(256))
        elif kind < 0.33:
            s.w(0x104, rng.randrange(64))
        elif kind < 0.34:
            s.w(0x105, rng.randrange(2) if rng.random() < 0.3 else 1)
        else:
            base = rng.choice((0x20, 0x40, 0x60, 0x80, 0xe0, 0xc0))
            if base == 0xc0:
                s.w(bank + 0xc0 + rng.randrange(9), rng.randrange(256))
            elif base == 0x40:
                s.w(bank + 0x40 + rng.randrange(0x16), rng.randrange(0x40) | (rng.randrange(4) << 6))
            else:
                s.w(bank + base + rng.randrange(0x16), rng.randrange(256))
        if rng.random() < 0.3:
            s.g(rng.randint(1, 600))
    s.gen(3000, rng)
    return s


def random_chip(seed, rate, writes, musical):
    rng = random.Random(seed)
    s = Script(rate)
    for _ in range(writes):
        if musical:
            kind = rng.random()
            if kind < 0.25:
                ch = rng.randrange(9)
                s.key(ch, rng.randrange(0x400), rng.randrange(8), on=rng.random() < 0.6)
            elif kind < 0.35:
                s.w(0xbd, rng.randrange(256))
            elif kind < 0.4:
                s.w(rng.choice((0x01, 0x08)), rng.randrange(256))
            else:
                base = rng.choice((0x20, 0x40, 0x60, 0x80, 0xe0, 0xc0))
                if base == 0xc0:
                    s.w(0xc0 + rng.randrange(9), rng.randrange(256))
                elif base == 0x40:
                    s.w(0x40 + rng.randrange(0x16), rng.randrange(0x40) | (rng.randrange(4) << 6))
                else:
                    s.w(base + rng.randrange(0x16), rng.randrange(256))
        else:
            s.w(rng.randrange(0x200 if rng.random() < 0.3 else 0x100), rng.randrange(256))
        if rng.random() < 0.3:
            s.g(rng.choice((1, 2, 3, 17, 64, 100, 255, 256, 511, 512, 513, 700)) if rng.random() < 0.3
                else rng.randint(1, 600))
    s.gen(3000, rng)
    return s


def module_scripts():
    # The detection sequence drivers use, at 388h and at 228h, then
    # programs' writes and status polls.
    for mode in (0, 1, 2):
        rng = random.Random(100 + mode)
        lines = [f'm {mode} 44100']
        t = 0.0

        def p(port, val):
            lines.append(f'p {port:x} {val:x} {t!r}')

        def q(port):
            lines.append(f'q {port:x} {t!r}')

        for base in (0x388, 0x228, 0x220, 0x222):
            p(base, 4); p(base + 1, 0x60)
            p(base, 4); p(base + 1, 0x80)
            q(base)
            p(base, 2); p(base + 1, 0xff)
            p(base, 4); p(base + 1, 0x21)
            for _ in range(6):
                t += 0.03125
                q(base)
            p(base, 3); p(base + 1, 0xfe)
            p(base, 4); p(base + 1, 0x42)
            for _ in range(6):
                t += 0.25
                q(base)
            p(base, 4); p(base + 1, 0x60)
            p(base, 4); p(base + 1, 0x80)
            q(base)
            for port in (base + 1, base + 2, base + 3):
                q(port)
            t += 1.0
        for _ in range(500):
            t += rng.choice((0.0, 0.0078125, 0.125, 1.0, 3.5))
            port = rng.choice((0x388, 0x389, 0x38a, 0x38b, 0x220, 0x221, 0x222, 0x223, 0x228, 0x229))
            kind = rng.random()
            if kind < 0.1:
                q(port)
            elif kind < 0.2:
                lines.append(f'mg {rng.randint(1, 512)}')
            elif port & 1 == 0:
                p(port, rng.choice((2, 3, 4, 5, 0xbd, 0x01, 0x104, 0x105) if rng.random() < 0.3 else range(256)) & 0xff)
            else:
                p(port, rng.randrange(256))
        lines.append('mg 512')
        with open(os.path.join(OUT, f'module_{mode}.txt'), 'w') as f:
            f.write('\n'.join(lines) + '\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    tables()
    addresses()
    waveforms()
    feedback()
    tremolo_vibrato()
    rhythm()
    ksl_ksr()
    envelopes()
    sweeps()
    opl3()
    mode_switches()
    for i, rate in enumerate((44100, 49716, 22050)):
        random_opl3(3000 + i, rate, 400).save(f'random_opl3_{i}')
    for i, rate in enumerate((44100, 44100, 44100, 49716, 22050, 8000, 48000, 11025)):
        random_chip(1000 + i, rate, 400, musical=True).save(f'random_musical_{i}')
    for i, rate in enumerate((44100, 44100, 49716, 32000)):
        random_chip(2000 + i, rate, 400, musical=False).save(f'random_any_{i}')
    module_scripts()


main()
