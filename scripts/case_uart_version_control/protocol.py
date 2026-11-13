"""Fixed read-only application-version control; no recovery or image writes."""
import struct
import zlib
from g2_stock_case_diagnostics import decode_versions, VERSION_REQUESTS

POGO_REQUESTS={side:packet[4:] for side,packet in VERSION_REQUESTS.items()}

PROFILES={"reviewed-22":0,"observed-33":1,"observed-33-entry1":2,"observed-45":3}
RECEIVE_MODES={'native-turnaround':0,'early-armed':1}

def fnv(data):
    h=2166136261
    for byte in data: h=((h^byte)*16777619)&0xffffffff
    return h

def ready_bytes(m):
    request=POGO_REQUESTS[m['route']]
    config=5|(int(m['route']=='right')<<8)|(PROFILES[m['profile']]<<16)|(RECEIVE_MODES[m['receiveMode']]<<24)|0x02000000
    body=struct.pack('<7I',0x43563247,config,64,1,400,5,fnv(request))
    return body+struct.pack('<I',zlib.crc32(body)&0xffffffff)

def parse_ready(data,m):
    if data!=ready_bytes(m): raise ValueError('version control readiness CRC/configuration mismatch')
    return {'valid':True,'route':m['route'],'nominalBaud':1000000,'operation':'fixed-application-version-only',
        'receiveMode':m['receiveMode'],'overrunReporting':'enabled'}

def decode_result(data,m):
    if len(data)!=256 or fnv(data[:252])!=struct.unpack_from('<I',data,252)[0]:
        raise ValueError('version result length/checksum mismatch')
    w=struct.unpack_from('<12I',data)
    r=struct.unpack_from('<13I',data,200)
    if w[:2]!=(0x32435256,5): raise ValueError('wrong version-control retained schema')
    flags=data[69]
    if w[9]>1 or w[10]>5*w[9] or w[11] not in (0,1) or flags&~26:
        raise ValueError('unexpected transaction/reset fields')
    mode=RECEIVE_MODES[m['receiveMode']]
    if data[68]!=mode or data[70]>1 or data[71]>mode: raise ValueError('unexpected transport metadata')
    if w[3]!=min(r[8],128) or r[10]!=r[8]%128: raise ValueError('invalid capture counters')
    raw=data[72:200]
    raw=raw[r[10]:]+raw[:r[10]] if w[3]==128 else raw[:w[3]]
    versions=decode_versions(raw)
    if bool(w[11])!=bool(versions): raise ValueError('compiled and host version checks disagree')
    gpio=bool(flags&16) and r[11]==r[12]
    restored=w[5]==w[6]==0x3ff and not w[8] and data[48:58]==data[58:68] and gpio
    if w[9] and (r[5],r[6],r[7])!=(int(m['route']=='left'),64,1): raise ValueError('route/schedule mismatch')
    if w[2]==0 and (flags!=26 or data[70]!=1 or data[71]!=mode or not restored or w[9]!=1 or w[10]!=5 or w[7]):
        raise ValueError('success lacks complete transaction/restoration proof')
    return {'status':w[2],'uartErrorMask':w[7],'requestsSent':w[9],'templeBytesSent':w[10],
        'totalReceiveBytes':r[8],'rawCaptureHex':raw.hex(),'versions':versions,
        'gpioRestorationVerified':gpio,'exactRestorationVerified':restored,
        'baselineHex':data[48:58].hex(),'restoredHex':data[58:68].hex(),
        'receiveMode':m['receiveMode'],'overrunDetectionConfigured':bool(data[70]),
        'earlyReceiveAcknowledgedBeforeTx':bool(data[71]),
        'templeResetImplemented':False,'firmwareWriteImplemented':False}
