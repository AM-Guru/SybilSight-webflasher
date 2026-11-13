"""Execute the compiled Cortex-M0+ payload under fault and UART models.

Models test the emitted code and allowed writes, not electrical delivery,
physical reset or retail SBL provisioning.
"""
import struct
import sys
import zlib
from pathlib import Path

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_READ
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0, UC_ARM_REG_SP, UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from g2_sbl_protocol import HELLO, find_status_frames
from case_sbl_reset_capture.protocol import ready_bytes, parse_ready, decode_result
from case_sbl_reset_capture.trace import fnv

BASE = 0x20010000
RESULT = 0x20011a00
UART = 0x40004800
HOST_UART = 0x40013800
CASES = ("silence", "valid", "echo-valid", "wrapped-valid", "bad-crc", "echo-only", "late-valid", "unknown-baseline", "baseline-read", "clock", "framing", "write", "timer", "tx-timeout", "host-tx-timeout", "post-read", "post-changed", "restore-write", "uart-error", "watchdog-descriptor")
CASES += ("reset-timer", "reset-release", "reset-restore", "reset-latch-restore", "gate-latch-restore")


def status_fixture():
    body = struct.pack("<23I", (96 << 16) | 1, 0xffff0110, 0x40000, 0, 2, 0x12345678, 0xabcdef01, 3, 4, *([0] * 14))
    return struct.pack("<I", zlib.crc32(body) & 0xffffffff) + body


def ordered_capture(data):
    words = struct.unpack_from("<12I", data)
    cursor, = struct.unpack_from("<I", data, 240)
    if words[3] > 128 or cursor >= 128:
        raise ValueError("invalid capture ring")
    raw = data[72:200]
    return raw[cursor:] + raw[:cursor] if words[3] == 128 else raw[:words[3]]


