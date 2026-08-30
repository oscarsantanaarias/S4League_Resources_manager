"""
themida3_repair.py -- turn a raw unlicense (Themida 3.x) dump into a booting exe.

unlicense's 3.x path produces a dump that does not run: it picks the wrong entry
point and leaves Themida's stolen code in place. Both are recoverable from a
known-good unpacked build of the SAME version (same TimeDateStamp), which the
user already has for this client.

    python themida3_repair.py <raw_dump.exe> <good_reference.exe> <output.exe>

Steps:
  1. Copy the entry point from the reference (unlicense often points it at a CRT
     subroutine instead of mainCRTStartup, which skips CRT init -> TLS never set
     up -> crash in an imported DLL that reads fs:[0x2C]).
  2. Restore stolen code: in every EXECUTABLE section, copy the bytes that differ
     from the reference. Themida replaces a few instructions with jumps to its
     runtime stubs; the reference has the originals. Non-executable sections are
     left alone so the rebuilt IAT and per-session data are not disturbed.
  3. (optional, --clean) strip the leftover .themida/.boot sections so the file
     stops looking like a packed binary to AV heuristics. See --clean below.
"""
import struct
import sys
import shutil


def parse(path):
    d = open(path, "rb").read()
    lf = struct.unpack_from("<I", d, 0x3C)[0]
    opt = lf + 24
    nsec = struct.unpack_from("<H", d, lf + 6)[0]
    optsz = struct.unpack_from("<H", d, lf + 20)[0]
    base = struct.unpack_from("<I", d, opt + 28)[0]
    stamp = struct.unpack_from("<I", d, lf + 8)[0]
    ep = struct.unpack_from("<I", d, opt + 16)[0]
    so = opt + optsz
    secs = []
    for i in range(nsec):
        o = so + i * 40
        name = d[o:o + 8].rstrip(b"\0").decode("latin1", "replace")
        vsize, va, rsize, ro = struct.unpack_from("<IIII", d, o + 8)
        chars = struct.unpack_from("<I", d, o + 36)[0]
        secs.append(dict(name=name, va=va, vsize=vsize, rsize=rsize,
                         ro=ro, chars=chars, hdr=o))
    return dict(data=d, lf=lf, opt=opt, base=base, stamp=stamp, ep=ep, secs=secs)


def is_executable(sec):
    # IMAGE_SCN_CNT_CODE (0x20) or IMAGE_SCN_MEM_EXECUTE (0x20000000)
    return bool(sec["chars"] & 0x20000020)


def data_dir(pe, index):
    va, size = struct.unpack_from("<II", pe["data"], pe["opt"] + 96 + index * 8)
    return va, size


def section_of(pe, rva):
    for s in pe["secs"]:
        if s["va"] <= rva < s["va"] + max(s["vsize"], s["rsize"]):
            return s
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 3:
        print(__doc__)
        sys.exit(1)
    raw_path, ref_path, out_path = args

    raw = parse(raw_path)
    ref = parse(ref_path)

    if raw["stamp"] != ref["stamp"]:
        print("STOP: different builds (raw stamp=0x%08X, reference stamp=0x%08X)."
              % (raw["stamp"], ref["stamp"]))
        print("The reference must be the same client version.")
        sys.exit(1)

    shutil.copyfile(raw_path, out_path)
    out = bytearray(open(out_path, "rb").read())

    # index reference sections by starting RVA
    ref_by_va = {s["va"]: s for s in ref["secs"]}

    # 1) entry point
    struct.pack_into("<I", out, raw["opt"] + 16, ref["ep"])
    print("entry point: 0x%08X -> 0x%08X" % (raw["ep"], ref["ep"]))

    # The import table lives in a rebuilt section (Scylla's .SCY). It is marked
    # executable but it is import data, and the raw and reference rebuilds have
    # different internal layouts, so it must not be copied across.
    import_va = data_dir(raw, 1)[0]      # IMAGE_DIRECTORY_ENTRY_IMPORT
    iat_va = data_dir(raw, 12)[0]        # IMAGE_DIRECTORY_ENTRY_IAT
    import_secs = set()
    for rva in (import_va, iat_va):
        if rva:
            s = section_of(raw, rva)
            if s:
                import_secs.add(s["va"])

    # 2) stolen code in executable sections
    restored = 0
    touched_secs = 0
    for s in raw["secs"]:
        if not is_executable(s):
            continue
        if s["va"] in import_secs:
            print("  %-10r RVA %08X: skipped (holds the import table)"
                  % (s["name"], s["va"]))
            continue
        r = ref_by_va.get(s["va"])
        if r is None:
            continue
        n = min(s["rsize"], r["rsize"])
        dr = ref["data"]

        # Walk differing runs. Only restore a run that is a Themida stolen-code
        # stub: it starts with a JMP (0xE9) whose target leaves the image. Those
        # are the bytes Themida replaced with a jump to a runtime stub the dump
        # cannot contain. Every other difference in a code section is a relocated
        # data pointer -- unlicense already set it correctly for THIS layout, and
        # copying the reference's value points it into the reference's memory,
        # which crashes here.
        changed = 0
        i = 0
        while i < n:
            if out[s["ro"] + i] == dr[r["ro"] + i]:
                i += 1
                continue
            # extent of this differing run
            j = i
            while j < n and out[s["ro"] + j] != dr[r["ro"] + j]:
                j += 1
            # Stolen code: Themida wrote a JMP (0xE9) where the reference has
            # real code. Restore those. A differing run that is NOT a jump is a
            # relocated data pointer that unlicense already set for THIS layout;
            # copying the reference's value points it into the reference's memory
            # (a section our image doesn't have) and crashes.
            if out[s["ro"] + i] == 0xE9 and dr[r["ro"] + i] != 0xE9:
                for k in range(i, j):
                    out[s["ro"] + k] = dr[r["ro"] + k]
                changed += j - i
            i = j
        if changed:
            touched_secs += 1
            restored += changed
            print("  %-10r RVA %08X: restored %d bytes of stolen code"
                  % (s["name"], s["va"], changed))
    print("stolen code restored: %d bytes in %d executable section(s)"
          % (restored, touched_secs))

    # 3) optional clean rebuild: strip the leftover packer sections so the file
    #    stops looking packed to AV. Match the reference, which keeps those
    #    sections at the same RVA but with no raw data, renamed to plain names.
    if "--clean" in sys.argv:
        out = clean_rebuild(out, raw, ref, ref_by_va)

    open(out_path, "wb").write(bytes(out))
    print("written: %s (%d bytes)" % (out_path, len(out)))

    # 4) LIEF normalization (needs --clean). unlicense rebuilds its own dumps
    #    through LIEF, which re-emits a clean, normalized PE and drops the
    #    hand-patch artifacts AV flags as "Patched". Doing the same here brings
    #    a repaired 3.x dump down toward what a fully-automated 2.x dump scores.
    if "--clean" in sys.argv:
        lief_normalize(out_path)


