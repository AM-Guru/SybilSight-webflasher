"""UID-bound SRAM staging for the schema-14 passive bootlog capture."""

import struct

from case_even_bootlog_capture.protocol import EVIDENCE_BYTES, configuration
from case_native_task_flash.stager import BASE, SIZE, Stager


EVIDENCE = 0x20011A00
CONFIG = 0x20011F00


class PassiveBootlogStager(Stager):
    def stage_probe(self, payload, cfg):
        payload, cfg = bytes(payload), bytes(cfg)
        if not 0 < len(payload) < 0x1800 or len(payload) % 4 or len(cfg) != 32:
            raise ValueError("passive bootlog code/config bounds differ")
        words = struct.unpack("<8I", cfg)
        if (
            words[2] != 14
            or words[3] > 1
            or words[4] != 64
            or words[6] != 15000
            or cfg != configuration("right" if words[3] else "left", words[5])
        ):
            raise ValueError("passive bootlog request differs")
        self._patch(BASE, payload)
        self._patch(EVIDENCE, bytes(EVIDENCE_BYTES))
        self._patch(CONFIG, cfg)


__all__ = ["BASE", "SIZE", "EVIDENCE", "CONFIG", "PassiveBootlogStager"]
