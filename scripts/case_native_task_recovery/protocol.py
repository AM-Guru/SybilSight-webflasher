"""Offline one-shot configuration and native task evidence."""
import struct
from case_sbl_reset_prepared.trace import fnv
MAGIC=0x4b483247

def configuration(route,baud,nonce):
    if route not in ('left','right') or baud not in (1000000,115200) or not 0<nonce<2**32:raise ValueError('unsupported one-shot configuration')
    body=struct.pack('<7I',MAGIC,MAGIC^0xffffffff,9,int(route=='right'),64 if baud==1000000 else 556,nonce,0)
    return body+struct.pack('<I',fnv(body))

def decode(data):
    if len(data)!=256 or fnv(data[:252])!=struct.unpack_from('<I',data,252)[0]:raise ValueError('native-task evidence checksum/size mismatch')
    w=struct.unpack('<64I',data)
    if w[:2]!=(0x3143544e,9) or w[3]!=3 or w[5]>1 or w[6] not in (64,556) or w[4]!=(0x08009b15 if w[5] else 0x08009aff) or not w[7]:raise ValueError('unexpected native task phase/caller/config')
    if w[2]==0 and (w[8:12]!=(0,0,2,2) or w[14:16]!=(1,1)):raise ValueError('success lacks running task/reset-context evidence')
    return {'status':w[2],'nativePulseReturned':True,'caller':hex(w[4]),'route':'right' if w[5] else 'left',
      'brr':w[6],'nonce':w[7],'ipsr':w[8],'primask':w[9],'schedulerBefore':w[10],'schedulerAfter':w[11],
      'halTickBefore':w[12],'halTickAfter':w[13],'halTickDelta':(w[13]-w[12])&0xffffffff,
      'resetFlagBefore':w[14],'resetFlagAfter':w[15],'uartBefore':list(w[16:20]),'uartAfter':list(w[20:24]),
      'gpioBefore':list(w[24:31]),'gpioAfter':list(w[31:38]),'templeQueryBytesSent':0,'firmwareImageBytesSent':0,
      'physicalApolloResetVerified':False,'retailRecoveryVerified':False}
