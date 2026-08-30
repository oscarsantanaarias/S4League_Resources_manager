# Patched unlicense — source backup

ItemManager's "Unpack Client" button unpacks Themida-protected `.exe` files with
**unlicense**. It runs a bundled 32-bit Python 3.11 in `tools/unlicense/python/`
(git-ignored, ~98 MB). This folder is a backup of **only the files we patched**,
so the work isn't lost if the package is reinstalled.

To reapply: copy these files over
`.../python/Lib/site-packages/unlicense/`, keeping the same structure.

## Requirements

Unpacking needs **32-bit Python 3.11** (the game clients are 32-bit; a 64-bit
interpreter cannot walk their memory). Exact versions used:

| package    | version   | why |
|------------|-----------|-----|
| Python     | 3.11.9 x86 | 32-bit interpreter, required |
| unlicense  | 0.4.0     | the unpacker itself (patched here) |
| frida      | 16.7.19   | injects into the packed process, runs the agent |
| capstone   | 4.0.2     | x86 disassembler |
| unicorn    | 1.0.3     | CPU emulator (resolves virtualized imports) |
| lief       | 0.13.2    | reads/rebuilds the PE |
| pyscylla   | 0.11.2    | rebuilds the import table |
| xxhash     | 2.0.2     | export hashing |
| fire       | 0.4.0     | CLI parsing |

Install from a clean 32-bit Python:

```
py -3.11-32 -m pip install unlicense
```

Then apply the patches from this folder on top.

## How to unpack

```
py -3.11-32 -m unlicense --target_version 2 --timeout 180 packed.exe
```

unlicense auto-detects the Themida version (2.x or 3.x). Output is
`unpacked_packed.exe` next to the input.

Gotchas that make a good dump look broken:
- Another instance of the client running → single-instance check makes any dump
  exit 0 instantly. Close all clients first.
- The client's own DLLs (d3dx9, msvcp, etc.) must be in the same folder or the
  packed process stalls before the OEP.
- BattlEye/anticheat closes a modified exe silently. Neutralize it (e.g. an ASI
  stub, or replacing the anticheat DLL with a stub) before judging the dump.

## What each file does

- **winlicense2.py** — Themida 2.x path. Two rules that make the dump boot on
  its own, no reference build needed:
  1. `_restore_stolen_prologues` — restores the code Themida steals, by watching
     what the packer rewrites (NtProtect / NtWrite hooks).
  2. `_neutralize_broken_initializers` — repoints CRT initializers whose body
     Themida moved outside `.text`.
- **resources/frida.js** — the agent that watches the packer's writes.
- **frida_exec.py** — RPC bridge to read those writes from Python.
- **stolen_prologues.json** — optional per-build table (empty by default).
- **tools/** — `derive_reloc.py`, `rebase.py`, `gen_prologues.py`: helpers to
  derive relocations, rebase a dump, and build the table.

## Status

- **Themida 2.x** (S4): fully automatic, no reference build. Verified across
  several builds; VirusTotal 0/67 on the result.
- **Themida 3.x** (Ragexe/RO): works with a known-good reference dump of the same
  version (fixes the OEP + restores stolen code in executable sections). Full
  automation is still pending.
