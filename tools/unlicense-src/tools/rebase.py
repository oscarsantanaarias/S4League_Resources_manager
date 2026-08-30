import struct, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SRC, DST = sys.argv[1], sys.argv[2]
NEW_BASE = int(sys.argv[3], 16)
SITES = r"C:\S4League\reloc_sites.bin"

raw = open(SITES, 'rb').read()
n, = struct.unpack_from('<I', raw, 0)
sites = struct.unpack_from('<%dI' % n, raw, 4)

d = bytearray(open(SRC, 'rb').read())
lf = struct.unpack_from('<I', d, 0x3C)[0]
opt = lf + 24
nsec, = struct.unpack_from('<H', d, lf + 6)
optsz, = struct.unpack_from('<H', d, lf + 20)
so = opt + optsz
old_base, = struct.unpack_from('<I', d, opt + 28)
imgsz, = struct.unpack_from('<I', d, opt + 56)
delta = (NEW_BASE - old_base) & 0xFFFFFFFF

secs = []
for i in range(nsec):
    o = so + i * 40
    vsz, va, rsz, ro = struct.unpack_from('<IIII', d, o + 8)
    secs.append((va, vsz, ro, rsz))

def r2o(rva):
    for va, vsz, ro, rsz in secs:
        if va <= rva < va + rsz:
            return ro + (rva - va)
    return None

print('%s' % os.path.basename(SRC))
print('   base 0x%08X -> 0x%08X   (delta 0x%08X)' % (old_base, NEW_BASE, delta))

lo, hi = old_base, old_base + imgsz
applied = skipped = nodata = 0
for s in sites:
    o = r2o(s)
    if o is None or o + 4 > len(d):
        nodata += 1
        continue
    v, = struct.unpack_from('<I', d, o)
    if not (lo <= v < hi):        # ya no parece un puntero a la imagen: no tocar
        skipped += 1
        continue
    struct.pack_into('<I', d, o, (v + delta) & 0xFFFFFFFF)
    applied += 1

struct.pack_into('<I', d, opt + 28, NEW_BASE)
# clavar la base: ASLR off + no reubicable
dll, = struct.unpack_from('<H', d, opt + 70)
struct.pack_into('<H', d, opt + 70, dll & ~0x0040)
ch, = struct.unpack_from('<H', d, lf + 22)
struct.pack_into('<H', d, lf + 22, ch | 0x0001)

open(DST, 'wb').write(bytes(d))
print('   punteros reescritos : %d' % applied)
print('   sin dato en archivo : %d' % nodata)
print('   omitidos (no apuntaban a la imagen): %d' % skipped)
print('   -> %s' % os.path.basename(DST))
