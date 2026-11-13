#!/usr/bin/env python3
import sys,hashlib,json,struct,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import g2_case_rom as R
DEV='/dev/cu.usbserial-210';BASE=0x20010000;RESULT=0x20011a00;SIZE=32
payload=Path(sys.argv[1]).read_bytes();out=Path(sys.argv[2])
ref=Path('/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin').read_bytes()[32:]
# Accept stock OR any CFW that still starts with same vectors/size - just require live first 8 bytes match and length
with R.open_rom_loader(DEV) as port:
 R.require_expected_identity(port)
 live=b''.join(R.read_memory(port,0x08000000+o,min(256,len(ref)-o),attempts=2) for o in range(0,len(ref),256))
 audit={'liveSha':hashlib.sha256(live).hexdigest(),'stockMatch':live==ref}
 padded=payload+b'\0'*((-len(payload))%4)
 for a,block in {**{BASE+o:padded[o:o+256] for o in range(0,len(padded),256)},**{RESULT+o:bytes(min(256,SIZE-o)) for o in range(0,SIZE,256)}}.items():
  R.write_sram(port,a,block)
  assert R.read_memory(port,a,len(block),attempts=2)==block
 R.go_sram(port);port.dtr=True
time.sleep(2)
with R.open_rom_loader(DEV) as port:
 R.require_expected_identity(port)
 data=R.read_memory(port,RESULT,SIZE,attempts=2)
ver=R.restore_application(DEV,expected_version='1.2.57')
words=struct.unpack_from('<4I',data);regs=data[16:26]
assert words[0]==0x31534e53
h=2166136261
for v in data[:28]:h=((h^v)*16777619)&0xffffffff
assert h==struct.unpack_from('<I',data,28)[0]
audit.update(status=words[2],mask=hex(words[3]),regs=regs.hex(),reg4=hex(regs[4]),version=ver)
out.write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps(audit,indent=2))
