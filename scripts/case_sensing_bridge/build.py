#!/usr/bin/env python3
"""Build and model-validate the volatile sensing bridge; does not open serial."""
import argparse, subprocess, sys
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();root=Path(__file__).resolve().parent
args.output.mkdir(parents=True,exist_ok=True)
for source in ('bridge.c','start.S'):
 command=['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror','-c',str(root/source),'-o',str(args.output/(Path(source).stem+'.o'))]
 subprocess.run(command,check=True)
subprocess.run(['/opt/homebrew/bin/arm-none-eabi-ld','-T',str(root/'link.ld'),str(args.output/'start.o'),str(args.output/'bridge.o'),'-o',str(args.output/'bridge.elf')],check=True)
subprocess.run(['/opt/homebrew/bin/arm-none-eabi-objcopy','-O','binary',str(args.output/'bridge.elf'),str(args.output/'bridge.bin')],check=True)
subprocess.run([sys.executable,str(root/'validate.py'),str(args.output)],check=True)
