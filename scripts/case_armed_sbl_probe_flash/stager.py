"""UID-bound SRAM staging for the schema-12 armed SBL probe."""
import struct

from case_armed_sbl_probe.protocol import configuration
from case_native_task_flash.stager import BASE, SIZE, Stager


class ArmedSblStager(Stager):
    def stage_probe(self, payload, cfg):
        payload, cfg = bytes(payload), bytes(cfg)
        if not 0 < len(payload) < 0x1800 or len(payload) % 4 or len(cfg) != 32:
            raise ValueError("armed SBL code/config bounds differ")
        words = struct.unpack("<8I", cfg)
        if (
            words[2] != 12
            or words[3] > 1
            or words[4] not in (64, 556)
            or words[6] != 4
            or cfg != configuration(
                "right" if words[3] else "left",
                1_000_000 if words[4] == 64 else 115_200,
                words[5],
            )
        ):
            raise ValueError("armed SBL request differs")
        self._patch(BASE, payload)
        self._patch(0x20011A00, bytes(512))
        self._patch(0x20011F00, cfg)


__all__ = ["BASE", "SIZE", "ArmedSblStager"]
