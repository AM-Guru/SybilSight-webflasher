"""UID-bound SRAM staging for schema-16 seated off-reset-edge capture."""

import struct

from case_output_off_reset_capture.protocol import EVIDENCE_BYTES, configuration
from case_native_task_flash.stager import BASE, SIZE, Stager


EVIDENCE = 0x20011A00
CONFIG = 0x20011F00


class OutputEdgeStager(Stager):
    def stage_probe(self, payload, cfg):
        payload, cfg = bytes(payload), bytes(cfg)
        if not 0 < len(payload) < 0x1800 or len(payload) % 4 or len(cfg) != 32:
            raise ValueError("passive bootlog code/config bounds differ")
        words = struct.unpack("<8I", cfg)
        if (
            words[2] != 16
            or words[3] > 1
            or words[4] != 64
            or words[6] != 15000
            or cfg != configuration("right" if words[3] else "left", words[5])
        ):
            raise ValueError("passive UART/PB9 request differs")
        self._patch(BASE, payload)
        self._patch(EVIDENCE, bytes(EVIDENCE_BYTES))
        self._patch(CONFIG, cfg)


__all__ = ["BASE", "SIZE", "EVIDENCE", "CONFIG", "OutputEdgeStager"]