def lief_normalize(path):
    try:
        import lief
    except ImportError:
        print("LIEF not available, skipping normalization")
        return
    pe = lief.parse(path)
    if pe is None:
        print("LIEF could not parse the output, skipping normalization")
        return
    builder = lief.PE.Builder(pe)
    # keep the existing tables; we only want the PE re-emitted cleanly
    for opt in ("build_imports", "build_relocations", "build_tls",
                "build_resources"):
        getattr(builder, opt)(False)
    builder.build()
    builder.write(path)
    print("LIEF-normalized: %s" % path)


def clean_rebuild(out, raw, ref, ref_by_va):
    """
    Zero the raw data of sections the reference stripped (the packer leftovers),
    rename sections to the reference's names, and repack the file so the stripped
    bytes are actually gone. The section table stays valid; the loader zero-fills
    the virtual space, exactly as in the reference build.
    """
    opt = raw["opt"]
    falign = struct.unpack_from("<I", out, opt + 36)[0]

    def align(x):
        return (x + falign - 1) & ~(falign - 1)

    # which sections to strip: reference has raw=0 there but we have raw data
    strip = set()
    for s in raw["secs"]:
        r = ref_by_va.get(s["va"])
        if r is not None and r["rsize"] == 0 and s["rsize"] > 0:
            strip.add(s["va"])

    # rename our sections to the reference's names (a normal-looking section table
    # lowers heuristic suspicion)
    for s in raw["secs"]:
        r = ref_by_va.get(s["va"])
        if r is not None and r["name"]:
            name = r["name"].encode("latin1")[:8].ljust(8, b"\0")
            out[s["hdr"]:s["hdr"] + 8] = name

    # header region ends where the first real section data begins
    header_end = min(s["ro"] for s in raw["secs"] if s["rsize"] > 0)

    # grab each section's raw data BEFORE we start moving things, keyed by header
    original = {s["hdr"]: bytes(out[s["ro"]:s["ro"] + s["rsize"]])
                for s in raw["secs"] if s["rsize"] > 0}

    # assign new file offsets in file-order, updating the section table in place
    body = bytearray()
    cursor = header_end
    for s in sorted(raw["secs"], key=lambda s: s["ro"] if s["ro"] else 1 << 30):
        hdr = s["hdr"]
        if s["va"] in strip or s["rsize"] == 0:
            struct.pack_into("<I", out, hdr + 16, 0)   # SizeOfRawData
            struct.pack_into("<I", out, hdr + 20, 0)   # PointerToRawData
            if s["va"] in strip:
                print("  stripped %d bytes of raw data at RVA %08X"
                      % (s["rsize"], s["va"]))
            continue
        raw_bytes = original[hdr]
        struct.pack_into("<I", out, hdr + 20, cursor)  # PointerToRawData
        body += raw_bytes
        pad = align(len(body)) - len(body)
        body += b"\0" * pad
        cursor = header_end + len(body)

    # headers, now with the updated section table, then the repacked body
    return bytearray(out[:header_end]) + body


if __name__ == "__main__":
    main()
