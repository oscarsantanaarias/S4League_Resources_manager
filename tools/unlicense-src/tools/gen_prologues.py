"""
Genera stolen_prologues.json comparando un dump que funciona contra uno recien
salido de unlicense, ya rebasados a la misma ImageBase.

Descarta las diferencias que son solo `call [slot_a]` vs `call [slot_b]` con
ambos dentro de la IAT: son slots DUPLICADOS de la misma funcion, equivalentes.
Lo que queda son los prologos robados, los call a memoria del packer y las
referencias a datos que Themida movio.
"""
import struct, sys, io, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

GOOD = r"C:\S4League\S4ClientAmigo.exe"      # base 0x00E80000
MINE = r"C:\S4League\oep_e80.exe"            # dump de unlicense rebasado a 0x00E80000
OUT = r"C:\Users\sneo\AppData\Local\Programs\Python\Python311-32\Lib\site-packages\unlicense\stolen_prologues.json"
IAT_LO, IAT_HI = 0x01092000, 0x01092C2C

def load(path):
    d = open(path, 'rb').read()
    lf = struct.unpack_from('<I', d, 0x3C)[0]
    n, = struct.unpack_from('<H', d, lf + 6)
    osz, = struct.unpack_from('<H', d, lf + 20)
    so = lf + 24 + osz
    base, = struct.unpack_from('<I', d, lf + 24 + 28)
    imgsz, = struct.unpack_from('<I', d, lf + 24 + 56)
    stamp, = struct.unpack_from('<I', d, lf + 8)
    secs = []
    for i in range(n):
        o = so + i * 40
        vsz, va, rsz, ro = struct.unpack_from('<IIII', d, o + 8)
        secs.append((va, vsz, ro, rsz))
    return d, base, imgsz, secs, stamp

dG, bG, imgG, sG, stG = load(GOOD)
dM, bM, imgM, sM, stM = load(MINE)
assert bG == bM, 'los dos tienen que estar en la misma base'
print('base comun: 0x%08X' % bG)

tG = next(s for s in sG if s[0] == 0x1000)
tM = next(s for s in sM if s[0] == 0x1000)
n = min(tG[3], tM[3])

# bloques distintos
diff = [i for i in range(n) if dG[tG[2] + i] != dM[tM[2] + i]]
blocks = []
cur = None
for i in diff:
    if cur and i - cur[1] <= 8:
        cur[1] = i
    else:
        if cur:
            blocks.append(cur)
        cur = [i, i]
if cur:
    blocks.append(cur)
print('bloques distintos en .text: %d' % len(blocks))

db = {}
descartados = 0
for s, e in blocks:
    # es el operando de un call/jmp indirecto con ambos destinos en la IAT?
    hit = None
    for k in range(max(0, s - 6), s + 1):
        if dM[tM[2] + k] == 0xFF and dM[tM[2] + k + 1] in (0x15, 0x25):
            hit = k
            break
    if hit is not None:
        vg, = struct.unpack_from('<I', dG, tG[2] + hit + 2)
        vm, = struct.unpack_from('<I', dM, tM[2] + hit + 2)
        if IAT_LO <= vg - bG < IAT_HI and IAT_LO <= vm - bM < IAT_HI:
            descartados += 1
            continue
    rva = 0x1000 + s
    if IAT_LO <= rva < IAT_HI:            # la IAT la rellena el loader
        descartados += 1
        continue
    db['%08X' % rva] = dG[tG[2] + s:tG[2] + e + 1].hex()

# el candado: la tabla son parches en RVAs fijos, solo valen para ESE build
meta = {'_base': '%08X' % bG, '_size_of_image': '%08X' % imgG,
        '_timestamp': '%08X' % stG}
out = dict(meta)
out.update(db)
json.dump(out, open(OUT, 'w'), indent=1, sort_keys=True)
print('descartados (equivalentes): %d' % descartados)
print('parches guardados         : %d' % len(db))
print('escrito %s' % OUT)
print('')
for k in sorted(db)[:10]:
    print('   RVA %s  ->  %s' % (k, db[k]))
