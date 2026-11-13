import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from case_sbl_discovery.run import decode_result, inspect_build, write_verified_sram, verify_case_code, launch_and_wait, capture_wait_seconds
from case_sbl_discovery.validate import fnv
from test_g2_sbl_protocol import status
from g2_sbl_protocol import bias_configuration, parse_ready_frame, bias_word
import zlib

MANIFEST = {"route":"right", "nominalBaud":1000000, "attempts":20}


def result(raw=b"", found=False):
    data = bytearray(256)
    count = len(raw)
    struct.pack_into("<12I", data, 0, 0x314c4253, 1, 0, min(count,128), 0x1e0, 0x3ff, 0x3ff, 0, 0, 1 if found else 20, 8 if found else 160, int(found))
    data[48:58] = data[58:68] = bytes.fromhex("811104afaf038d2033ff")
    for index, value in enumerate(raw):
        data[72 + index % 128] = value
    struct.pack_into("<13I", data, 200, 0x12, 0x32020802, 9, 0, 64, 0, 64, 20, count, 1, count % 128, 0, 0)
    return checksum(data)


def checksum(data):
    struct.pack_into("<I", data, 252, fnv(data[:252]))
    return bytes(data)


class SblDiscoveryHostTests(unittest.TestCase):
    def test_offline_artifacts_import_without_device_transport_modules(self):
        import subprocess
        import sys
        code = "import sys; sys.path.insert(0,sys.argv[1]); sys.modules['serial']=None; sys.modules['g2_case_rom']=None; sys.modules['g2_case_pogo_flasher']=None; from case_sbl_discovery.artifacts import inspect_build, decode_result"
        process = subprocess.run([sys.executable,"-c",code,str(Path(__file__).resolve().parent)],capture_output=True,text=True)
        self.assertEqual(process.returncode,0,process.stderr)

    def test_bias_setup_diagnostics_are_not_treated_as_uart_bytes(self):
        manifest = {**MANIFEST,"entryBias":bias_configuration("pb9-high")}
        data = bytearray(result())
        struct.pack_into("<I",data,8,15)
        struct.pack_into("<II",data,36,0,0)
        struct.pack_into("<BBH",data,68,0x99,25,0)
        struct.pack_into("<5I",data,72,0,0x40000,0x200,0x300,1)
        report = decode_result(checksum(data),manifest)
        self.assertEqual(report["rawCaptureHex"],"")
        self.assertEqual(report["entryBias"]["stopRegisters"]["watchdogPinMask"],"00000300")
        self.assertFalse(report["discovery"]["statusFrames"])

    def test_bias_result_requires_matching_config_duration_and_full_gpio_restore(self):
        manifest = {**MANIFEST,"entryBias":bias_configuration("pb9-low")}
        data = bytearray(result())
        struct.pack_into("<BBH",data,68,0x89,31,5000)
        struct.pack_into("<II",data,244,0x123456,0x123456)
        report = decode_result(checksum(data),manifest)
        self.assertTrue(report["exactRestorationVerified"])
        self.assertFalse(report["entryBias"]["physicalResetVerified"])
        for offset, value in ((68,0x88),(69,15),(70,0),(248,0)):
            bad = bytearray(data); bad[offset] = value
            with self.assertRaises(ValueError,msg=str(offset)): decode_result(checksum(bad),manifest)

    def test_bias_readiness_binds_pin_polarity_and_hold_window(self):
        manifest = {**MANIFEST,"profile":"observed-33-entry1","receiveIntervalMs":400,"entryBias":bias_configuration("pb8-high")}
        words = (0x42533247,2 | (1<<8) | (2<<16),64,20,400,bias_word(manifest),5000)
        body = struct.pack("<7I",*words)
        frame = body + struct.pack("<I",zlib.crc32(body)&0xffffffff)
        self.assertEqual(parse_ready_frame(frame,manifest)["entryBias"],manifest["entryBias"])
        for name in ("pb8-low","pb9-high","none"):
            with self.assertRaises(ValueError): parse_ready_frame(frame,{**manifest,"entryBias":bias_configuration(name)})
        with self.assertRaises(ValueError): parse_ready_frame(frame[:-1]+b"!",manifest)

    def test_bias_hold_is_added_to_host_cleanup_budget(self):
        base = {**MANIFEST,"nominalReceiveWindowMs":8000}
        self.assertEqual(capture_wait_seconds({**base,"entryBias":bias_configuration("pb9-low")})-capture_wait_seconds(base),5)

    def test_late_bias_readiness_suppresses_insertion_cue(self):
        audit, port = {}, SimpleNamespace(dtr=False)
        manifest = {**MANIFEST,"nominalReceiveWindowMs":8000,"entryBias":bias_configuration("pb9-low")}
        with patch("case_sbl_discovery.run.go_sram"), patch("case_sbl_discovery.run.read_ready",return_value={}), patch("case_sbl_discovery.run.time.monotonic",side_effect=[0,3,30]), patch("builtins.print") as output:
            launch_and_wait(port,manifest,audit,True)
        self.assertFalse(audit["insertionCueIssued"])
        self.assertFalse(any("ARMED" in str(call) for call in output.call_args_list))

    def test_timely_bias_readiness_emits_insertion_cue(self):
        audit, port = {}, SimpleNamespace(dtr=False)
        manifest = {**MANIFEST,"nominalReceiveWindowMs":8000,"entryBias":bias_configuration("pb9-low")}
        with patch("case_sbl_discovery.run.go_sram"), patch("case_sbl_discovery.run.read_ready",return_value={}), patch("case_sbl_discovery.run.time.monotonic",side_effect=[0,0.1,30]), patch("builtins.print") as output:
            launch_and_wait(port,manifest,audit,True)
        self.assertTrue(audit["insertionCueIssued"])
        self.assertTrue(any("ARMED" in str(call) for call in output.call_args_list))

    def test_verified_frame_and_restore_required(self):
        report = decode_result(result(status(), True), MANIFEST)
        self.assertTrue(report["exactRestorationVerified"])
        self.assertEqual(report["discovery"]["state"], "sbl-status-verified")
        self.assertFalse(report["discovery"]["firmwareWriteAuthorized"])

    def test_capture_ring_preserves_wrapped_status(self):
        report = decode_result(result(b"noise" * 75 + status(), True), MANIFEST)
        self.assertEqual(report["discovery"]["statusFrames"][0]["frameHex"], status().hex())

    def test_corrupt_completion_rejected(self):
        data = bytearray(result()); data[0] ^= 1
        with self.assertRaises(ValueError): decode_result(data, MANIFEST)
        data = bytearray(result()); data[252] ^= 1
        with self.assertRaises(ValueError): decode_result(data, MANIFEST)

    def test_route_baud_schedule_and_ring_disagreement_rejected(self):
        for offset in (220,224,228,232,240):
            data = bytearray(result(status(), True)); data[offset] ^= 1
            with self.assertRaises(ValueError, msg=str(offset)):
                decode_result(checksum(data), MANIFEST)

    def test_false_positive_and_false_negative_flags_rejected(self):
        with self.assertRaises(ValueError): decode_result(result(b"echo", True), MANIFEST)
        data = bytearray(result(status(), True)); struct.pack_into("<I", data, 44, 0)
        with self.assertRaises(ValueError): decode_result(checksum(data), MANIFEST)

    def test_partial_transaction_cannot_report_success(self):
        data = bytearray(result()); struct.pack_into("<I", data, 40, 159)
        with self.assertRaises(ValueError): decode_result(checksum(data), MANIFEST)

    def test_restore_failure_is_reported_without_success_claim(self):
        data = bytearray(result()); data[58] ^= 1
        report = decode_result(checksum(data), MANIFEST)
        self.assertFalse(report["exactRestorationVerified"])

    def test_sram_writer_rejects_case_flash_options_and_other_ram(self):
        for address in (0x08000000,0x1fff7800,0x00438000,0x20000000,0x20011900,0x20011b00):
            with self.assertRaises(ValueError): write_verified_sram(None,address,b"\0"*4)

    def test_sram_writer_does_not_accept_missing_readback(self):
        with patch("case_sbl_discovery.run.write_sram"), patch("case_sbl_discovery.run.read_range", return_value=b"bad"):
            with self.assertRaises(ValueError): write_verified_sram(None,0x20010000,b"\0"*4)

    def test_manifest_payload_tampering_rejected_before_hardware(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            (p/"bridge.bin").write_bytes(b"bad")
            (p/"validated-manifest.json").write_text(json.dumps({"schemaVersion":2,"operation":"fixed-hello-discovery-only","entryBias":None,"payloadBytes":3,"payloadSha256":"0"*64}))
            with self.assertRaises(ValueError): inspect_build(p)

    def test_two_consecutive_pinned_reads_required(self):
        audit = {}
        with tempfile.TemporaryDirectory() as directory, patch("case_sbl_discovery.run.read_range", side_effect=[b"bad",b"ref",b"ref"]), patch("builtins.print"):
            verify_case_code(None,b"ref",audit,Path(directory)/"audit.json")
        self.assertEqual([r["matchesPinnedReference"] for r in audit["caseCodeReadbacks"]], [False,True,True])

    def test_persistent_or_alternating_mismatch_never_admits_payload(self):
        with tempfile.TemporaryDirectory() as directory, patch("case_sbl_discovery.run.read_range", side_effect=[b"ref",b"bad",b"ref",b"bad"]), patch("builtins.print"):
            with self.assertRaises(ValueError): verify_case_code(None,b"ref",{},Path(directory)/"audit.json")

    def test_lost_go_ack_never_relaunches_or_claims_armed(self):
        audit, port = {}, SimpleNamespace(dtr=False)
        with patch("case_sbl_discovery.run.go_sram", side_effect=RuntimeError("ACK lost")) as go, patch("case_sbl_discovery.run.read_ready", side_effect=ValueError("no ready")), patch("case_sbl_discovery.run.time.monotonic", side_effect=[0,20]), patch("builtins.print") as output:
            launch_and_wait(port,{**MANIFEST,"nominalReceiveWindowMs":8000},audit,True)
        self.assertEqual(go.call_count,1)
        self.assertTrue(port.dtr)
        self.assertFalse(audit["launchAcknowledged"])
        self.assertFalse(any("ARMED" in str(call) for call in output.call_args_list))

    def test_interrupt_is_deferred_until_cleanup_boundary(self):
        audit, port = {}, SimpleNamespace(dtr=False)
        with patch("case_sbl_discovery.run.go_sram"), patch("case_sbl_discovery.run.read_ready", return_value={}), patch("case_sbl_discovery.run.time.monotonic", side_effect=[0,1,1,20]), patch("case_sbl_discovery.run.time.sleep", side_effect=KeyboardInterrupt), patch("builtins.print"):
            launch_and_wait(port,{**MANIFEST,"nominalReceiveWindowMs":8000},audit,False)
        self.assertTrue(audit["interruptionDeferredUntilCleanup"])

    def test_armed_wait_includes_wire_time_and_direction_change_margin(self):
        budget = capture_wait_seconds({"nominalReceiveWindowMs":80000,"attempts":4000,"nominalBaud":115200})
        self.assertGreater(budget,80 + 4000 * 80 / 115200)
        self.assertLessEqual(budget,150)

    def test_valid_readiness_can_recover_a_lost_go_ack(self):
        audit, port = {}, SimpleNamespace(dtr=False)
        with patch("case_sbl_discovery.run.go_sram", side_effect=RuntimeError("ACK lost")) as go, patch("case_sbl_discovery.run.read_ready", return_value={"verified":True}), patch("case_sbl_discovery.run.time.monotonic", side_effect=[0,20]), patch("builtins.print") as output:
            launch_and_wait(port,{**MANIFEST,"nominalReceiveWindowMs":8000},audit,True)
        self.assertEqual(go.call_count,1)
        self.assertFalse(audit["launchAcknowledged"])
        self.assertTrue(any("ARMED" in str(call) for call in output.call_args_list))


if __name__ == "__main__":
    unittest.main()
