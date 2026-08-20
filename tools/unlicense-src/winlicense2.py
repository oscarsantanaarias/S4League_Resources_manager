import json
import logging
import os
import struct
from typing import Dict, List, Set, Tuple, Any, Optional

import pyscylla  # type: ignore
from capstone import (  # type: ignore
    Cs, CS_ARCH_X86, CS_MODE_32, CS_MODE_64)
from capstone.x86 import X86_OP_MEM, X86_OP_IMM  # type: ignore

from .imports import ImportToCallSiteDict, WrapperSet, find_wrapped_imports
from .dump_utils import dump_pe, pointer_size_to_fmt
from .emulation import resolve_wrapped_api, _export_containing
from .function_hashing import compute_function_hash, EMPTY_FUNCTION_HASH
from .process_control import (ProcessController, Architecture, MemoryRange,
                              ReadProcessMemoryError)

LOG = logging.getLogger(__name__)


def fix_and_dump_pe(process_controller: ProcessController, pe_file_path: str,
                    image_base: int, oep: int,
                    text_section_range: MemoryRange) -> None:
    """
    Main dumping routine for Themida/WinLicense 2.x.
    """
    # Convert RVA range to VA range
    section_virtual_addr = image_base + text_section_range.base
    text_section_range = MemoryRange(
        section_virtual_addr, text_section_range.size, "r-x",
        process_controller.read_process_memory(section_virtual_addr,
                                               text_section_range.size))
    assert text_section_range.data is not None
    LOG.debug(".text section: %s", str(text_section_range))

    arch = process_controller.architecture
    exports_dict = process_controller.enumerate_exported_functions()

    # Instanciate the disassembler
    if arch == Architecture.X86_32:
        cs_mode = CS_MODE_32
    elif arch == Architecture.X86_64:
        cs_mode = CS_MODE_64
    else:
        raise NotImplementedError(f"Unsupported architecture: {arch}")
    md = Cs(CS_ARCH_X86, cs_mode)
    md.detail = True

    LOG.info("Looking for wrapped imports ...")
    api_to_calls, wrapper_set = find_wrapped_imports(text_section_range,
                                                     exports_dict, md,
                                                     process_controller)

    LOG.info("Potential import wrappers found: %d", len(wrapper_set))
    export_hashes = None
    # Hash-matching strategy is only needed for 32-bit PEs
    if arch == Architecture.X86_32:
        LOG.info("Generating exports' hashes, this might take some time ...")
        export_hashes = _generate_export_hashes(md, exports_dict,
                                                process_controller)

    LOG.info("Resolving imports ...")
    resolved_wrappers = _resolve_imports(api_to_calls, wrapper_set,
                                         export_hashes, md, process_controller)
    LOG.info("Imports resolved: %d", len(api_to_calls))

    # Ensure the range is writable (both the original IAT and the call sites
    # live in the code section)
    process_controller.set_memory_protection(text_section_range.base,
                                             text_section_range.size, "rwx")

    # Prefer repairing the original IAT in place: references that we cannot
    # detect statically (data imports read with `mov reg, [slot]`, thunk tables
    # we didn't rewrite) keep working, because the loader fills the very slots
    # they already read from.
    original_iat = _repair_original_iat(image_base, oep, exports_dict,
                                        resolved_wrappers, wrapper_set,
                                        export_hashes, md, process_controller)
    if original_iat is not None:
        iat_addr, iat_size, slot_for_api = original_iat
        add_new_iat = False
    else:
        LOG.warning("Could not reuse the original IAT, falling back to a "
                    "generated one (data imports will stay broken)")
        iat_addr, iat_size = _generate_new_iat_in_process(
            api_to_calls, text_section_range.base, process_controller)
        slot_for_api = None
        add_new_iat = True
        LOG.info("Generated the fake IAT at %s, size=%s", hex(iat_addr),
                 hex(iat_size))

    # Replace detected references to wrappers or imports
    LOG.info("Patching call and jmp sites ...")
    _fix_import_references_in_process(api_to_calls, iat_addr,
                                      process_controller, slot_for_api)

    LOG.info("Restoring stolen prologues ...")
    _restore_stolen_prologues(image_base, text_section_range,
                              process_controller)
    _neutralize_broken_initializers(image_base, text_section_range, md,
                                    process_controller)

    # Restore memory protection to RX
    process_controller.set_memory_protection(text_section_range.base,
                                             text_section_range.size, "r-x")

    LOG.info("Dumping PE with OEP=%s ...", hex(oep))
    dump_pe(process_controller, pe_file_path, image_base, oep, iat_addr,
            iat_size, add_new_iat)


