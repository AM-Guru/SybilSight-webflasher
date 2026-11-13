"""Execute actual hook/guard/native pulse; RTOS and UART time are fixtures."""
import struct,zlib
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE,UC_HOOK_MEM_READ
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11,UC_ARM_REG_PRIMASK
from case_sbl_reset_prepared.trace import extract,fnv
from case_native_task_hello.protocol import configuration,decode
from g2_sbl_protocol import HELLO
CASES=('left-valid','right-valid','left-115200','right-115200','silence','echo-only','echo-valid','wrapped-valid',
 'bad-crc','truncated','wrong-baud-echo','late-status','unarmed','bad-complement','bad-payload','bad-schema','bad-config-crc','route-mismatch',
 'scheduler-stopped','interrupts-masked','reset-flag-missing','tick-disabled','tick-reload','clock','clock-source','core-clock',
 'uart-live','uart-layout','gpio-not-output','rx-not-ready','tx-timeout','rx-overrun','gpio-restore','uart-restore','reset-flag-lost',
 'clock-lost','uart-stolen','gpio-stolen','one-shot-second-call','right-after-left-fallback')
U=0x40004800;B=0x50000400

def frame():
    values=[0]*24;values[1:4]=[0x00600001,0x00000110,0x800000]
    b=bytearray(struct.pack('<24I',*values));struct.pack_into('<I',b,0,zlib.crc32(b[4:])&0xffffffff);return bytes(b)

