"""Schema-11 HELLO staging layered on the qualified changed-range loader."""
import struct

from case_native_task_flash.stager import BASE, SIZE, Stager
from case_native_task_hello.protocol import configuration


class HelloStager(Stager):
    def stage_hello(self, payload, cfg):
        payload = bytes(payload)
        cfg = bytes(cfg)
        if not 0 < len(payload) < 0x1800 or len(payload) % 4 or len(cfg) != 32:
            raise ValueError("HELLO code/config bounds differ")
        words = struct.unpack("<8I", cfg)
        if (
            words[2] != 11
            or words[3] > 1
            or words[4] not in (64, 556)
            or words[6] != 20
            or cfg
            != configuration(
                "right" if words[3] else "left",
                1000000 if words[4] == 64 else 115200,
                words[5],
            )
        ):
            raise ValueError("HELLO request differs")
        self._patch(BASE, payload)
        self._patch(0x20011A00, bytes(512))
        self._patch(0x20011F00, cfg)


__all__ = ["BASE", "SIZE", "HelloStager"]