def _neutralize_broken_initializers(image_base: int,
                                    text_section_range: MemoryRange, md: Cs,
                                    process_controller: ProcessController
                                    ) -> None:
    """
    Point the CRT's static initializer table away from bodies the packer moved.

    Themida relocates some function bodies into its own data and leaves the
    stub behind jumping there. When one of those is in the initializer table the
    CRT calls it before `main`, follows the jump into a region the dump cannot
    contain, and the process dies right after the entry point.

    A build that runs has that entry aimed at a do-nothing function instead, so
    do the same: find the entries whose body leaves the code section, and point
    them at an empty `push ebp; mov ebp, esp; pop ebp; ret` already in the image.
    """
    data = text_section_range.data
    if data is None:
        return
    base = text_section_range.base
    end = base + len(data)

    # push ebp ; mov ebp, esp ; pop ebp ; ret
    empty_stub = data.find(bytes([0x55, 0x8B, 0xEC, 0x5D, 0xC3]))
    if empty_stub < 0:
        LOG.debug("No empty stub to redirect initializers to")
        return
    stub_addr = base + empty_stub

    image_end = image_base + 0x8000000

    def body_was_moved_out(addr: int, depth: int = 0) -> bool:
        """
        True when the function jumps straight into the image but outside the
        code section: that is where the packer parks the bodies it relocates.
        A call to a normal function is not it, and neither is a jump that
        leaves the image entirely (those are the stolen prologues, handled
        elsewhere), so both are ignored here.
        """
        offset = addr - base
        if not 0 <= offset < len(data) - 0x20 or depth > 1:
            return False
        for insn in md.disasm(bytes(data[offset:offset + 0x20]), addr):
            if insn.mnemonic == "ret":
                return False
            if not insn.operands or insn.operands[0].type != X86_OP_IMM:
                continue
            target = insn.operands[0].imm
            if insn.mnemonic == "jmp":
                if image_base <= target < image_end and not base <= target < end:
                    return True
                return False
            if insn.mnemonic == "call" and base <= target < end:
                return body_was_moved_out(target, depth + 1)
        return False

    ptr_size = process_controller.pointer_size
    fixed = 0
    run = 0
    for offset in range(0, len(data) - ptr_size, ptr_size):
        value = struct.unpack_from("<I", data, offset)[0]
        if not base <= value < end:
            run = 0
            continue
        # Only look inside a run of pointers: a lone one is just data that
        # happens to look like an address.
        run += 1
        if run < 8:
            continue
        if not body_was_moved_out(value):
            continue
        process_controller.write_process_memory(
            base + offset, list(struct.pack("<I", stub_addr)))
        LOG.debug("Initializer at RVA %s pointed at %s, neutralized",
                  hex(base + offset - image_base), hex(value - image_base))
        fixed += 1

    if fixed:
        LOG.info("Initializers whose body the packer moved away: %d neutralized",
                 fixed)


