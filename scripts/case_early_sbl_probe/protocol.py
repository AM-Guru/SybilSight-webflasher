"""Early-armed fixed HELLO framing and retained evidence, with no writer."""
import struct
import zlib
from g2_sbl_protocol import HELLO,classify_capture

PROFILES={'reviewed-22':0,'observed-33':1,'observed-33-entry1':2,'observed-45':3}

def fnv(data):
    value=2166136261
    for byte in data:value=((value^byte)*16777619)&0xffffffff
    return value

def ready_bytes(m):
    config=6|(int(m['route']=='right')<<8)|(PROFILES[m['profile']]<<16)|0x03000000
    body=struct.pack('<7I',0x48453247,config,64 if m['nominalBaud']==1000000 else 556,20,400,8,fnv(HELLO))
    return body+struct.pack('<I',zlib.crc32(body)&0xffffffff)

def parse_ready(data,m):
    if data!=ready_bytes(m):raise ValueError('early HELLO readiness CRC/configuration mismatch')
    return {'valid':True,'route':m['route'],'nominalBaud':m['nominalBaud'],
            'receiveMode':'early-armed','overrunReporting':'enabled','operation':'fixed-hello-only'}

def decode_result(data,m):
    if len(data)!=256 or fnv(data[:252])!=struct.unpack_from('<I',data,252)[0]:raise ValueError('retained size/checksum mismatch')
    w=struct.unpack_from('<12I',data);r=struct.unpack_from('<13I',data,200)
    if w[:2]!=(0x31454253,6):raise ValueError('wrong early HELLO retained schema')
    if w[9]>20 or w[10]>w[9]*8 or w[11] not in (0,1) or data[68]!=1 or data[69]&~26 or data[70]>1 or data[71]>1:
        raise ValueError('unexpected fixed HELLO counters or transport metadata')
    if w[3]!=min(r[8],128) or r[10]!=r[8]%128:raise ValueError('invalid capture counters')
    raw=data[72:200];raw=raw[r[10]:]+raw[:r[10]] if w[3]==128 else raw[:w[3]]
    discovery=classify_capture(raw)
    if bool(w[11])!=bool(discovery['statusFrames']):raise ValueError('compiled/host STATUS checks disagree')
    gpio=bool(data[69]&16) and r[11]==r[12]
    restored=w[5]==w[6]==0x3ff and not w[8] and data[48:58]==data[58:68] and gpio
    if w[9] and (r[5],r[6],r[7])!=(int(m['route']=='left'),64 if m['nominalBaud']==1000000 else 556,20):
        raise ValueError('executed route/baud/schedule mismatch')
    if w[2]==0 and (data[69]!=26 or data[70]!=1 or data[71]!=1 or not restored or w[7] or not w[9] or
            w[10]!=w[9]*8 or (not w[11] and w[9]!=20)):
        raise ValueError('success lacks bounded transaction and restoration proof')
    return {'status':w[2],'uartErrorMask':w[7],'helloRequests':w[9],'templeBytesSent':w[10],
        'totalReceiveBytes':r[8],'rawCaptureHex':raw.hex(),'discovery':discovery,
        'gpioRestorationVerified':gpio,'exactRestorationVerified':restored,
        'baselineHex':data[48:58].hex(),'restoredHex':data[58:68].hex(),
        'receiveMode':'early-armed','overrunDetectionConfigured':bool(data[70]),
        'earlyReceiveAcknowledgedBeforeTx':bool(data[71]),
        'templeResetImplemented':False,'firmwareWriteImplemented':False}
