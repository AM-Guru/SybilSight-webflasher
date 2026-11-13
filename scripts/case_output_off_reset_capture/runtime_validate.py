"""Execute schema-16 YHM-edge hook with modeled sensor, UART and PB9."""

import struct

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_MCLASS, UC_MODE_THUMB, UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_PRIMASK, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_SP

from case_output_off_reset_capture.protocol import configuration, decode
from g2_even_bootlog import APP_DECISION, BOOT_BANNER, OTA_FLAG_PREFIX, UPDATE_DECISION


U = 0x40004800
B = 0x50000400
OUT = 0x20011A00
CFG = 0x20011F00
RETURN = 0x2000F000


def run(hook, name, stream, route="left", initial_brr=0, edge_mode="high", off_noise=False):
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    for address, size in (
        (0x08000000, 0x10000), (0x20000000, 0x24000),
        (0x40000000, 0x30000), (B & ~0xFFF, 0x2000), (0xE000E000, 0x2000),
    ):
        u.mem_map(address, size)
    u.mem_write(0x20010000, hook)
    u.mem_write(CFG, configuration(route, 0x11223344))
    u.mem_write(0x200000BC, b"\x01")
    u.mem_write(0x20000891, b"\x00")
    u.mem_write(0x20000093, b"\xae")
    u.mem_write(0x20000094, b"\xae")

    def word(address, value):
        u.mem_write(address, struct.pack("<I", value))

    def get(address):
        return struct.unpack("<I", u.mem_read(address, 4))[0]

    kernel = 0x20001000
    word(kernel + 0x14, 1)
    word(0x20000120, 1000)
    word(0x20000124, 64_000_000)
    initial_gpio = {0: 0xFFF7F153, 4: 0x18, 8: 0xC0030, 12: 0x10, 20: 0x1C, 36: 0}
    for offset, value in initial_gpio.items():
        word(B + offset, value)
    for address, value in (
        (U, 0), (U + 4, 0), (U + 8, 0), (U + 12, initial_brr), (U + 44, 0),
        (0x4002103C, 0x00101008), (0x40021054, 0xA5000003),
        (0x40021008, 0x12), (0x4002100C, 0x32020802),
        (0xE000E010, 7), (0xE000E014, 63999),
    ):
        word(address, value)
    original = {address: get(address) for address in (
        U, U + 4, U + 8, U + 12, U + 44,
        B, B + 4, B + 8, B + 12, B + 20, B + 36,
        0x4002103C, 0x40021054, 0xE000E010, 0xE000E014,
    )}
    rx = list(stream)
    model = {
        "time": 1000, "pulseCalls": 0, "txWrites": 0, "systickReads": 0,
        "preEdgeReads": 0, "postEdgeReads": 0, "sensorCalls": [],
        "offNoisePending": off_noise, "offNoiseDiscarded": False,
    }

    def ret(value=0):
        u.reg_write(UC_ARM_REG_R0, value)
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

    def code(_uc, address, _size, _unused):
        if address == 0x0800CA4C:
            ret(2)
        elif address == 0x0800B678:
            if model["sensorCalls"] != [(4 if route == "right" else 3, 0xAE)]:
                raise AssertionError("stock pulse must occur with selected output AE before AF")
            model["pulseCalls"] += 1
            ret()
        elif address == 0x080099E8:
            channel = u.reg_read(UC_ARM_REG_R0)
            value = u.reg_read(UC_ARM_REG_R1)
            if channel != (4 if route == "right" else 3) or value not in (0xAE, 0xAF):
                raise AssertionError("YHM setter outside selected AE/AF sequence")
            model["sensorCalls"].append((channel, value))
            u.mem_write(0x20000090 + channel, bytes((value,)))
            ret(value)
        elif address == RETURN:
            u.emu_stop()
        elif not 0x20010000 <= address < 0x20010000 + len(hook):
            raise AssertionError(f"unexpected execution {address:#x}")

    def read(_uc, _access, address, _size, _value, _unused):
        if address == 0x20000120:
            word(address, model["time"])
        elif address == 0xE000E018:
            value = 1 if model["systickReads"] % 2 == 0 else 63_999
            model["systickReads"] += 1
            word(address, value)
        elif address == B + 16:
            post = bool(model["pulseCalls"])
            key = "postEdgeReads" if post else "preEdgeReads"
            index = model[key]
            if edge_mode == "high":
                bit = 1
            elif edge_mode == "low":
                bit = 0
            elif edge_mode == "toggle-post":
                bit = (index & 1) if post else 1
            elif edge_mode == "toggle-all":
                bit = index & 1
            else:
                raise AssertionError("unknown PB9 edge fixture")
            model[key] += 1
            word(address, bit << 9)
        elif address == U + 28:
            if model["offNoisePending"] and not any(value == 0xAF for _, value in model["sensorCalls"]):
                word(address, 32 | 10)
            else:
                word(address, 32 if rx and get(U) & 4 and any(value == 0xAF for _, value in model["sensorCalls"]) else 0)
        elif address == U + 36:
            if model["offNoisePending"]:
                model["offNoisePending"] = False
                model["offNoiseDiscarded"] = True
                word(address, 0)
            else:
                if not rx:
                    raise AssertionError("RX data read without fixture byte")
                word(address, rx.pop(0))

    def write(_uc, _access, address, _size, value, _unused):
        if address == U + 40:
            model["txWrites"] += 1
            raise AssertionError("passive hook wrote the UART transmit register")
        if address == 0x40003000 and value != 0xAAAA:
            raise AssertionError("watchdog refresh differs")

    u.hook_add(UC_HOOK_CODE, code)
    u.hook_add(UC_HOOK_MEM_READ, read)
    u.hook_add(UC_HOOK_MEM_WRITE, write)
    u.reg_write(UC_ARM_REG_SP, 0x20002C00)
    u.reg_write(UC_ARM_REG_LR, RETURN | 1)
    u.reg_write(UC_ARM_REG_R0, 0x08009B15 if route == "right" else 0x08009AFF)
    u.reg_write(UC_ARM_REG_PRIMASK, 0)
    u.emu_start(0x20010001, 0, count=50_000_000)
    if u.reg_read(UC_ARM_REG_PC) != RETURN:
        raise AssertionError("passive hook did not return through the fixture sentinel")
    raw_evidence = bytes(u.mem_read(OUT, 1280))
    try:
        result = decode(raw_evidence)
    except ValueError as error:
        words = struct.unpack_from("<72I", raw_evidence)
        raise AssertionError(
            f"executed passive evidence rejected: {error}; "
            f"status={words[2]} stage={words[3]} wait={(words[25]-words[14]) & 0xffffffff} "
            f"capture={(words[17]-words[16]) & 0xffffffff} restore={words[21]} "
            f"errors={words[20]} flags={words[22]}"
        ) from error
    if not result["probeQualified"] or result["nonce"] != 0x11223344:
        raise AssertionError("executed passive evidence did not qualify")
    if result["templeBytesSent"] or model["txWrites"]:
        raise AssertionError("executed passive hook transmitted temple bytes")
    if model["pulseCalls"] != 1:
        raise AssertionError("executed passive hook pulse count differs")
    if model["sensorCalls"] != [
        (4 if route == "right" else 3, 0xAE),
        (4 if route == "right" else 3, 0xAF),
        (4 if route == "right" else 3, 0xAE),
    ]:
        raise AssertionError("executed YHM AE/AF/AE sequence differs")
    if not result["captureStartedBeforeYhmOnEdge"] or not result["yhmOffRestoredBeforeReturn"]:
        raise AssertionError("output edge evidence incomplete")
    if off_noise and (not model["offNoiseDiscarded"] or result["discardedOffStateUartErrorMask"] != 10):
        raise AssertionError("off-state UART noise was not quarantined and recorded")
    edge = result["rawPb9Observation"]
    if not edge["prePulse"]["qualified"] or not edge["postPulse"]["qualified"]:
        raise AssertionError("executed raw PB9 evidence did not qualify")
    for address, value in original.items():
        if get(address) != value:
            raise AssertionError(f"peripheral restoration differs at {address:#x}")
    return {
        "case": name,
        "passed": True,
        "inputBytes": len(stream),
        "initialUartBrr": initial_brr,
        "pulseCallsFixture": model["pulseCalls"],
        "sensorCallsFixture": model["sensorCalls"],
        "offNoiseDiscardedFixture": model["offNoiseDiscarded"],
        "uartTxWrites": model["txWrites"],
        "halTickAdvanced": result["halTickEnd"] != result["halTickStart"],
        "edgeModeFixture": edge_mode,
        "rawPb9Observation": edge,
        "evidence": result,
        "boundary": (
            "Actual compiled hook instructions execute in Unicorn. The YHM setter, scheduler, "
            "pulse, tick, UART FIFO and PB9 levels are explicit fixtures; no physical output, "
            "Apollo reset or bootloader executes."
        ),
    }


