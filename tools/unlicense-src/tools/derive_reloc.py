import struct, sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

A_PATH = r"C:\S4League\S4Client - s10 limpio.exe"     # base 0x002A0000
B_PATH = r"C:\S4League\unpacked_S4Client.exe"          # base 0x00980000
OUT    = r"C:\S4League\reloc_sites.bin"

def load(path):
    d = open(path, 'rb').read()
    lf = struct.unpack_from('<I', d, 0x3C)[0]
    nsec, = struct.unpack_from('<H', d, lf + 6)
    optsz, = struct.unpack_from('<H', d, lf + 20)
    opt = lf + 24
    base, = struct.unpack_from('<I', d, opt + 28)
    imgsz, = struct.unpack_from('<I', d, opt + 56)
    so = opt + optsz
    secs = []
    for i in range(nsec):
        o = so + i * 40
        nm = d[o:o + 8].rstrip(b'\0').decode('latin1', 'replace')
        vsz, va, rsz, ro = struct.unpack_from('<IIII', d, o + 8)
        secs.append((nm, va, vsz, ro, rsz))
    return d, base, imgsz, secs

dA, baseA, imgA, secA = load(A_PATH)
dB, baseB, imgB, secB = load(B_PATH)
DELTA = (baseB - baseA) & 0xFFFFFFFF
print('A base=0x%08X   B base=0x%08X   delta=0x%08X' % (baseA, baseB, DELTA))

# emparejar secciones por RVA
mapB = {(va, vsz): (ro, rsz) for nm, va, vsz, ro, rsz in secB}

sites = []          # RVAs donde hay un puntero a rebasar
lo, hi = baseA, baseA + imgA
for nm, va, vsz, ro, rsz in secA:
    key = (va, vsz)
    if key not in mapB:
        continue
    roB, rszB = mapB[key]
    n = min(rsz, rszB)
    a = dA[ro:ro + n]
    b = dB[roB:roB + n]
    i = 0
    while i + 4 <= n:
        va_, = struct.unpack_from('<I', a, i)
        if lo <= va_ < hi:                                  # parece puntero a la imagen
            vb_, = struct.unpack_from('<I', b, i)
            if vb_ == ((va_ + DELTA) & 0xFFFFFFFF):         # y B lo tiene rebasado
                sites.append(va + i)
                i += 4
                continue
        i += 1

print('sitios de relocacion detectados: %d' % len(sites))
sites.sort()
# cuantos por seccion
from collections import Counter
c = Counter()
for s in sites:
    for nm, va, vsz, ro, rsz in secA:
        if va <= s < va + vsz:
            c[nm] += 1
            break
for k, v in c.most_common():
    print('   %-14r %d' % (k, v))

with open(OUT, 'wb') as f:
    f.write(struct.pack('<I', len(sites)))
    for s in sites:
        f.write(struct.pack('<I', s))
print('')
print('guardado %s' % OUT)
