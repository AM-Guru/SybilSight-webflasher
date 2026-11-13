"""Read-only native-task HELLO configuration and evidence schema11."""
import struct
from case_sbl_reset_prepared.trace import fnv
from g2_sbl_protocol import classify_capture

def configuration(route,baud,nonce):
    if route not in ('left','right') or baud not in (1000000,115200) or not 0<nonce<2**32:raise ValueError('unsupported HELLO configuration')
    b=struct.pack('<7I',0x4b483247,0xb4b7cdb8,11,int(route=='right'),64 if baud==1000000 else 556,nonce,20)
    return b+struct.pack('<I',fnv(b))

def decode(data):
    if len(data)!=512 or fnv(data[:508])!=struct.unpack_from('<I',data,508)[0]:raise ValueError('HELLO evidence size/checksum differs')
    w=struct.unpack_from('<64I',data)
    if w[:2]!=(0x31484e47,11) or w[3]!=5 or w[5]>1 or w[6] not in (64,556) or not w[7] or w[4]!=(0x08009b15 if w[5] else 0x08009aff):raise ValueError('HELLO caller/config/phase differs')
    if w[2]>9 or w[18]>20 or w[19]>8*w[18] or w[21]!=w[20]%128 or w[23]>1:raise ValueError('HELLO capture bounds differ')
    raw=data[256:384];n=min(w[20],128);raw=raw[w[21]:]+raw[:w[21]] if n==128 else raw[:n]
    discovery=classify_capture(raw)
    if bool(w[23])!=bool(discovery['statusFrames']):raise ValueError('host/compiled STATUS validation differs')
    context=w[8:14]==(0,0,2,2,1,1) and w[26:28]==(0,0)
    clock=w[30:32]==(7,63999) and w[58:60]==(0x12,0x32020802) and not (w[57]|w[61])&0x30
    restored=w[24]==7 and w[62:64]==(1,1) and (w[56]^w[60])&(1<<18)==0 and w[30:32]==w[32:34]
    if w[2]==0 and (not context or not clock or not restored or w[25]!=3 or w[22] or not w[18] or w[19]!=8*w[18] or w[28]!=w[18]-1 or w[34:39]!=(0,0,0,64,0) or not w[23] and w[18]!=20):raise ValueError('success lacks context, complete exchange or cleanup')
    return {'status':w[2],'route':'right' if w[5] else 'left','caller':hex(w[4]),'brr':w[6],'nonce':w[7],
      'probeQualified':w[2]==0 and context and clock and restored and not w[22],
      'nativeContextVerified':context,'exactPeripheralRestorationVerified':restored,
      'nativePulseHalTicks':(w[15]-w[14])&0xffffffff,'pulseReturnToFirstTxHalTicks':(w[16]-w[15])&0xffffffff if w[19] else None,
      'helloAttempts':w[18],'templeBytesSent':w[19],'totalReceiveBytes':w[20],'uartErrorMask':w[22],
      'rtosYields':w[28],'rawCaptureHex':raw.hex(),'discovery':discovery,
      'uartBefore':list(w[34:39]),'uartAfter':list(w[39:44]),'gpioBefore':list(w[44:50]),'gpioAfter':list(w[50:56]),
      'rtosTickReconfigured':False,'physicalApolloResetVerified':False,'glassesFirmwareImageBytesSent':0,'retailRecoveryVerified':False}
