"""Fail-closed gates for a synchronized Case reset and Jumperless capture."""
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

from scripts import jumperless_reset_audio_capture as capture


def qualifier():
    return {
        "status": "qualified",
        "qualifiedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": capture.CASE_SERIAL,
        "route": "left",
        "caseContactPolarityVerified": True,
        "noExternalDriveVerified": True,
        "crossbarNetsVerified": True,
        "bothContactsPresent": True,
        "positivePadRow": 2,
        "negativePadRow": 1,
        "audioChannels": {"positive": 0, "negative": 1},
        "audioAdcRows": {"ADC0": 2, "ADC1": 1},
        "audioFullScaleVolts": 8.0,
        "audioDcBlock": False,
        "audioSampleRate": 16000,
        "directPadVolts": 1.8,
        "breadboardEndVolts": 1.79,
        "breadboardSpreadVolts": 0.02,
    }


class FakeAudio:
    def __init__(self):
        self.stream = None

    def query_devices(self):
        return [{"name": "JL Audio In", "max_input_channels": 2}]

    def check_input_settings(self, **kwargs):
        assert kwargs["samplerate"] == 16000

    def InputStream(self, **kwargs):
        self.stream = FakeStream()
        return self.stream


class FakeStream:
    active = True

    def start(self):
        return self

    def stop(self):
        self.active = False

    def close(self):
        pass


class FakeEvent:
    def wait(self, timeout):
        return False

    def set(self):
        pass


class FakePort:
    def __init__(self):
        self.is_open = True
        self.sent = []

    def write(self, data):
        self.sent.append(data)
        return len(data)

    def flush(self):
        pass

    def close(self):
        self.is_open = False


class LiveAudio(FakeAudio):
    def InputStream(self, **kwargs):
        class LiveStream(FakeStream):
            def start(self):
                for _ in range(33):
                    kwargs["callback"](np.zeros((512, 2), dtype=np.float32), 512, None, None)
                return self
        self.stream = LiveStream()
        return self.stream


class AudioResetGate(unittest.TestCase):
    def test_stale_or_unstable_dc_cannot_arm(self):
        q = qualifier()
        q["breadboardEndVolts"] = 0.0
        with self.assertRaisesRegex(ValueError, "continuity"):
            capture.validate_qualification(q, "left", datetime.now(timezone.utc))
        q = qualifier()
        q["route"] = "right"
        with self.assertRaisesRegex(ValueError, "different Case or route"):
            capture.validate_qualification(q, "left", datetime.now(timezone.utc))

    def test_exact_audio_device_required(self):
        class WrongAudio(FakeAudio):
            def query_devices(self):
                return [{"name": "MacBook Pro Microphone", "max_input_channels": 1}]
        with self.assertRaisesRegex(ValueError, "exactly one JL Audio In"):
            capture.find_exact_audio_device(WrongAudio())

    def test_default_example_adc_route_cannot_arm(self):
        q = qualifier()
        q["audioAdcRows"] = {"ADC0": 20, "ADC1": 40}
        with self.assertRaisesRegex(ValueError, "audio ADC routing"):
            capture.validate_qualification(q, "left", datetime.now(timezone.utc))
        q = qualifier()
        q["audioDcBlock"] = True
        with self.assertRaisesRegex(ValueError, "without DC blocking"):
            capture.validate_qualification(q, "left", datetime.now(timezone.utc))

    def test_missing_live_audio_never_sends_reset(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            q = base / "qualification.json"
            q.write_text(json.dumps(qualifier()))
            port = FakePort()
            audio = FakeAudio()
            status = {"caseSerial": capture.CASE_SERIAL, "case_version": "1.2.57",
                      "left_present": True, "right_present": True, "ota_glasses": 0}
            with (
                patch.object(capture, "preflight", return_value=status),
                patch.object(capture, "_open_case_console", return_value=port),
                patch.object(capture, "fresh_same_session_case_check", return_value=status),
                patch.object(capture.threading, "Event", return_value=FakeEvent()),
            ):
                report = capture.record_one(
                    "/dev/fake", base / "capture", "left", q, audio_module=audio
                )
            self.assertEqual(report["resetCommandsAttempted"], 0)
            self.assertNotIn(capture.FINAL_RESET_COMMAND, port.sent)
            self.assertTrue(report["casePortClosed"])
            self.assertEqual(report["outcome"], "failed-closed")

    def test_live_audio_precedes_single_case_reset_and_persists_samples(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            q = base / "qualification.json"
            q.write_text(json.dumps(qualifier()))
            port = FakePort()
            status = {"caseSerial": capture.CASE_SERIAL, "case_version": "1.2.57",
                      "left_present": True, "right_present": True, "ota_glasses": 0}
            with (
                patch.object(capture, "preflight", return_value=status),
                patch.object(capture, "_open_case_console", return_value=port),
                patch.object(capture, "fresh_same_session_case_check", return_value=status),
                patch.object(capture, "_drain_case_console", return_value=b"Reset GLASSES"),
                patch.object(capture.time, "sleep"),
            ):
                report = capture.record_one(
                    "/dev/fake", base / "capture", "left", q, audio_module=LiveAudio()
                )
            self.assertEqual(report["resetCommandsAttempted"], 1)
            self.assertEqual(port.sent.count(capture.FINAL_RESET_COMMAND), 1)
            self.assertTrue(report["audioLiveBeforeReset"])
            self.assertEqual(report["audioFrames"], 33 * 512)
            self.assertTrue((base / "capture" / "audio-raw-f32.npy").exists())
            self.assertTrue((base / "capture" / "audit.json").exists())
            self.assertTrue(report["casePortClosed"])


if __name__ == "__main__":
    unittest.main()
