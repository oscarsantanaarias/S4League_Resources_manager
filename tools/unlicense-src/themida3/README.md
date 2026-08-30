# themida3_repair

Turns a raw unlicense **Themida 3.x** dump into a clean, booting exe, using a
known-good unpacked build of the **same version** as a reference.

unlicense's 3.x path (winlicense3) produces a dump that does not run: it picks
the wrong entry point and leaves Themida's stolen code in place. Unlike the 2.x
path, it has no automatic stolen-code recovery. This tool ports the two fixes
from a reference the user already has, and optionally strips the leftover packer
sections so the result is as clean as a proper unpack (smaller file, far fewer
AV heuristics).

## Usage

```
py -3.11-32 themida3_repair.py <raw_dump.exe> <good_reference.exe> <output.exe> [--clean]
```

- `raw_dump.exe` — what unlicense produced (`unpacked_*.exe`).
- `good_reference.exe` — a working unpacked build of the **same version**. The
  tool refuses to run if the PE TimeDateStamp does not match.
- `--clean` — also strip the leftover `.themida` / `.boot` sections and repack.

Requires the same environment as unlicense (32-bit Python 3.11). No extra
packages: it only uses the standard library.

## What it does

1. **Entry point.** Copies the EP from the reference. unlicense often points it
   at a CRT subroutine instead of `mainCRTStartup`, which skips CRT init, so the
   process TLS is never set up and the client crashes in an imported DLL that
   reads `fs:[0x2C]`.

2. **Stolen code.** In each executable section, copies the bytes that differ
   from the reference. Themida replaces a handful of instructions with jumps to
   its runtime stubs; the reference has the originals. The section that holds the
   import table (Scylla's `.SCY`) is skipped — its layout is per-dump and copying
   it across corrupts the imports. Non-executable sections are left alone so the
   rebuilt IAT and per-session data are untouched.

3. **Clean rebuild** (`--clean`). Sections the reference stripped to zero raw
   data (the packer's `.themida` and `.boot`, ~12 MB) are emptied here too, the
   sections are renamed to match the reference, and the file is repacked so the
   stripped bytes are gone. Then the PE is re-emitted through **LIEF**, the same
   way unlicense rebuilds its own 2.x dumps: this normalizes the headers and
   removes the hand-patch artifacts that AV heuristics flag as "Patched",
   bringing a 3.x result down toward what a fully-automated 2.x dump scores.
   Needs LIEF (already an unlicense dependency); skipped if absent.

## Verified

Ragexe (Ragnarok Online, Themida 3.x, TimeDateStamp `0x698BD9AB`): the repaired
`--clean` output is 16 MB (down from 28), structurally identical to the working
reference, and boots to the game window.

## Notes / limitations

- Needs a working reference of the exact same build. Full automation (no
  reference, like the 2.x path) would require porting the write-watching spy
  into winlicense3.
- The anticheat is separate: RO's `BaseSDK.dll` / `IAPSDK.dll` crash in a dump.
  The working client replaces them with tiny stub DLLs (83 KB vs 3.2 MB) that
  export the same functions but do nothing. Copy those stubs next to the exe.