def _restore_stolen_prologues(image_base: int,
                              text_section_range: MemoryRange,
                              process_controller: ProcessController) -> None:
    """
    Put back the code Themida moved out of the image.

    Themida overwrites the first instructions of some functions with a `jmp` to
    a stub it allocates at runtime (padding the rest with int3), and rewrites a
    few data references to point at its own memory. That works while packed; a
    dump contains none of it, so those jumps land in unmapped memory and the
    client dies, typically while the CRT walks its static initializer table.

    The original bytes cannot be recovered from the running program: searching
    the whole address space for them finds nothing, and the stub Themida jumps
    to is an unrelated function of its own. They come from
    `stolen_prologues.json`, which is built from a dump that is known to run
    (see `tools/gen_prologues.py`). Without that table this is a no-op and the
    dump behaves as it did before.
    """
    # Two sources. The table is bytes taken from a build that is known to
    # run, so it is exact but only covers the build it was made from. Watching
    # the packer works on any build but only catches what it happened to write
    # while its protection changes were visible, which varies run to run.
    # Prefer the table when it matches; fall back to what we saw otherwise.
    try:
        header = process_controller.read_process_memory(image_base, 0x400)
        pe_offset = struct.unpack_from("<I", header, 0x3C)[0]
        stamp = struct.unpack_from("<I", header, pe_offset + 8)[0]
        image_size = struct.unpack_from("<I", header, pe_offset + 0x50)[0]
    except (ReadProcessMemoryError, struct.error):
        LOG.warning("Could not read the PE header, skipping stolen prologues")
        return

    patches, gen_base, gen_size, gen_stamp = _load_known_prologues()
    observed = _observed_stolen_writes(image_base, image_size,
                                       process_controller)
    if patches and stamp == gen_stamp:
        # Both: whatever we watched the packer do, plus the entries only a
        # reference build can supply (things it rewrote at pack time, which
        # never produce a write we could see).
        merged = dict(observed)
        for rva, original in patches.items():
            merged[rva] = original
        patches = merged
        gen_base, gen_size = image_base, image_size
        source = "watching + table"
    else:
        if patches:
            LOG.info(
                "Stolen prologue table is for another build (%s, this one is "
                "%s); using what the packer was seen to overwrite instead.",
                hex(gen_stamp), hex(stamp))
        patches = observed
        gen_base, gen_size = image_base, image_size
        source = "watching the packer"
        if not patches:
            LOG.info("Nothing to restore: no table for this build and nothing "
                     "was caught being overwritten")
            return

    applied = 0
    for rva, original in patches.items():
        data = bytearray(original)
        # Entries can hold absolute addresses (rewritten data references), so
        # move anything that points inside the image onto this run's base.
        for off in range(0, len(data) - 3):
            value = struct.unpack_from("<I", data, off)[0]
            if gen_base <= value < gen_base + gen_size:
                struct.pack_into("<I", data, off,
                                 value - gen_base + image_base)
        process_controller.write_process_memory(image_base + rva, list(data))
        applied += 1

    LOG.info("Stolen code restored: %d sites (from %s)", applied, source)


def _observed_stolen_writes(image_base: int, image_size: int,
                            process_controller: ProcessController
                            ) -> Dict[int, bytes]:
    """
    Turn the agent's record of the packer's writes into {RVA: original bytes}.

    Only writes that land on the image and replace real code with a jump out of
    it are kept: that is the shape of a stolen prologue. Everything else the
    packer writes (its own data, decrypted sections) is left alone.
    """
    getter = getattr(process_controller, "get_stolen_writes", None)
    if getter is None:
        return {}
    flush = getattr(process_controller, "flush_write_watch", None)
    if flush is not None:
        try:
            flush()
        except Exception as ex:  # pylint: disable=broad-except
            LOG.debug("Could not flush the write log: %s", str(ex))
    try:
        writes = getter()
    except Exception as ex:  # pylint: disable=broad-except
        LOG.debug("Could not read the write log: %s", str(ex))
        return {}

    if os.environ.get("UNLICENSE_DUMP_WRITES") == "1":
        raw = [{
            "rva": "%08X" % (int(e["address"], 16) - image_base),
            "before": bytes(e["before"]).hex(),
            "after": bytes(e["after"]).hex(),
        } for e in writes if isinstance(e.get("address"), str)]
        with open("observed_writes.json", "w", encoding="utf-8") as handle:
            json.dump(raw, handle, indent=1)
        LOG.info("Wrote %d observed writes to observed_writes.json", len(raw))

    out: Dict[int, bytes] = {}
    for entry in writes:
        try:
            address = int(entry["address"], 16) if isinstance(
                entry["address"], str) else int(entry["address"])
            before = bytes(entry["before"])
            after = bytes(entry["after"])
        except (KeyError, TypeError, ValueError):
            continue
        if len(before) != len(after) or not after:
            continue
        rva = address - image_base
        if not 0 < rva < image_size:
            continue
        if not _points_outside_image(before, after, address, image_base,
                                     image_size):
            continue
        # A spot can be written more than once, and a later record would carry
        # the already-patched bytes as its "before". Keep the earliest, and
        # never take one that is itself a jump out of the image.
        if rva in out or (len(before) >= 5 and before[0] == 0xE9):
            continue
        out[rva] = before
    return out


