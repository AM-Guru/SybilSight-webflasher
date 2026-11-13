from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g2_app_reset_control as control
from g2_pogo_protocol import build_response
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_CORTEX_M0, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R7,
    UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC,
)


class AppResetControlTests(unittest.TestCase):
    def test_emitted_thumb_validator_accepts_only_fixed_reset_lane(self):
        bridge = control.build_reset_only_bridge()
        cases = (
            (control.RESET_REQUEST, 0),
            (bytes.fromhex("24000100a7"), 1),
            (bytes.fromhex("52000000d4"), 1),
            (control.RESET_REQUEST[:4], 1),
        )
        for request, expected in cases:
            with self.subTest(request=request.hex()):
                cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
                cpu.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
                cpu.mem_map(0x20010000, 0x10000)
                cpu.mem_write(0x20010000, bridge)
                cpu.mem_write(0x20019000, request)
                cpu.reg_write(UC_ARM_REG_SP, 0x2001FF00)
                cpu.reg_write(UC_ARM_REG_R0, 0x20019000)
                cpu.reg_write(UC_ARM_REG_R1, len(request))
                cpu.reg_write(UC_ARM_REG_R7, 0x20018000)
                cpu.reg_write(UC_ARM_REG_LR, 0x2001E001)

                def checksum_stub(uc, address, _size, _unused):
                    if address == 0x20010520:
                        uc.reg_write(UC_ARM_REG_R0, 1)
                        uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

                cpu.hook_add(UC_HOOK_CODE, checksum_stub)
                cpu.emu_start(0x20010381, 0x2001E000, count=1000)
                self.assertEqual(cpu.reg_read(UC_ARM_REG_R0), expected)

    def test_bridge_changes_only_fixed_request_validator_immediates(self):
        original = control.pogo.build_bridge(observed_charging_phase=True)
        patched = control.build_reset_only_bridge()
        changed = [i for i, (a, b) in enumerate(zip(original, patched)) if a != b]
        self.assertEqual(changed, sorted(control.BRIDGE_CHANGES))
        self.assertEqual(control.RESET_REQUEST.hex(), "0b0000008d")

    def test_timeout_after_request_is_not_replayed(self):
        class FakeTransport:
            def __init__(self, *_args, **_kwargs):
                pass

            def transact(self, request, _timeout):
                self_requests.append(request)
                raise TimeoutError("reply lost")

        self_requests = []
        with (
            patch.object(control, "ResetOnlyTransport", FakeTransport),
            patch.object(control.pogo, "_close_checked"),
        ):
            result = control.reset_route("fake-device", "left")
        self.assertEqual(self_requests, [control.RESET_REQUEST])
        self.assertEqual(result["templeRequestAttempts"], 1)
        self.assertFalse(result["acknowledged"])

    def test_setup_status_three_can_retry_before_any_temple_request(self):
        calls = []

        class FakeTransport:
            def __init__(self, *_args, **_kwargs):
                calls.append("setup")
                if len(calls) == 1:
                    raise ValueError("bridge setup status 3: transient")

            def transact(self, request, _timeout):
                calls.append(request)
                return build_response(0x0B, 0)

        with (
            patch.object(control, "ResetOnlyTransport", FakeTransport),
            patch.object(control.pogo, "_close_checked"),
            patch.object(control.time, "sleep"),
        ):
            result = control.reset_route("fake-device", "right")
        self.assertEqual(calls, ["setup", "setup", control.RESET_REQUEST])
        self.assertEqual(result["templeRequestAttempts"], 1)
        self.assertTrue(result["acknowledged"])


if __name__ == "__main__":
    unittest.main()
