#!/bin/sh
# Regenerates tests/vectors from DOSBox 0.74-3's own OPL code.
#
#   regenerate.sh DOSBOX_SOURCE [BUILD_DIR]
#
# DOSBOX_SOURCE is an unpacked dosbox-0.74-3 source tree (the release
# tarball, or `apt-get source dosbox`; Debian and Ubuntu's patches leave the
# OPL code alone). Nothing from it is copied into this repository: the
# harness is built in BUILD_DIR (a fresh temporary directory by default),
# from src/hardware/dbopl.cpp and the Adlib module's port and timer code in
# src/hardware/adlib.cpp, with the stub headers here standing in for the
# rest of DOSBox.
#
# Writes the scripts (make_scripts.py), runs each through the harness, and
# records its number of values and their FNV-1a hash in
# tests/vectors/expected.txt. Also checks that the constants in
# src/dbopl_tables.rs are what gen_tables.cpp prints.
set -eu
SRC=$(cd "$1/src/hardware" && pwd)
BUILD=${2:-$(mktemp -d)}
HERE=$(cd "$(dirname "$0")" && pwd)
CRATE=$(dirname "$HERE")
VECTORS="$CRATE/tests/vectors"

sed -n '/^bool Chip::Write/,/^}; \/\/namespace/p' "$SRC/adlib.cpp" | sed '$d' > "$BUILD/glue.inc"
# -O2 as Ubuntu builds DOSBox; -O0, -O3 and -fwrapv give the same output.
g++ -O2 -w -I"$HERE/stub" -I"$BUILD" -I"$SRC" -o "$BUILD/harness" "$HERE/harness.cpp" "$SRC/dbopl.cpp" -lm
g++ -O2 -o "$BUILD/gen_tables" "$HERE/gen_tables.cpp" -lm

"$BUILD/gen_tables" > "$BUILD/tables.rs"
if ! tail -n "$(wc -l < "$BUILD/tables.rs")" "$CRATE/src/dbopl_tables.rs" | cmp -s - "$BUILD/tables.rs"; then
  echo "src/dbopl_tables.rs differs from gen_tables.cpp's output ($BUILD/tables.rs)" >&2
  exit 1
fi

rm -f "$VECTORS"/*.txt
python3 "$HERE/make_scripts.py" "$VECTORS"
{
  echo "# name, number of values, FNV-1a 64 of the values as little-endian i32,"
  echo "# from DOSBox 0.74-3's dbopl.cpp and adlib.cpp via dosbox-harness/regenerate.sh"
  for script in "$VECTORS"/*.txt; do
    name=$(basename "$script" .txt)
    "$BUILD/harness" < "$script" > "$BUILD/$name.bin"
    python3 - "$name" "$BUILD/$name.bin" <<'EOF'
import struct, sys
data = open(sys.argv[2], 'rb').read()
h = 0xcbf29ce484222325
for b in data:
    h ^= b
    h = (h * 0x100000001b3) & 0xffffffffffffffff
print(f'{sys.argv[1]} {len(data) // 4} {h:016x}')
EOF
  done
} > "$BUILD/expected.txt"
mv "$BUILD/expected.txt" "$VECTORS/expected.txt"
echo "wrote $VECTORS (DOSBox's outputs are in $BUILD)"