def _points_outside_image(before: bytes, written: bytes, address: int,
                          image_base: int, image_size: int) -> bool:
    """
    Did the packer redirect this spot at its own runtime memory?

    Two shapes, and only these two. Casting a wider net catches decrypted data
    that merely happens to hold a pointer, and rewriting that wrecks the dump.

      - code replaced by a relative jump that leaves the image
      - a 4-byte pointer that used to aim inside the image and now aims out
    """
    def outside(value: int) -> bool:
        return (0x10000 <= value < 0x7FFF0000
                and not image_base <= value < image_base + image_size)

    def inside(value: int) -> bool:
        return image_base <= value < image_base + image_size

    if 5 <= len(written) <= 0x40 and written[0] == 0xE9:
        rel = struct.unpack_from("<i", written, 1)[0]
        if outside((address + 5 + rel) & 0xFFFFFFFF):
            return True

    if len(written) == 4 and len(before) == 4:
        was = struct.unpack_from("<I", before, 0)[0]
        now = struct.unpack_from("<I", written, 0)[0]
        if inside(was) and outside(now):
            return True

    return False


def _load_known_prologues() -> Tuple[Dict[int, bytes], int, int, int]:
    """
    Read `stolen_prologues.json` and return (patches by RVA, base it was built
    against, size of that image, PE timestamp of that build). Empty when the
    file is missing or unreadable.
    """
    path = os.path.join(os.path.dirname(__file__), "stolen_prologues.json")
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return {}, 0, 0, 0

    try:
        gen_base = int(raw.pop("_base"), 16)
        gen_size = int(raw.pop("_size_of_image"), 16)
        gen_stamp = int(raw.pop("_timestamp"), 16)
    except (KeyError, ValueError):
        LOG.warning("stolen_prologues.json has no build information, ignoring")
        return {}, 0, 0, 0

    patches = {}
    for rva, hex_bytes in raw.items():
        try:
            patches[int(rva, 16)] = bytes.fromhex(hex_bytes)
        except ValueError:
            continue
    return patches, gen_base, gen_size, gen_stamp


def _generate_export_hashes(
        md: Cs, exports_dict: Dict[int, Dict[str, Any]],
        process_controller: ProcessController) -> Dict[int, int]:
    """
    Go through the given export dictionary and produce a hash for each function
    listed in it.
    """
    result: Dict[int, int] = {}
    # Small exports (stubs, forwarders, and every API that shares a common
    # prologue) hash to the same value. Keeping the last one silently resolves
    # wrappers to an unrelated API -- which is worse than not resolving them,
    # because nothing downstream can tell it went wrong. Ambiguous hashes are
    # dropped so those wrappers fall back to emulation, which is exact.
    ambiguous_hashes: Set[int] = set()
    modules = process_controller.enumerate_modules()
    LOG.debug("Hashing exports for %s", str(modules))
    ranges = []
    for module_name in modules:
        if module_name != process_controller.main_module_name:
            ranges += process_controller.enumerate_module_ranges(
                module_name, include_data=True)
    ranges = list(
        filter(lambda mem_range: mem_range.protection[2] == 'x', ranges))

    def get_data(addr: int, size: int) -> bytes:
        for mem_range in ranges:
            if mem_range.data is None:
                continue
            if mem_range.contains(addr):
                offset = addr - mem_range.base
                return mem_range.data[offset:offset + size]
        return bytes()

    exports_count = len(exports_dict)
    for i, (export_addr, export_info) in enumerate(exports_dict.items()):
        # Only code can be hashed; data exports are in the dict too
        if export_info.get('type', 'function') != 'function':
            continue
        export_hash = compute_function_hash(md, export_addr, get_data,
                                            process_controller)
        if export_hash != EMPTY_FUNCTION_HASH:
            previous = result.get(export_hash)
            if previous is not None and previous != export_addr:
                ambiguous_hashes.add(export_hash)
            else:
                result[export_hash] = export_addr
        else:
            LOG.debug("Empty hash for %s", hex(export_addr))
        LOG.debug("Exports hashed: %d/%d", i, exports_count)

    for export_hash in ambiguous_hashes:
        result.pop(export_hash, None)
    LOG.info("Export hashes: %d usable, %d dropped as ambiguous", len(result),
             len(ambiguous_hashes))

    return result