def validate_runtime(hook):
    cases = (
        ("compiled-update-left-dormant-brr", BOOT_BANNER + b"\r\n" + OTA_FLAG_PREFIX + b"55555555\r\n" + UPDATE_DECISION, "left", 0, "high"),
        ("compiled-application-right-dormant-brr", BOOT_BANNER + b"\r\n" + APP_DECISION, "right", 0, "high"),
        ("compiled-silence-left-dormant-brr", b"", "left", 0, "high"),
        ("compiled-overflow-retained", BOOT_BANNER + b"x" * 1100, "left", 0, "toggle-all"),
        ("compiled-overflow-excludes-late", b"x" * 1100 + BOOT_BANNER, "left", 0, "toggle-all"),
        ("compiled-active-brr-restored", b"", "left", 64, "high"),
        ("compiled-post-pulse-edges-without-uart", b"", "left", 0, "toggle-post"),
        ("compiled-stuck-low-without-uart", b"", "left", 0, "low"),
        ("compiled-off-state-framing-overrun-quarantined", BOOT_BANNER + b"\r\n" + APP_DECISION, "left", 0, "high", True),
    )
    rows = [run(hook, *case) for case in cases]
    decisions = [row["evidence"]["evenBootloaderLog"]["managerDecision"] for row in rows]
    if decisions[:2] != ["install-staged-image", "go-to-app"]:
        raise AssertionError("compiled marker decisions differ")
    if rows[2]["evidence"]["evenBootloaderLog"]["evenBootloaderLogObserved"]:
        raise AssertionError("compiled silence became positive evidence")
    if not rows[3]["evidence"]["evenBootloaderLog"]["bootBannerObserved"]:
        raise AssertionError("compiled retained overflow marker missing")
    if rows[4]["evidence"]["evenBootloaderLog"]["evenBootloaderLogObserved"]:
        raise AssertionError("compiled overwritten marker remained visible")
    if rows[5]["rawPb9Observation"]["electricalActivityObserved"]:
        raise AssertionError("constant-high PB9 became electrical activity")
    if not rows[6]["rawPb9Observation"]["postPulse"]["transitions"]:
        raise AssertionError("post-pulse PB9 edge fixture was not observed")
    if rows[6]["evidence"]["totalReceiveBytes"]:
        raise AssertionError("raw PB9 edge fixture became decoded UART bytes")
    if rows[7]["rawPb9Observation"]["postPulse"]["lowSamples"] != rows[7]["rawPb9Observation"]["postPulse"]["samples"]:
        raise AssertionError("stuck-low PB9 fixture was not retained")
    if rows[8]["evidence"]["evenBootloaderLog"]["managerDecision"] != "go-to-app":
        raise AssertionError("quarantined off-state noise hid post-edge boot marker")
    return rows
