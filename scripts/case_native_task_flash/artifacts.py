"""Offline writer inspection. This module never imports a serial transport."""
import json,os
from pathlib import Path
from case_native_task_flash.build import CASE_SERIAL,load_pages,source_paths,sha
from case_native_task_flash.validate import CASES
ROOT=Path(__file__).resolve().parent

def inspect(build,plan,context,reference):
    m=json.loads((build/'validated-writer.json').read_text());payload=(build/'writer.bin').read_bytes()
    if m.get('operation')!='compiled-exact-case-page-writer' or m.get('caseSerial')!=CASE_SERIAL or m.get('passed') is not True:raise ValueError('unqualified writer report')
    if (m.get('payloadBytes'),m.get('payloadSha256'))!=(len(payload),sha(payload)) or len(payload)>=0x3800:raise ValueError('writer identity/bounds differ')
    if {os.path.relpath(p,ROOT):sha(p.read_bytes()) for p in source_paths()}!=m.get('sourceHashes'):raise ValueError('writer/validator source changed')
    if len(m['cases'])!=len(CASES) or {r['case'] for r in m['cases']}!=set(CASES) or not all(r['passed'] for r in m['cases']):raise ValueError('incomplete writer coverage')
    pages=load_pages(plan,context,reference)
    if sha((build/'pages.h').read_bytes())!=m.get('pagesHeaderSha256'):raise ValueError('compiled page header changed')
    return m,payload,pages