def _resolve_imports(api_to_calls: ImportToCallSiteDict,
                     wrapper_set: WrapperSet,
                     export_hashes: Optional[Dict[int, int]], md: Cs,
                     process_controller: ProcessController) -> Dict[int, int]:
    """
    Resolve potential import wrappers by hash-matching or emulation.
    """
    arch = process_controller.architecture
    page_size = process_controller.page_size

    def get_data(addr: int, size: int) -> bytes:
        try:
            return process_controller.read_process_memory(addr, size)
        except ReadProcessMemoryError:
            # In case we crossed a page boundary and tried to read an invalid
            # page, reduce size to stop at page boundary, and try again.
            size = page_size - (addr % page_size)
        return process_controller.read_process_memory(addr, size)

    # Iterate over the set of potential import wrappers and try to resolve them
    resolved_wrappers: Dict[int, int] = {}
    problematic_wrappers = set()
    for call_addr, call_size, instr_was_jmp, wrapper_addr, _ in wrapper_set:
        resolved_addr = resolved_wrappers.get(wrapper_addr)
        if resolved_addr is not None:
            LOG.debug("Already resolved wrapper: %s -> %s", hex(wrapper_addr),
                      hex(resolved_addr))
            api_to_calls[resolved_addr].append(
                (call_addr, call_size, instr_was_jmp))
            continue

        if wrapper_addr in problematic_wrappers:
            # Already failed to resolve this one, ignore
            LOG.debug("Skipping unresolved wrapper")
            continue

        # If 32-bit executable, try hash-matching
        if export_hashes is not None and arch == Architecture.X86_32:
            try:
                import_hash = compute_function_hash(md, wrapper_addr, get_data,
                                                    process_controller)
            except Exception as ex:
                LOG.debug("Failure for wrapper at %s: %s", hex(wrapper_addr),
                          str(ex))
                problematic_wrappers.add(wrapper_addr)
                continue
            if import_hash != EMPTY_FUNCTION_HASH:
                LOG.debug("Hash: %s", hex(import_hash))
                resolved_addr = export_hashes.get(import_hash)
                if resolved_addr is not None:
                    LOG.debug("Hash matched")
                    LOG.debug("Resolved API: %s -> %s", hex(wrapper_addr),
                              hex(resolved_addr))
                    resolved_wrappers[wrapper_addr] = resolved_addr
                    api_to_calls[resolved_addr].append(
                        (call_addr, call_size, instr_was_jmp))
                    continue

        # Try to resolve the destination address by emulating the wrapper
        resolved_addr = resolve_wrapped_api(call_addr, process_controller,
                                            call_addr + call_size)
        if resolved_addr is not None:
            LOG.debug("Resolved API: %s -> %s", hex(wrapper_addr),
                      hex(resolved_addr))
            resolved_wrappers[wrapper_addr] = resolved_addr
            api_to_calls[resolved_addr].append(
                (call_addr, call_size, instr_was_jmp))
        else:
            problematic_wrappers.add(wrapper_addr)

    return resolved_wrappers


def _scan_wrapper_for_api(wrapper_addr: int, exports_dict: Dict[int, Dict[str,
                                                                          Any]],
                          md: Cs, get_data: Any) -> Optional[int]:
    """
    Last-resort static resolution of a wrapper.

    Emulation is exact but gives up on wrappers Themida virtualized. Most of
    those still *mention* the API they wrap: as the target of a `jmp`/`call`, or
    as an immediate that gets pushed and returned to. Disassemble the wrapper
    and, if exactly one known export address shows up, take it. Requiring
    uniqueness is what keeps this from guessing.
    """
    SCAN_SIZE = 0x200
    try:
        data = get_data(wrapper_addr, SCAN_SIZE)
    except Exception:  # pylint: disable=broad-except
        return None
    if not data:
        return None

    candidates = set()
    for instruction in md.disasm(data, wrapper_addr):
        for op in instruction.operands:
            if op.type == X86_OP_IMM:
                value = op.value.imm
            elif op.type == X86_OP_MEM:
                value = op.value.mem.disp
            else:
                continue
            # `_export_containing` also catches `jmp API+N`, the shape Themida
            # leaves behind when it steals an API's prologue
            export_addr = _export_containing(value, exports_dict)
            if export_addr is not None:
                candidates.add(export_addr)
                if len(candidates) > 1:
                    return None

    return candidates.pop() if len(candidates) == 1 else None