def run(stock_wrapped,patched,hook,case,initial_brr=64):
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    for a,n in ((0x08000000,0x10000),(0x20000000,0x24000),(0x40000000,0x30000),(B&~0xfff,0x2000),(0xe000e000,0x2000)):u.mem_map(a,n)
    u.mem_write(0x08000000,patched);u.mem_write(0x20010000,hook)
    route='right' if case in ('right-valid','right-115200','route-mismatch','right-after-left-fallback') else 'left'
    baud=115200 if case.endswith('115200') else 1000000
    cfg=bytearray(configuration(route,baud,0x11223344))
    attempt_limit=struct.unpack_from('<I',cfg,24)[0]
    if case=='unarmed':cfg[:8]=bytes(8)
    if case=='bad-complement':cfg[4]^=1
    if case=='bad-config-crc':cfg[28]^=1
    if case=='bad-schema':struct.pack_into('<I',cfg,8,9);struct.pack_into('<I',cfg,28,fnv(cfg[:28]))
    if case=='bad-payload':u.mem_write(0x20010010,bytes([hook[16]^1]))
    u.mem_write(0x20011f00,bytes(cfg));u.mem_write(0x200000bc,bytes([0 if case=='reset-flag-missing' else 1]))
    def word(a,v):u.mem_write(a,struct.pack('<I',v))
    def get(a):return struct.unpack('<I',u.mem_read(a,4))[0]
    def out(n):return get(0x20011a00+4*n)
    kernel=struct.unpack_from('<I',stock_wrapped,32+0xca68)[0]
    word(kernel+0x14,int(case!='scheduler-stopped'));word(kernel+0x30,0);word(0x20000120,1000);word(0x20000124,64000000 if case!='core-clock' else 16000000)
    initial_gpio={0:0xfff7f153,4:0x18,8:0xc0030,12:0x10,36:0,20:0x1c}
    for off,v in initial_gpio.items():word(B+off,v)
    word(0x50000014,0x48)
    for a,v in ((U,0),(U+4,0),(U+8,0),(U+12,initial_brr),(U+44,0),(0x4002103c,0x00101008),(0x40021054,0xa5000003),
      (0x40021008,0x12),(0x4002100c,0x32020802),(0xe000e010,7),(0xe000e014,63999)):word(a,v)
    changes={'tick-disabled':(0xe000e010,5),'tick-reload':(0xe000e014,63998),'clock':(0x40021008,0),
      'clock-source':(0x40021054,0x10),'uart-live':(U,1),'uart-layout':(U+8,0x1000),'gpio-not-output':(B,initial_gpio[0]&~0xc0000)}
    if case in changes:word(*changes[case])
    original={a:get(a) for a in (U,U+4,U+8,U+12,U+44,B,B+4,B+8,B+12,B+36,0x4002103c,0x40021054,0xe000e010,0xe000e014)}
    regs=(UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11)
    for i,r in enumerate(regs):u.reg_write(r,0xa1000000+i)
    u.reg_write(UC_ARM_REG_SP,0x20002c00);u.reg_write(UC_ARM_REG_PRIMASK,int(case=='interrupts-masked'))
    expected=[tuple(a) for a in extract(stock_wrapped)['actions']];actions=[];tx=[];rx=[];ticks=0;total_delay=0;last_gpio=None
    model={'time':1000,'injected':False,'cleaning':False,'error':0,'polls':0,'flushAfterTx':0}
    valid=case in ('left-valid','right-valid','left-115200','right-115200','echo-valid','wrapped-valid','gpio-restore','uart-restore','one-shot-second-call','right-after-left-fallback')
    echo=case in ('echo-only','echo-valid','wrong-baud-echo')
    no_output=case in ('unarmed','bad-complement','bad-payload','bad-schema','bad-config-crc','route-mismatch')
    guard=case in ('scheduler-stopped','interrupts-masked','reset-flag-missing','tick-disabled','tick-reload','clock','clock-source','core-clock','uart-live','uart-layout','gpio-not-output')
    def ret(v=0):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
    def visit(uc,a,size,unused):
        nonlocal ticks,total_delay,last_gpio
        if a==0x08004e9e:
            base,mask,value=(u.reg_read(r) for r in (UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2))
            assert (base,mask) in ((0x50000000,8),(B,512)) and value in (0,1)
            actions.append((int(base==B),value));last_gpio=(base,mask,value)
        elif a==0x0800a7a2:actions.append((3,u.reg_read(UC_ARM_REG_R0)))
        elif a==0x0800a7b0:
            n=u.reg_read(UC_ARM_REG_R0)
            if n!=5:actions.append((2,n))
        elif a==0x0800c128:
            n=u.reg_read(UC_ARM_REG_R0);assert n in (1,5,10,40)
            total_delay+=n;model['time']+=n;word(0x20000120,model['time'])
            if n==5:
                if case=='reset-flag-lost':u.mem_write(0x200000bc,b'\x00')
                if case=='clock-lost':word(0x4002103c,get(0x4002103c)&~(1<<18))
                if case=='uart-stolen':word(U+12,333)
                if case=='gpio-stolen':word(B,get(B)&~0xc0000)
                if case=='late-status' and not model['injected']:rx.extend(frame());model['injected']=True
            else:ticks+=n
            ret()
        else:
            assert (0x20010000<=a<0x20010000+len(hook) or 0x0800d9d0<=a<0x08000000+len(patched)
             or 0x0800b678<=a<=0x0800b7e0 or 0x0800a7a2<=a<0x0800a7d2 or 0x0800ca4c<=a<0x0800ca66
             or 0x08004e9e<=a<0x08004eac or a in (0x08009afa,0x08009b10)),hex(a)
    def read(uc,access,a,size,value,unused):
        if a==0x20000120:
            word(a,model['time']);model['time']+=1
        if a==U+28:
            cr=get(U);enabled=bool(get(0x4002103c)&(1<<18)) and bool(cr&1)
            value=(0x80 if case!='tx-timeout' else 0)|0x40
            if enabled and case!='rx-not-ready':value|=(0x200000 if cr&4 else 0)|(0x400000 if cr&8 else 0)
            if rx and enabled and cr&4:value|=32
            if case=='rx-overrun' and len(tx)>=8:model['error']|=8
            word(a,value|model['error'])
        if a==U+36:
            assert rx and get(U)&4,'read without armed RX';word(a,rx.pop(0))
        if model['cleaning'] and a==B and case=='gpio-restore':word(a,get(a)&~0xc0000)
        if model['cleaning'] and a==U+12 and case=='uart-restore':word(a,65)
    def write(uc,access,a,size,v,unused):
        if 0x20002000<=a and a+size<=0x20002c00 or 0x20011a00<=a and a+size<=0x20011c00 or 0x20011f00<=a and a+size<=0x20011f08:return
        if a==0x40003000:assert v==0xaaaa;return
        if a==0x4002103c:assert not (get(a)^v)&~(1<<18);return
        if a in (B,B+4,B+8,B+12,B+36):
            mask=0x300 if a==B+4 else 255 if a==B+36 else 0xf0000
            assert not (get(a)^v)&~mask,hex(a);return
        if a in (0x50000018,0x50000028,B+24,B+40):
            base=a&~0x3ff
            if base!=B:assert last_gpio==(base,8,1) and v==8
            mask=0x300 if base==B else 8
            assert not (v&0xffff)&~mask and not (v>>16)&~mask
            old=get(base+20)
            if a-base==24:word(base+20,(old|(v&0xffff))&~(v>>16))
            else:word(base+20,old&~v)
            return
        assert U<=a<U+48, f'unreviewed peripheral write {a:x}'
        if a==U:
            assert v in (0,5,13)
            if not v and tx:model['cleaning']=True
        elif a in (U+4,U+8,U+44):assert v==0
        elif a==U+12:assert v in (0,64,556)
        elif a==U+24:
            assert v==8 and not tx,'post-TX RX flush';rx.clear()
        elif a==U+32:assert not v&~15;model['error']&=~v
        elif a==U+40:
            assert get(U)&13==13 and not get(U+8)&0x1000 and get(U+12)==(556 if baud==115200 else 64)
            assert get(B)&0xf0000==0xa0000 and get(B+36)&255==0x44
            assert actions[:103]==expected,'UART TX before complete actual native pulse'
            assert v==HELLO[len(tx)%8] and len(tx)<8*attempt_limit,'non-HELLO byte or excessive TX'
            tx.append(v)
            if echo:rx.append(v)
            if len(tx)==8 and not model['injected'] and (valid or case in ('bad-crc','truncated')):
                b=frame()
                if case=='bad-crc':b=b[:-1]+bytes([b[-1]^1])
                if case=='truncated':b=b[:40]
                if case=='wrapped-valid':b=b'\xa9'*200+b
                rx.extend(b);model['injected']=True
        else:raise AssertionError(hex(a))
    u.hook_add(UC_HOOK_CODE,visit);u.hook_add(UC_HOOK_MEM_READ,read);u.hook_add(UC_HOOK_MEM_WRITE,write)
    calls=[0x08009b10 if route=='right' and case!='route-mismatch' else 0x08009afa]
    if case=='one-shot-second-call':calls.append(calls[0])
    if case=='right-after-left-fallback':calls=[0x08009afa,0x08009b10]
    for site in calls:
        u.emu_start(site|1,site+4,count=15000000)
        assert u.reg_read(UC_ARM_REG_PC)==site+4 and u.reg_read(UC_ARM_REG_SP)==0x20002c00
        assert [u.reg_read(r) for r in regs]==[0xa1000000+i for i in range(8)]
        assert u.reg_read(UC_ARM_REG_PRIMASK)==int(case=='interrupts-masked')
    assert actions==expected*len(calls)
    evidence=None
    if no_output:assert bytes(u.mem_read(0x20011a00,512))==bytes(512) and not tx
    else:
        evidence=decode(bytes(u.mem_read(0x20011a00,512)))
        assert evidence['nonce']==0x11223344 and bytes(u.mem_read(0x20011f00,8))==bytes(8)
        if guard:assert evidence['status']==1 and not tx
        elif case in ('rx-not-ready','tx-timeout','rx-overrun','gpio-restore','uart-restore','reset-flag-lost','clock-lost','uart-stolen','gpio-stolen'):
            assert evidence['status']!=0,(case,evidence)
        else:
            assert evidence['status']==0 and evidence['nativeContextVerified'] and evidence['exactPeripheralRestorationVerified'],(case,evidence)
            assert bool(evidence['discovery']['statusFrames'])==(valid or case=='late-status'),(case,evidence)
        if case in ('silence','echo-only','bad-crc','truncated','wrong-baud-echo'):assert len(tx)==8*attempt_limit
        if case in ('echo-only','wrong-baud-echo'):assert evidence['rawCaptureHex']==(HELLO*min(attempt_limit,16)).hex() and evidence['totalReceiveBytes']==8*attempt_limit
        if case in ('reset-flag-lost','clock-lost','uart-stolen','gpio-stolen'):assert len(tx)==8
        if not guard:
            assert get(0x4002103c)==original[0x4002103c] and get(0xe000e010)==original[0xe000e010] and get(0xe000e014)==original[0xe000e014]
    return {'case':case,'passed':True,'actualNativePulseCalls':len(calls),'actualNativeActions':len(actions),'nominalNativeDelayTicksFixture':ticks,
      'txHex':bytes(tx).hex(),'evidence':evidence,'noRtosTickWrites':True,'abiReturnVerified':True,
      'boundary':'Actual guard/hook/pulse/GPIO/busy/osDelay wrapper/scheduler getter instructions; kernel/task delays, HAL time and UART/FIFO effects are fixtures. No protected SBL, complete RTOS or physical reset/timing proved.'}

def validate(stock,patched,hook):
    for case in CASES:
        r=run(stock,patched,hook,case);print(f'PASS {case}',flush=True);yield r