def run(payload, route, baud, profile, attempts, fault, *, trace, target=None):
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    for address, size in ((0x08000000,0x10000), (0x20000000,0x24000), (0x40000000,0x30000), (0x50000000,0x2000), (0xe000e000,0x2000)):
        u.mem_map(address, size)
    u.mem_write(BASE, payload)
    actions = []
    reset_delay = False
    manifest = {"route":route,"nominalBaud":baud,"profile":profile,"attempts":attempts,"receiveIntervalMs":400 if attempts==20 else 20,"entryBias":None,"resetTrace":trace}
    if target is not None:
        target.bind(manifest)
    reg8 = 0x22 if profile == "reviewed-22" else 0x45 if profile == "observed-45" else 0x33
    registers = bytearray.fromhex("811104afaf03812022ff")
    registers[8] = reg8
    if profile == "observed-33-entry1":
        registers[6] = 0x8d
    original = bytes(registers)
    tx, writes, rx, host_tx = [], [], [], []
    reads = 0
    finished = injected = write_failed = False
    release_fault_injected = False
    timer_running, tick_at = False, 0

    def word(address, value): u.mem_write(address, struct.pack("<I", value))
    def out_word(offset): return struct.unpack("<I", u.mem_read(RESULT + offset, 4))[0]
    def ret(value=0):
        u.reg_write(UC_ARM_REG_R0, value)
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

    # Deliberately nonzero initial fields expose incomplete field restoration.
    gpio_original = {0:0xa0000000, 4:0x55, 8:0x500a0000, 12:0xa0050000, 36:0x55aa0067, 20:0x100}
    for offset, value in gpio_original.items(): word(0x50000400 + offset, value)

    def reset_flags(): return u.mem_read(RESULT+69,1)[0]
    def reset_ticks(): return struct.unpack("<H",u.mem_read(RESULT+70,2))[0]

    def record_action(kind,value):
        assert len(actions) < len(trace["actions"]), "extra reset action"
        assert (kind,value) == tuple(trace["actions"][len(actions)]), (actions,kind,value)
        actions.append((kind,value))
        if target is not None:
            target.stock_reset_action(kind,value,len(actions)-1)

    def code(uc, address, size, context):
        nonlocal reads, write_failed, injected, rx
        if address in (0x08004eec,0x08008438,0x08006a40,0x08002888): ret()
        elif address == 0x08002cb8:
            descriptor = struct.unpack("<5I",u.mem_read(0x20000014,20))
            assert descriptor in ((4,0,0,2,0),(4,1,0,2,0)), "native watchdog GPIO descriptor is not pinned to PB2"
            word(0x20000018,1)
            ret()
        elif address == 0x08006cf8:
            if target is not None and actions:
                target.tx_setup()
            word(0x50000400, 0xa00a0000)
            word(0x5000040c, 0xa0000000)
            for a, value in ((0x40021008,0x12), (0x4002100c,0x32020802), (UART,9), (UART+4,0), (UART+12,64)):
                word(a, value)
            if fault == "clock": word(0x40021008,0)
            if fault == "framing": word(UART+4,0x400)
            if fault == "watchdog-descriptor": word(0x20000014,0x300)
            ret()
        elif address == 0x08006c80:
            if target is not None:
                target.turnaround()
            word(UART, 5)
            target_attempt = attempts if fault == "late-valid" else 1
            if target is None and not injected and len(tx) == target_attempt * 8:
                injected = True
                frame = status_fixture()
                if fault in ("valid", "late-valid"): rx = list(frame)
                elif fault == "echo-valid": rx = list(HELLO * 3 + frame)
                elif fault == "wrapped-valid": rx = list(HELLO * 40 + frame)
                elif fault == "bad-crc": rx = list(bytes([frame[0] ^ 1]) + frame[1:])
                elif fault == "echo-only": rx = list(HELLO * 20)
            ret()
        elif address == 0x08004e9e:
            base,mask,high = (u.reg_read(r) for r in (UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2))
            assert (base,mask) in ((0x50000000,8),(0x50000400,512)) and high in (0,1)
            old = struct.unpack("<I",u.mem_read(base+20,4))[0]
            word(base+20,(old|mask) if high else (old & ~mask))
            if reset_flags() & 1 and not reset_flags() & 4:
                if base == 0x50000400:
                    assert struct.unpack("<I",u.mem_read(base,4))[0] & 0xc0000 == 0x40000
                record_action(0 if base == 0x50000000 else 1,high)
            ret()
        elif address == 0x0800a7a2:
            count = u.reg_read(UC_ARM_REG_R0)
            record_action(3,count)
            if target is not None:
                target.busy_delay(count)
            ret()
        elif address == 0x08009040:
            index = u.reg_read(UC_ARM_REG_R0)
            assert index < 10 and u.reg_read(UC_ARM_REG_R1) == 1
            value = registers[index]
            ok = 1
            if fault == "unknown-baseline" and reads < 10 and index == 2: value ^= 1
            if fault == "baseline-read" and reads < 10 and index == 8: ok = 0
            if fault == "post-read" and reads >= 10 and index == 8: ok = 0
            if fault == "post-changed" and reads >= 10 and index == 4: value ^= 1
            u.mem_write(u.reg_read(UC_ARM_REG_R2), bytes([value]))
            reads += 1
            ret(ok)
        elif address == 0x08009108:
            index = u.reg_read(UC_ARM_REG_R0)
            value = u.mem_read(u.reg_read(UC_ARM_REG_R2), 1)[0]
            assert index in (3,4,5,6,7) and u.reg_read(UC_ARM_REG_R1) == 1
            assert value == original[index] or (index,value) in ((5,3),(6,0xc1),(3,0xa6),(4,0xa6),(7,3),(7,5))
            writes.append((index,value))
            if fault == "write" and not write_failed:
                write_failed = True; ret(0)
            elif fault == "restore-write" and index == 6 and value == original[6]: ret(0)
            else: registers[index] = value; ret(1)
        elif address < 0x08010000:
            raise AssertionError(f"unreviewed case native call 0x{address:x}")

    def read(uc, access, address, size, value, context):
        nonlocal release_fault_injected, tick_at
        # Deliver injected UART bursts before advancing the coarse timer.
        # This is a receive-path model, not a per-byte timing calibration.
        if address == 0xe000e010:
            if fault == "reset-timer" and reset_delay:
                word(address,5)
            elif target is not None and timer_running:
                # The train delay polls SysTick directly; receive loops advance at
                # the earlier wire event or tick instead of freezing bytes.
                if reset_flags() & 1 and not reset_flags() & 4:
                    target.advance_to(max(target.now_us,tick_at))
                tick = target.now_us >= tick_at
                if tick:
                    tick_at = target.now_us + 1000
                word(address,0x10005 if tick else 5)
            else:
                word(address, 5 if fault == "timer" or rx else 0x10005)
        elif address == 0x50000400 and fault == "reset-release" and reset_flags() & 4 and not reset_flags() & 8 and not release_fault_injected:
            if struct.unpack("<I",u.mem_read(address,4))[0] & 0xf0000 == 0:
                release_fault_injected = True
                word(address,struct.unpack("<I",u.mem_read(address,4))[0]|0x40000)
        elif address == 0x50000400 and fault == "reset-restore" and reads >= 20:
            word(address,struct.unpack("<I",u.mem_read(address,4))[0]^0x10000)
        elif address == 0x50000414 and fault == "reset-latch-restore" and reads >= 20:
            word(address,struct.unpack("<I",u.mem_read(address,4))[0]^0x100)
        elif address == 0x50000014 and fault == "gate-latch-restore" and reads >= 20:
            word(address,struct.unpack("<I",u.mem_read(address,4))[0]^8)
        elif address == UART + 0x1c:
            receiving = struct.unpack("<I", u.mem_read(UART,4))[0] == 5
            if target is not None:
                if timer_running:
                    target.advance_to(target.next_event(tick_at))
                word(address,0xc0 | (0x20 if receiving and target.case_rx else 0) | target.uart_error)
            else:
                word(address, (0 if fault == "tx-timeout" else 0xc0) | (0x20 if receiving and rx else 0) | (1 if fault == "uart-error" and receiving else 0))
        elif address == UART + 0x24:
            word(address,target.read_case_byte() if target is not None else rx.pop(0) if rx else 0)
        elif address == HOST_UART + 28: word(address, 0 if fault == "host-tx-timeout" else 0xc0)

    def write(uc, access, address, size, value, context):
        nonlocal finished, timer_running, tick_at, reset_delay
        allowed = (0xe000e010,0xe000e014,0xe000e018,0xe000e180,0xe000e280,0x40003000,0x40021034,0x40021040,UART,UART+12,UART+24,UART+32,UART+40,0x50000400,0x50000000,0x50000004,0x50000008,0x5000000c,0x50000024,0x50000028,HOST_UART,HOST_UART+4,HOST_UART+8,HOST_UART+12,HOST_UART+32,HOST_UART+40)
        allowed += (0x50000404,0x50000408,0x5000040c,0x50000424,0x50000418,0x50000018)
        assert 0x20000000 <= address < 0x20024000 or address in allowed, f"unexpected peripheral/flash write {address:x}"
        gpio_masks = {0x50000400:0xf0000,0x50000404:0x300,0x50000408:0xf0000,0x5000040c:0xf0000,0x50000424:0xff}
        if address in gpio_masks:
            previous = struct.unpack("<I",u.mem_read(address,4))[0]
            assert (previous ^ value) & ~gpio_masks[address] == 0, "unrelated GPIO fields changed"
        if address in (0x50000418,0x50000018):
            assert value & ~0x03000300 == 0 if address == 0x50000418 else value & ~0x00080008 == 0
            base = address-24
            old = struct.unpack("<I",u.mem_read(base+20,4))[0]
            word(base+20,(old|(value&0xffff))&~(value>>16))
        if address == 0x50000028:
            old = struct.unpack("<I",u.mem_read(0x50000014,4))[0]
            word(0x50000014,old&~value)
        if address == 0xe000e010:
            if value & 1 and reset_flags() & 1 and not reset_flags() & 4:
                kind,ms = trace["actions"][len(actions)]
                assert kind == 2
                record_action(kind,ms)
                reset_delay = True
            elif not value & 1:
                reset_delay = False
        if target is not None:
            if address == 0xe000e010:
                timer_running = bool(value & 1)
                tick_at = target.now_us + 1000
            elif address == UART:
                target.set_receive(bool(value & 4))
            elif address in (0x50000400,0x5000040c):
                mode = value if address == 0x50000400 else struct.unpack("<I",u.mem_read(0x50000400,4))[0]
                pull = value if address == 0x5000040c else struct.unpack("<I",u.mem_read(0x5000040c,4))[0]
                target.set_gpio(mode,pull)
        if address == UART + 40:
            assert reset_flags() & 15 == 15, "HELLO before complete reset/release"
            assert actions == [tuple(a) for a in trace["actions"]], "HELLO before complete native train"
            assert len(tx) < 8 * attempts and value == HELLO[len(tx) % 8]
            assert registers[6] == 0xc1 and registers[7] == (3 if route == "left" else 5)
            assert struct.unpack("<I", u.mem_read(UART+12,4))[0] == (64 if baud == 1000000 else 556)
            tx.append(value)
            if target is not None:
                target.write_case_byte(value)
        if address == HOST_UART + 40:
            assert len(host_tx) < len(ready_bytes(manifest))
            assert registers[6] == 0xc1 and registers[7] == (3 if route == "left" else 5)
            host_tx.append(value)
            if target is not None and len(host_tx) == len(ready_bytes(manifest)):
                parse_ready(bytes(host_tx),manifest)
                target.ready()
        if address == RESULT + 252 and u.mem_read(RESULT,4) == b"RST3":
            word(address,value); finished=True
        if address == 0x40003000 and finished:
            u.emu_stop()  # Include one completion-tail iteration and its native-call guard.

    u.hook_add(UC_HOOK_CODE, code)
    u.hook_add(UC_HOOK_MEM_READ, read)
    u.hook_add(UC_HOOK_MEM_WRITE, write)
    stack, entry = struct.unpack_from("<II", payload)
    u.reg_write(UC_ARM_REG_SP, stack)
    u.emu_start(entry, 0, count=60_000_000)
    assert finished, "bounded completion marker missing"
    data = bytes(u.mem_read(RESULT,256))
    words = struct.unpack_from("<12I",data)
    assert words[0] == 0x33545352 and words[1] == 3 and fnv(data[:252]) == struct.unpack_from("<I",data,252)[0]
    if fault in ("unknown-baseline", "baseline-read"):
        assert words[2] == 1 and not writes and not tx
    elif fault in ("clock", "framing"):
        assert words[2] == 3 and not writes and not tx
    elif fault in ("post-read", "post-changed", "restore-write"):
        assert words[2] == 8
    else:
        assert bytes(registers) == original and data[48:58] == data[58:68] and words[5] == words[6] == 0x3ff
        expected_error = {"write":4, "timer":4, "tx-timeout":6, "host-tx-timeout":10, "uart-error":9,"reset-timer":12,"reset-release":14,"reset-restore":13,"reset-latch-restore":13,"gate-latch-restore":13,"watchdog-descriptor":15}.get(fault,0)
        if target is None:
            assert words[2] == expected_error, (fault, words[2])
    if fault not in ("unknown-baseline","baseline-read"):
        assert reset_flags() & 8 or fault == "reset-release", "PB9 not released"
        if fault not in ("reset-restore","reset-latch-restore","gate-latch-restore"):
            assert reset_flags() & 16 and out_word(244) == out_word(248), "GPIO restoration not verified"
            for offset,original_value in gpio_original.items():
                assert struct.unpack("<I",u.mem_read(0x50000400+offset,4))[0] == original_value, (fault,offset)
    if fault in ("reset-timer","reset-release"):
        assert not tx
    if words[9]:
        assert actions == [tuple(a) for a in trace["actions"]]
    found = find_status_frames(ordered_capture(data))
    positive = fault in ("valid", "echo-valid", "wrapped-valid", "late-valid")
    assert bool(words[11]) == bool(found), (fault, words[11], found)
    if target is None:
        assert bool(found) == positive, (fault, found)
        if positive: assert len(tx) == 8 * (attempts if fault == "late-valid" else 1)
    ready = len(host_tx) == len(ready_bytes(manifest))
    if ready:
        parse_ready(bytes(host_tx), manifest)
    else:
        assert not tx, "temple traffic before a complete readiness acknowledgement"
    report = {"case":fault, "status":words[2], "templeBytesSent":len(tx), "sblStatusVerified":bool(found), "readyAcknowledged":ready, "yhmWrites":len(writes), "nominalResetDelayTicks":reset_ticks(), "resetFlags":reset_flags(), "resetActions":len(actions), "completed":True}
    decode_result(data,manifest)
    if target is not None:
        report.update(retainedResultHex=data.hex(),target=target.report(),physicalRecoveryVerified=False)
    return report


def validate_payload(payload, route, baud, profile, attempts, *, trace):
    return [run(payload,route,baud,profile,attempts,fault,trace=trace) for fault in CASES]
