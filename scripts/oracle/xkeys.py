#!/usr/bin/env python3
"""
Presses keys on an X display, through the XTest extension: for driving
DOSBox, running on a virtual display, past a box that lets no program of
Windows' own run. See `runShooting` in record.mjs.

    xkeys.py :93 Return
    xkeys.py :93 Alt_L+F4 Tab space

Each argument is a key, or keys held together joined by `+`, by X keysym
name. The pointer is first put over the display's top left, where DOSBox's
window is, so that the keys go to it.
"""

import ctypes
import sys
import time

x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
xtst = ctypes.cdll.LoadLibrary('libXtst.so.6')

x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                      ctypes.c_ulong]


def main():
    display = x11.XOpenDisplay(sys.argv[1].encode())

    if not display:
        sys.exit(f'cannot open display {sys.argv[1]}')

    xtst.XTestFakeMotionEvent(display, -1, 4, 4, 0)
    x11.XFlush(display)
    time.sleep(0.2)

    for chord in sys.argv[2:]:
        codes = []

        for name in chord.split('+'):
            keysym = x11.XStringToKeysym(name.encode())

            if not keysym:
                sys.exit(f'no key {name}')

            codes.append(x11.XKeysymToKeycode(display, keysym))

        for code in codes:
            xtst.XTestFakeKeyEvent(display, code, 1, 0)
            x11.XFlush(display)
            time.sleep(0.05)

        for code in reversed(codes):
            xtst.XTestFakeKeyEvent(display, code, 0, 0)
            x11.XFlush(display)
            time.sleep(0.05)

        time.sleep(0.3)

    x11.XCloseDisplay(display)


main()
