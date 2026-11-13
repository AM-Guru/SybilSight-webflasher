"""UID-bound changed-range SRAM staging; no flash command or GO implementation."""
from contextlib import contextmanager
from pathlib import Path
import hashlib,struct,sys,time
from case_native_task_recovery.rom_epochs import bound_rom
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.protocol import request
from case_native_task_recovery.protocol import configuration
from g2_case_rom import read_memory,write_sram,BootloaderError

BASE,SIZE=0x20010000,0x8000
class ReadbackMismatch(BootloaderError):pass

class Stager:
    def __init__(self,device,*,events=None,bad_reads=None):
        self.device=device;self.events=events if events is not None else []
        self.bad_reads=Path(bad_reads) if bad_reads else None
        self.bytes_written=0;self.epochs_skipped=0
    def _emit(self,**event):self.events.append(event)
    @staticmethod
    def _read(port,address,size):
        return b''.join(read_memory(port,address+i,min(31,size-i),attempts=1) for i in range(0,size,31))
    @staticmethod
    def _read_bounds(address,size):
        if not size or not (0x08000000<=address<address+size<=0x08080000 or BASE<=address<address+size<=BASE+SIZE):raise ValueError('outside fixed case flash/SRAM read spans')
    def _session(self,operation,address,size,job):
        for attempt in range(1,4):
            try:
                with bound_rom(self.device,CASE_SERIAL) as port:value=job(port)
                self._emit(operation=operation,address=hex(address),bytes=size,attempt=attempt,completed=True)
                return value
            except (BootloaderError,OSError) as error:
                self._emit(operation=operation,address=hex(address),bytes=size,attempt=attempt,completed=False,error=str(error))
                if attempt==3:raise
                # Retry only this exact SRAM or read-only epoch, on a new port.
                time.sleep(0.15)
    def read(self,address,size):
        self._read_bounds(address,size);result=bytearray()
        for off in range(0,size,4096):
            n=min(4096,size-off)
            result.extend(self._session('read',address+off,n,lambda p,a=address+off,n=n:self._read(p,a,n)))
        return bytes(result)
    def _mismatch(self,address,expected,actual,label):
        detail={'operation':'readback-mismatch','address':hex(address),'bytes':len(expected),'label':label,
          'expectedSha256':hashlib.sha256(expected).hexdigest(),'actualSha256':hashlib.sha256(actual).hexdigest()}
        if self.bad_reads:
            self.bad_reads.mkdir(parents=True,exist_ok=True)
            name=f'{len(self.events):04}-{address:08x}.bin';(self.bad_reads/name).write_bytes(actual);detail['actualFile']=name
        self._emit(**detail)
        raise ReadbackMismatch(f'{label}: known bytes differ at 0x{address:08x}')
    def verify(self,address,expected,*,label='known readback'):
        expected=bytes(expected);self._read_bounds(address,len(expected))
        for off in range(0,len(expected),4096):
            part=expected[off:off+4096];a=address+off
            def check(port,a=a,part=part):
                got=self._read(port,a,len(part))
                if got!=part:self._mismatch(a,part,got,label)
            self._session('verify',a,len(part),check)
    def _patch(self,address,data):
        data=bytes(data)
        if not data or address%4 or len(data)%4 or not BASE<=address<address+len(data)<=BASE+SIZE:raise ValueError('unscoped or unaligned SRAM patch')
        for off in range(0,len(data),1024):
            part=data[off:off+1024];a=address+off
            def stage(port,a=a,part=part):
                if self._read(port,a,len(part))==part:
                    self.epochs_skipped+=1;return
                for i in range(0,len(part),256):
                    block=part[i:i+256];write_sram(port,a+i,block);self.bytes_written+=len(block)
                got=self._read(port,a,len(part))
                if got!=part:self._mismatch(a,part,got,'SRAM stage')
            self._session('sram-stage',a,len(part),stage)
    def stage_writer(self,payload,cfg):
        if not 8<len(payload)<0x3800 or len(payload)%4 or struct.unpack_from('<II',payload)!=(0x20018000,0x20010009):raise ValueError('writer vector/layout differs')
        if len(cfg)!=32:raise ValueError('writer config size')
        w=struct.unpack('<8I',cfg)
        if cfg!=request(w[3],w[4],w[5]):raise ValueError('writer request differs')
        # Validate all inputs before making the first connection.
        self._patch(BASE,payload);self._patch(0x20013a00,bytes(256));self._patch(0x20013f00,cfg)
    def stage_context(self,payload,cfg):
        if not 0<len(payload)<0x1800 or len(payload)%4 or len(cfg)!=32:raise ValueError('context code/config bounds')
        w=struct.unpack('<8I',cfg)
        if w[3]>1 or w[4] not in (64,556) or cfg!=configuration('right' if w[3] else 'left',1000000 if w[4]==64 else 115200,w[5]):raise ValueError('context request differs')
        self._patch(BASE,payload);self._patch(0x20011a00,bytes(256));self._patch(0x20011f00,cfg)
    def restore(self,original):
        if len(original)!=SIZE:raise ValueError('complete original SRAM snapshot required')
        self._patch(BASE,original)
        self.verify(BASE,original,label='full original SRAM')
    @contextmanager
    def connect(self,*,verify_address=None,expected=None):
        """Retry connection/request checks before yielding; never replay body."""
        if expected is not None:
            if verify_address not in (0x20013f00,0x20011f00) or len(expected)!=32:raise ValueError('unscoped execution gate')
        elif verify_address is not None:raise ValueError('missing execution-gate bytes')
        context=None
        for attempt in range(1,4):
            entered=False
            try:
                context=bound_rom(self.device,CASE_SERIAL);port=context.__enter__();entered=True
                if expected is not None and self._read(port,verify_address,32)!=expected:raise ValueError('execution-gate request mismatch')
                self._emit(operation='connect-before-body',attempt=attempt,completed=True)
                break
            except (BootloaderError,OSError) as error:
                if entered:context.__exit__(*sys.exc_info())
                self._emit(operation='connect-before-body',attempt=attempt,completed=False,error=str(error))
                if attempt==3:raise
                time.sleep(0.15)
            except BaseException:
                if entered:context.__exit__(*sys.exc_info())
                raise
        # Deliberately outside the retry loop/exception handler. A body may GO.
        try:yield port
        finally:context.__exit__(*sys.exc_info())
