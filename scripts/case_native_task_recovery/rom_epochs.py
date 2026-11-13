"""Bounded read-only ROM epochs; fresh transport after every small range."""
from contextlib import contextmanager
import struct
from g2_case_rom import open_rom_loader,require_expected_identity,read_memory,BootloaderError

@contextmanager
def bound_rom(device,case_serial):
    with open_rom_loader(device) as port:
        require_expected_identity(port)
        raw=read_memory(port,0x1fff7590,12,attempts=1)
        uid=''.join(f'{v:08X}' for v in struct.unpack('<3I',raw))
        if uid!=case_serial.upper():raise ValueError(f'case UID mismatch: {uid}')
        yield port

def read_fresh(device,case_serial,address,size,*,epoch_bytes=4096,attempts=2,progress=None):
    if not 1<=epoch_bytes<=8192 or size<1 or attempts not in (1,2):raise ValueError('unbounded ROM read')
    output=bytearray()
    for base in range(0,size,epoch_bytes):
        count=min(epoch_bytes,size-base)
        for attempt in range(attempts):
            try:
                part=bytearray()
                with bound_rom(device,case_serial) as port:
                    for offset in range(0,count,31):
                        part.extend(read_memory(port,address+base+offset,min(31,count-offset),attempts=1))
                output.extend(part)
                if progress:progress(len(output),size)
                break
            except (BootloaderError,OSError):
                if attempt+1==attempts:raise
    return bytes(output)
