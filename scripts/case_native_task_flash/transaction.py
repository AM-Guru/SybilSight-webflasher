"""Case-context transaction policy, independently testable without hardware."""

def trial(io,originals,patched,*,restore_only=False):
    result={'context':None,'error':None,'restoreErrors':[], 'pagesRestored':False,
      'fullStockVerified':False,'sramRestored':False,'stockBooted':False}
    may_have_mutated=restore_only
    precondition_verified=False
    try:
        if not restore_only:
            for page in (0,1):
                if io.read_page(page)!=originals[page]:raise ValueError('precondition: page differs from original')
            precondition_verified=True
            for page in (1,0):
                may_have_mutated=True
                io.write_page(page,0)
                if io.read_page(page)!=patched[page]:raise ValueError('patched page readback differs')
            result['context']=io.observe_context()
    except Exception as error:
        result['error']=str(error)
        if hasattr(io,'record_error'):
            try:io.record_error(error)
            except Exception as journal_error:result['restoreErrors'].append({'journal':str(journal_error)})
    finally:
        if may_have_mutated:
            # Restore call sites before removing their guard. Never remove the
            # guard while a failed/uncertain call-site restoration remains.
            for page in (0,1):
                try:
                    if io.read_page(page)!=originals[page]:io.write_page(page,1)
                    if io.read_page(page)!=originals[page]:raise ValueError('original page readback differs')
                except Exception as error:
                    result['restoreErrors'].append({'page':page,'error':str(error)})
                    break
        if may_have_mutated or precondition_verified:
            try:
                result['pagesRestored']=all(io.read_page(page)==originals[page] for page in (0,1))
                if result['pagesRestored']:
                    io.verify_stock();result['fullStockVerified']=True
            except Exception as error:result['restoreErrors'].append({'verification':str(error)})
        if result['fullStockVerified']:
            try:io.restore_sram();result['sramRestored']=True
            except Exception as error:result['restoreErrors'].append({'sram':str(error)})
            # Original flash is verified even if volatile SRAM restoration
            # fails. Booting stock here restores normal case operation.
            try:io.boot_stock();result['stockBooted']=True
            except Exception as error:result['restoreErrors'].append({'boot':str(error)})
        else:
            try:io.hold_rom()
            except Exception as error:result['restoreErrors'].append({'holdRom':str(error)})
    return result
