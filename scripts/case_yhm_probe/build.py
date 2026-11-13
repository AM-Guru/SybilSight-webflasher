#!/usr/bin/env python3
import subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent;out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
for s in ('bridge.c','start.S'):
 subprocess.run(['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror','-c',str(root/s),'-o',str(out/(Path(s).stem+'.o'))],check=True)
subprocess.run(['/opt/homebrew/bin/arm-none-eabi-ld','-T',str(root/'link.ld'),str(out/'start.o'),str(out/'bridge.o'),'-o',str(out/'bridge.elf')],check=True)
subprocess.run(['/opt/homebrew/bin/arm-none-eabi-objcopy','-O','binary',str(out/'bridge.elf'),str(out/'bridge.bin')],check=True)
print('built',out/'bridge.bin', (out/'bridge.bin').stat().st_size)