def _repair_original_iat(
    image_base: int,
    oep: int,
    exports_dict: Dict[int, Dict[str, Any]],
    resolved_wrappers: Dict[int, int],
    wrapper_set: WrapperSet,
    export_hashes: Optional[Dict[int, int]],
    md: Cs,
    process_controller: ProcessController,
) -> Optional[Tuple[int, int, Dict[int, int]]]:
    """
    Locate the packed program's original IAT and resolve every slot in place.

    Themida overwrites each slot with the address of a wrapper it allocated at
    runtime. Generating a brand new IAT elsewhere only fixes the call sites we
    managed to detect: slots that are read as data (`mov reg, [slot]`, which is
    how imported *variables* such as `_environ` or `_acmdln` are accessed) keep
    the stale wrapper address and make the dump crash as soon as the CRT starts.

    Repairing the original table instead means the loader fills the exact slots
    the code already reads from, whatever way it reads them.

    Returns (iat_address, iat_size, {api_address: slot_address}) or None.
    """
    ptr_size = process_controller.pointer_size
    ptr_format = pointer_size_to_fmt(ptr_size)

    try:
        iat_addr, iat_size = pyscylla.search_iat(process_controller.pid,
                                                 image_base,
                                                 oep,
                                                 advanced_search=True)
    except pyscylla.ScyllaException as scylla_exception:
        LOG.warning("IAT auto-search failed: %s", str(scylla_exception))
        return None

    if iat_addr == 0 or iat_size < ptr_size:
        LOG.warning("IAT auto-search returned an empty range")
        return None
    LOG.info("Original IAT found at %s, size=%s (%d slots)", hex(iat_addr),
             hex(iat_size), iat_size // ptr_size)

    try:
        iat_data = process_controller.read_process_memory(iat_addr, iat_size)
    except ReadProcessMemoryError as read_exception:
        LOG.warning("Could not read the original IAT: %s", str(read_exception))
        return None

    def get_data(addr: int, size: int) -> bytes:
        page_size = process_controller.page_size
        try:
            return process_controller.read_process_memory(addr, size)
        except ReadProcessMemoryError:
            size = page_size - (addr % page_size)
        return process_controller.read_process_memory(addr, size)

    # Themida wrappers routinely inspect their return address to work out which
    # import they stand for, so emulating one out of the blue fails where
    # emulating it from a real call site succeeds. Keep a call site per slot.
    slot_callsites: Dict[int, Tuple[int, int]] = {}
    for call_addr, call_size, _, _, ptr_addr in wrapper_set:
        if ptr_addr is not None:
            slot_callsites.setdefault(ptr_addr, (call_addr, call_size))

    slot_for_api: Dict[int, int] = {}
    unresolved_slots: List[int] = []
    already_valid = 0
    repaired = 0
    unresolved = 0
    for i in range(iat_size // ptr_size):
        slot_addr = iat_addr + i * ptr_size
        value = struct.unpack_from(ptr_format, iat_data, i * ptr_size)[0]
        if value == 0:
            continue

        # Slot already points at a real export (typical for data imports,
        # which Themida cannot wrap)
        if value in exports_dict:
            slot_for_api.setdefault(value, slot_addr)
            already_valid += 1
            continue

        # Slot points at a wrapper: reuse the resolution done for call sites,
        # then hash-matching, then emulation
        api_addr = resolved_wrappers.get(value)
        if api_addr is None and export_hashes is not None:
            try:
                wrapper_hash = compute_function_hash(md, value, get_data,
                                                     process_controller)
                if wrapper_hash != EMPTY_FUNCTION_HASH:
                    api_addr = export_hashes.get(wrapper_hash)
            except Exception as ex:  # pylint: disable=broad-except
                LOG.debug("Hashing failed for slot %s: %s", hex(slot_addr),
                          str(ex))
        if api_addr is None:
            # Emulate from a real call site when we know one: the wrapper then
            # sees the return address it expects
            callsite = slot_callsites.get(slot_addr)
            if callsite is not None:
                call_addr, call_size = callsite
                api_addr = resolve_wrapped_api(call_addr, process_controller,
                                               call_addr + call_size)
        if api_addr is None:
            api_addr = resolve_wrapped_api(value, process_controller)
        if api_addr is None or api_addr not in exports_dict:
            api_addr = _scan_wrapper_for_api(value, exports_dict, md, get_data)

        if api_addr is None or api_addr not in exports_dict:
            LOG.warning(
                "Unresolved IAT slot %s -> %s (Scylla will emit a '?' import "
                "for it)", hex(slot_addr), hex(value))
            unresolved_slots.append(slot_addr)
            unresolved += 1
            continue

        resolved_wrappers[value] = api_addr
        process_controller.write_process_memory(
            slot_addr, list(struct.pack(ptr_format, api_addr)))
        slot_for_api.setdefault(api_addr, slot_addr)
        repaired += 1

    LOG.info("Original IAT: %d slots already valid, %d repaired, %d unresolved",
             already_valid, repaired, unresolved)
    if unresolved > repaired + already_valid:
        LOG.warning("Most of the original IAT could not be resolved")
        return None

    return iat_addr, iat_size, slot_for_api


def _generate_new_iat_in_process(
        imports_dict: ImportToCallSiteDict, near_to_ptr: int,
        process_controller: ProcessController) -> Tuple[int, int]:
    """
    Generate a new IAT from a list of imported function addresses and write
    it into a new buffer into the target process. `near_to_ptr` is used to
    allocate the new IAT near the unpacked module (which is needed for 64-bit
    processes).
    """
    ptr_size = process_controller.pointer_size
    ptr_format = pointer_size_to_fmt(ptr_size)
    iat_size = len(imports_dict) * ptr_size
    # Allocate a new buffer in the target process
    iat_addr = process_controller.allocate_process_memory(
        iat_size, near_to_ptr)

    # Generate the new IAT and write it into the buffer
    new_iat_data = bytearray()
    for import_addr in imports_dict:
        new_iat_data += struct.pack(ptr_format, import_addr)
    process_controller.write_process_memory(iat_addr, list(new_iat_data))

    return iat_addr, iat_size


def _fix_import_references_in_process(
        api_to_calls: ImportToCallSiteDict,
        iat_addr: int,
        process_controller: ProcessController,
        slot_for_api: Optional[Dict[int, int]] = None) -> None:
    """
    Replace resolved wrapper call sites with call/jmp to the IAT (that contains
    resolved imports).

    When `slot_for_api` is given, the original IAT is being reused and each API
    keeps the slot it already had, instead of an index into a generated table.
    """
    arch = process_controller.architecture
    ptr_size = process_controller.pointer_size

    skipped = 0
    for i, (api_addr, call_addrs) in enumerate(api_to_calls.items()):
        if slot_for_api is not None:
            slot_addr = slot_for_api.get(api_addr)
            if slot_addr is None:
                # Resolved from a call site but absent from the original IAT:
                # leave the site alone rather than point it at a slot the
                # loader will never fill.
                skipped += len(call_addrs)
                continue
        for call_addr, _, instr_was_jmp in call_addrs:
            ptr_addr = slot_addr if slot_for_api is not None \
                else iat_addr + i * ptr_size
            if arch == Architecture.X86_32:
                # Absolute
                operand = ptr_addr
                fmt = "<I"
            elif arch == Architecture.X86_64:
                # RIP-relative
                operand = ptr_addr - (call_addr + 6)
                fmt = "<i"
            else:
                raise NotImplementedError(f"Unsupported architecture: {arch}")

            if instr_was_jmp:
                # jmp [slot]
                new_instr = bytes([0xFF, 0x25]) + struct.pack(fmt, operand)
            else:
                # call [slot]
                new_instr = bytes([0xFF, 0x15]) + struct.pack(fmt, operand)
            process_controller.write_process_memory(call_addr, list(new_instr))

    if skipped != 0:
        LOG.warning("%d call sites left untouched (API missing from the "
                    "original IAT)", skipped)
