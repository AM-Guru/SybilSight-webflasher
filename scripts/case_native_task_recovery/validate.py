"""Execute guarded hook plus actual stock pulse; RTOS scheduling is a fixture."""
import struct
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11,UC_ARM_REG_PRIMASK
from case_native_task_recovery.protocol import configuration,decode
from case_sbl_reset_prepared.trace import extract,fnv

CASES=('left','right','unarmed','bad-complement','bad-payload','bad-config-checksum',
       'bad-schema','bad-route','bad-brr','zero-nonce','reserved-nonzero',
       'route-mismatch','scheduler-stopped','interrupts-masked','reset-flag-missing',
       'one-shot-second-call','right-after-left-fallback')

def run(stock_wrapped,patched,hook,case):
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x08000000,0x10000);u.mem_write(0x08000000,patched)
    u.mem_map(0x20000000,0x24000);u.mem_write(0x20010000,hook)
    u.mem_map(0x40000000,0x30000);u.mem_map(0x50000000,0x2000)
    route='right' if case in ('right','route-mismatch','right-after-left-fallback') else 'left'
    cfg=bytearray(configuration(route,1000000,0x11223344))
    if case=='unarmed':cfg[:8]=bytes(8)
    if case=='bad-complement':cfg[4]^=1
    if case=='bad-config-checksum':cfg[28]^=1
    changes={'bad-schema':(2,8),'bad-route':(3,2),'bad-brr':(4,0),'zero-nonce':(5,0),'reserved-nonzero':(6,1)}
    if case in changes:
        index,value=changes[case];struct.pack_into('<I',cfg,4*index,value)
        struct.pack_into('<I',cfg,28,fnv(cfg[:28]))
    if case=='bad-payload':u.mem_write(0x20010010,bytes([hook[16]^1]))
    u.mem_write(0x20011f00,bytes(cfg));u.mem_write(0x200000bc,bytes([0 if case=='reset-flag-missing' else 1]))
    # Real xTaskGetSchedulerState reads a stock RAM record; seed only its
    # two input fields. No claim that a complete FreeRTOS boot was executed.
    code=stock_wrapped[32:];kernel=struct.unpack_from('<I',code,0xca68)[0]
    def word(a,v):u.mem_write(a,struct.pack('<I',v))
    word(kernel+0x14,0 if case=='scheduler-stopped' else 1);word(kernel+0x30,0)
    word(0x20000120,1000)
    for a,v in [(0x40004800,0),(0x40004804,0),(0x40004808,0x1000),(0x4000480c,64),
                (0x50000400,0x40000),(0x50000408,0xc0000),(0x50000424,0x44)]:word(a,v)
    regs=(UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11)
    for i,r in enumerate(regs):u.reg_write(r,0xa1000000+i)
    u.reg_write(UC_ARM_REG_SP,0x20002c00);u.reg_write(UC_ARM_REG_PRIMASK,int(case=='interrupts-masked'))
    expected=extract(stock_wrapped)['actions'];actions=[];ticks=0;last_gpio=None
    def ret(v):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
    def visit(uc,address,size,unused):
        nonlocal ticks,last_gpio
        if address==0x08004e9e:
            base,mask,value=(u.reg_read(r) for r in (UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2))
            assert (base,mask) in ((0x50000000,8),(0x50000400,512)) and value in (0,1)
            actions.append((0 if base==0x50000000 else 1,value));last_gpio=(base,mask,value)
        elif address==0x0800a7a2:actions.append((3,u.reg_read(UC_ARM_REG_R0)))
        elif address==0x0800a7b0:actions.append((2,u.reg_read(UC_ARM_REG_R0)))
        elif address==0x0800c128:
            n=u.reg_read(UC_ARM_REG_R0);assert n in (1,10,40)
            ticks+=n;word(0x20000120,1000+ticks);ret(0)
        else:
            allowed=(0x20010000<=address<0x20010000+len(hook) or 0x0800d9d0<=address<0x08000000+len(patched)
              or 0x0800b678<=address<=0x0800b7e0 or 0x0800a7a2<=address<0x0800a7d2
              or 0x0800ca4c<=address<0x0800ca66 or 0x08004e9e<=address<0x08004eac
              or address in (0x08009afa,0x08009b10))
            assert allowed,f'unreviewed instruction {address:x}'
    def write(uc,access,address,size,value,unused):
        if address==0x20000120 or 0x20002000<=address<0x20002c00 or 0x20011a00<=address<0x20011b00 or 0x20011f00<=address<0x20011f08:return
        assert address in (0x50000018,0x50000028,0x50000418,0x50000428),f'unreviewed write {address:x}'
        base=address&~0x3ff;mask=value&0xffff
        assert last_gpio and (base,mask)==last_gpio[:2]
        old=struct.unpack('<I',u.mem_read(base+20,4))[0]
        high=address-base==24
        assert high==bool(last_gpio[2])
        word(base+20,(old|mask) if high else (old&~mask))
    u.hook_add(UC_HOOK_CODE,visit);u.hook_add(UC_HOOK_MEM_WRITE,write)
    calls=[0x08009b10 if route=='right' and case!='route-mismatch' else 0x08009afa]
    if case=='one-shot-second-call':calls.append(0x08009afa)
    if case=='right-after-left-fallback':calls=[0x08009afa,0x08009b10]
    for site in calls:
        u.emu_start(site|1,site+4,count=10000000)
        assert u.reg_read(UC_ARM_REG_PC)==site+4,'hook did not return to stock caller'
        assert u.reg_read(UC_ARM_REG_SP)==0x20002c00
        assert [u.reg_read(r) for r in regs]==[0xa1000000+i for i in range(len(regs))]
        assert u.reg_read(UC_ARM_REG_PRIMASK)==int(case=='interrupts-masked')
    assert actions==[tuple(a) for a in expected]*len(calls),(case,len(actions))
    raw=bytes(u.mem_read(0x20011a00,256))
    positive=case in ('left','right','one-shot-second-call','right-after-left-fallback')
    context_error=case in ('scheduler-stopped','interrupts-masked','reset-flag-missing')
    result=None
    if positive or context_error:
        result=decode(raw)
        assert result['status']==(2 if case in ('scheduler-stopped','reset-flag-missing') else 1 if context_error else 0),(case,result)
        assert bytes(u.mem_read(0x20011f00,8))==bytes(8)
    else:assert raw==bytes(256),case
    return {'case':case,'passed':True,'nativePulseCalls':len(calls),'nativeActionsExecuted':len(actions),
       'rtosDelayTicksFixture':ticks,'calleeSavedRegistersAndStackRestored':True,'evidence':result,
       'boundary':'Actual hook, guard, pulse, GPIO/busy helpers, osDelay wrapper and scheduler getter executed; task delay is intercepted, kernel fields/ticks are fixtures. No complete RTOS boot, physical timing or reset is proved.'}

def validate(stock_wrapped,patched,hook):return [run(stock_wrapped,patched,hook,c) for c in CASES]
