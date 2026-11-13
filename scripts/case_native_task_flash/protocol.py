"""Fixed-address writer request and checksummed result, usable without serial."""
import struct
from case_sbl_reset_prepared.trace import fnv

def request(page,mode,nonce):
    if page not in (0,1) or mode not in (0,1,2) or not 0<nonce<2**32:raise ValueError('unsupported fixed-page request')
    body=struct.pack('<7I',0x46573247,0xb9a8cdb8,10,page,mode,nonce,0)
    return body+struct.pack('<I',fnv(body))

def decode(raw):
    if len(raw)!=256:raise ValueError('wrong writer result size')
    w=struct.unpack('<64I',raw)
    if w[:2]!=(0x31574647,10) or w[3]!=100 or fnv(raw[:252])!=w[63]:raise ValueError('writer result checksum/schema/phase')
    if w[2]>12:raise ValueError('unknown writer status')
    if w[2]==0 and (w[4] not in (0x08009800,0x0800d800) or w[5]>2 or w[17]>1 or not w[6] or w[16] or w[15]!=0xc0000000):raise ValueError('incomplete successful writer context')
    if w[2]==0 and w[9]!=(w[7] if w[5]==2 else w[8]):raise ValueError('successful writer readback differs')
    return {'status':w[2],'stage':w[3],'address':hex(w[4]),'mode':w[5],'nonce':w[6],
      'beforeFnv':w[7],'targetFnv':w[8],'afterFnv':w[9],'eraseStarts':w[10],
      'programDoublewords':w[11],'controllerRestored':bool(w[12]),'finalSr':hex(w[14]),
      'finalCr':hex(w[15]),'busyAtEnd':bool(w[16]),'page':w[17],
      'originalMatchedBefore':bool(w[18]),'targetMatchedBefore':bool(w[19])}
