"""Execute writer code with exact register/write allowlists and fault fixtures."""
import struct
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE,UC_HOOK_MEM_READ
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP
from case_native_task_flash.protocol import request,decode
from case_sbl_reset_prepared.trace import fnv
CASES=('patch0','patch1','restore0','restore1','partial-restore0','partial-restore1',
 'qualify0','qualify1','already-patched','wrong-uid','wrong-options','wrong-size','bad-initial-cr',
 'bad-checksum','bad-page','bad-mode','zero-nonce','unknown-current','qualify-nonstock',
 'unlock-failed','erase-error','erase-incomplete','program-error','readback-corrupt',
 'initial-busy','erase-busy','program-busy')

def run(payload,pages,case):
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x20010000,0x8000);u.mem_write(0x20010000,payload)
    u.mem_map(0x08000000,0x80000);u.mem_write(0x08000000,b'\xa5'*0x80000)
    u.mem_map(0x1fff7000,0x1000);u.mem_map(0x40000000,0x30000)
    def word(a,v):u.mem_write(a,struct.pack('<I',v))
    for i,v in enumerate((0x00230040,0x58455016,0x20373941)):word(0x1fff7590+4*i,v)
    word(0x1fff75e0,512);word(0x40022020,0xdeefe1aa);word(0x40022000,0x600)
    page=int(case.endswith('1'));mode=1 if 'restore' in case else 2 if 'qualify' in case else 0
    cfg=bytearray(request(page,mode,0x11223344))
    if case=='bad-checksum':cfg[28]^=1
    bad={'bad-page':(3,2),'bad-mode':(4,3),'zero-nonce':(5,0)}
    if case in bad:
        i,v=bad[case];struct.pack_into('<I',cfg,4*i,v);struct.pack_into('<I',cfg,28,fnv(cfg[:28]))
    u.mem_write(0x20013f00,bytes(cfg))
    address=0x0800d800 if page else 0x08009800
    for i,a in enumerate((0x08009800,0x0800d800)):u.mem_write(a,pages[i][0])
    if mode==1 or case in ('already-patched','qualify-nonstock'):u.mem_write(address,pages[page][1])
    if case.startswith('partial-restore'):u.mem_write(address,b'\x00'*1000+b'\xff'*1048)
    if case=='unknown-current':u.mem_write(address,b'\x00'*2048)
    if case=='wrong-uid':word(0x1fff7590,0)
    if case=='wrong-options':word(0x40022020,0xdeffe1aa)
    if case=='wrong-size':word(0x1fff75e0,256)
    before=bytes(u.mem_read(0x08000000,0x80000))
    model={'cr':0xc0000000 if case!='bad-initial-cr' else 0x40000000,
      'sr':0x20000 if case=='initial-busy' else 0,'keys':[],'erases':0,'doublewords':0,'pending':None,'low':None,'finished':False}
    writes=[]
    def read(uc,access,a,size,value,unused):
        if a==0x40022014:word(a,model['cr'])
        if a==0x40022010:word(a,model['sr'])
        if 0x08000000<=a<0x08080000:assert not model['sr']&0x70000,'flash read while busy'
    def code(uc,a,size,unused):
        assert 0x20010008<=a<0x20010000+len(payload),f'escaped SRAM instructions {a:x}'
        if model['pending']:
            dest,data=model['pending'];u.mem_write(dest,data);model['pending']=None
    def write(uc,access,a,size,v,unused):
        if 0x20017000<=a and a+size<=0x20018000:return
        if 0x20013a00<=a and a+size<=0x20013b00:return
        if 0x20013f00<=a and a+size<=0x20013f08:return
        if a==0x40003000:
            assert v==0xaaaa
            if struct.unpack('<I',u.mem_read(0x20013a0c,4))[0]==100:
                decode(bytes(u.mem_read(0x20013a00,256)));model['finished']=True;u.emu_stop()
            return
        writes.append((a,size,v))
        if a==0x40022000:
            assert size==4 and v&~0xb07==0x400,'unexpected cache/latency/control change';return
        if a==0x40022008:
            assert size==4;model['keys'].append(v);assert model['keys'] in ([0x45670123],[0x45670123,0xcdef89ab])
            if len(model['keys'])==2 and case!='unlock-failed':model['cr']&=~0x80000000
            return
        if a==0x40022010:
            assert size==4 and v==0x883fb;model['sr']&=~v;return
        if a==0x40022014:
            assert size==4 and not model['sr']&0x70000,'controller write while busy'
            assert v in (0xc0000000,0x40000000,0x40000001,0x40012002|((27 if page else 19)<<3))
            model['cr']=v
            if v&0x10000:
                assert not v&0x80000000 and v&0x2000 and model['erases']==0
                model['erases']+=1;u.mem_write(address,b'\xff'*2048);model['cr']&=~0x10000
                if case=='erase-error':model['sr']=2
                if case=='erase-incomplete':u.mem_write(address+2044,b'\x00'*4)
                if case=='erase-busy':model['sr']=0x20000
            return
        assert address<=a and a+size<=address+2048 and size==4,f'out-of-scope write {a:x}'
        assert model['cr']==0x40000001 and model['erases']==1
        target=pages[page][1 if mode==0 else 0];off=a-address
        assert struct.pack('<I',v)==target[off:off+4]
        if off%8==0:
            assert model['low'] is None;model['low']=a
        else:
            assert model['low']==a-4;model['low']=None;model['doublewords']+=1
            if case=='program-error' and model['doublewords']==2:model['sr']=2
            if case=='program-busy' and model['doublewords']==2:model['sr']=0x20000
            if case=='readback-corrupt' and model['doublewords']==2:model['pending']=(a,struct.pack('<I',v^1))
    u.hook_add(UC_HOOK_CODE,code);u.hook_add(UC_HOOK_MEM_READ,read);u.hook_add(UC_HOOK_MEM_WRITE,write)
    stack,entry=struct.unpack_from('<II',payload)
    assert (stack,entry)==(0x20018000,0x20010009)
    u.reg_write(UC_ARM_REG_SP,stack);u.emu_start(entry,0,count=50000000)
    assert model['finished'],'writer exceeded bounded instruction budget'
    result=decode(bytes(u.mem_read(0x20013a00,256)))
    expected={'wrong-uid':2,'wrong-options':3,'wrong-size':4,'bad-initial-cr':5,
      'bad-checksum':1,'bad-page':1,'bad-mode':1,'zero-nonce':1,'unknown-current':7,
      'qualify-nonstock':7,'unlock-failed':8,'erase-error':9,'erase-incomplete':12,
      'program-error':10,'readback-corrupt':11,'initial-busy':6,'erase-busy':9,'program-busy':10}.get(case,0)
    assert result['status']==expected,(case,result)
    after=bytes(u.mem_read(0x08000000,0x80000));offset=address-0x08000000
    assert after[:offset]==before[:offset] and after[offset+2048:]==before[offset+2048:],'other page changed'
    if expected==0:
        assert after[offset:offset+2048]==pages[page][0 if mode in (1,2) else 1]
    if case.startswith('qualify') or case in ('already-patched','wrong-uid','wrong-options','wrong-size','bad-initial-cr','bad-checksum','bad-page','bad-mode','zero-nonce','unknown-current','initial-busy'):
        assert not writes and before==after,'rejected/read-only request mutated controller or flash'
    if case in ('erase-busy','program-busy'):assert result['busyAtEnd'] and not result['controllerRestored']
    return {'case':case,'passed':True,'result':result,'controllerModelErases':model['erases'],
      'controllerModelDoublewords':model['doublewords'],'otherFlashPreserved':True,
      'boundary':'Actual SRAM instructions executed; erase/program/busy/error effects are register fixtures, not hardware qualification.'}

def validate(payload,pages):
    for case in CASES:yield run(payload,pages,case)
