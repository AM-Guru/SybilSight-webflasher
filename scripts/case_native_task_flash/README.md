# Exact-page case writer prototype

This is the scoped backend for the native RTOS-task reset experiment. It is
not a glasses firmware uploader. The hook was temporarily installed during
three trials and is now removed; original case code/pages/mirrors and SRAM are restored.

`build.py` embeds four exact 2048-byte page images: original and patched forms
of logical pages `0x08009800` and `0x0800D800`. They must match the pinned stock
case reference and the validated context-hook build. Requests contain only a
page index, mode, nonce and checksum; they cannot supply an address or image.
The SRAM payload checks the exact case UID, flash size, effective OPTR and
initial locked controller state before proceeding. It uses physical bank2 and
bank-local pages19/27, following the audited stock bank-selection code. It does
not use ROM Extended Erase or infer its host page-index mapping.

Mode0 permits patching only an exact original page (or returns if the exact
target is already present). Mode1 restores the embedded original, including
from a partial page. Mode2 qualifies an exact original page without writing
FLASH registers or starting erase/program operations. The production payload
has bounded busy loops, checks error flags and exact readback, skips erased
doublewords, and relocks/restores controller/cache settings when idle. On a
busy timeout it leaves the busy controller untouched and reports that state.
Checksums provide transport/evidence integrity, not firmware authentication.

All27 emitted-code scenarios passed in the web build and again through
`g2-firmware-emulator/scripts/probe-case-page-writer.py`. These execute the
compiled SRAM code with modeled controller semantics: both pages, patch and
restore, partial restoration, wrong identity/options/size, invalid requests,
unknown current content, unlock/erase/program failures, incomplete erasure,
corrupted readback and stuck-busy phases. No physical erase/program/restore
is proved by those offline runs alone. The initial18 focused web checks cover
artifact scope/provenance and fresh-session SRAM upload retry behavior; later
transaction checks bring the focused suite to30, separate from27 native
controller scenarios. Hardware page mutation/restoration evidence follows below.

`qualify.py` exposes **only mode2**. It rechecks the complete live stock code,
compares both original pages, saves the32KiB SRAM work area, loads/readbacks the
writer, executes one read-only request per page, checks results and unchanged
pages, then restores/readbacks original SRAM and stock1.2.57. SRAM writes use
fresh UID-bound1KiB epochs, with at most one exact SRAM-only retry. GO and flash
operations are never retried by that helper. No arbitrary transport command or
live mutation mode is exposed by that qualification runner. The separate
`run_native.py` transaction exposes a bounded context trial and restore-only.

Both live mode2 requests passed in
`work/usb-stock-recovery-20261104/goal/native-task-flash-readonly-fresh-epochs-v2/audit.json`:
zero erase starts and program doublewords, original pages unchanged, original
SRAM restored/verified and stock1.2.57 resumed. An earlier upload failed before
GO; its initial SRAM restoration was incomplete. The separate
`native-task-flash-readonly-20261105T045200Z/sram-repair.json` verifies all32768
original bytes were subsequently restored. Preserve both failure and repair
evidence.

`transaction.py` and `run_native.py` implement exact page readback, restoration
ordering, a no-normal-boot gate until original code/pages/mirrors are verified,
nonce-bound result collection without replaying GO, and an explicit restore-only
command saved before mutation. Nine transaction-policy tests and three host
boundary tests passed; later staging/console checks bring the focused suite to45. The host tests
cover partial/uncertain operations, stale valid-checksum nonces, failed
restoration, lost ACK resolution, and a single explicit stock DEB0 reset.

The initial two hardware transactions programmed/read back both patched pages and restored
both originals; all eight launched page operations completed with successful
controller status and exact page/mirror readback. Hardware partial-page restore
and all modeled controller faults are still untested. The first trial booted
the patched application for45 seconds but collected zero hook evidence. The
native timer audit explains why:15 is the log cadence and180 the reset period.
The explicit DEB0 path posts event0x100, whose native consumer calls reset(1,1).
Eight native branch/timer fixtures passed, with event delivery/division/reset
callees intercepted; they are not physical reset proof.

The second trial stopped on ROM synchronization timeout before native context
boot. A later synchronization timeout also interrupted the final guard-page
restoration, so the transaction held the case in ROM. The saved restore-only
path then restored/read back the guard page, both full original pages, complete
stock code, opposite-bank mirrors and all32768 SRAM bytes, and resumed stock
1.2.57. Preserve the failed transaction and its separate successful restore
audit. USB is closed and no hook remains installed.

Current evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-context-hardware-left-v1/audit.json`
- `native-task-context-hardware-left-explicit-v2/audit.json`
- `native-task-context-hardware-left-explicit-v2-restore/audit.json`
- `native-case-reset-trigger-audit.json`

`stager.py` now compares exact SRAM ranges and writes only changed epochs.
SRAM/read-only epochs and pre-body connection checks have at most three fresh
UID-bound attempts. Caller bodies, GO and flash operations are never replayed.
Known-read mismatches preserve actual data and digests; UID mismatches stop
without retry. The full original32KiB snapshot is still restored and verified.
`qualify_stager.py` completed both live mode2 requests:9296 bytes staged first,
288 second,23408 total including restoration, zero flash operations. Seven USB
timeouts were recovered. Those observations do not establish their root cause.

The third transaction used the revised loader and obtained **real left-side
native task evidence**. Its nonce/checksum-bound record shows caller0x08009AFF,
IPSR0, PRIMASK0, scheduler2 before/after, reset flag1 before/after, and70 HAL ticks
across the native pulse/snapshots. GPIOB ODR changed0x1C to0x21C. This is an elapsed
software interval, not measured pad pulse width or Apollo reset delivery.
The raw record was independently decoded against the journal. The right-side
attempt stopped on missing fresh presence telemetry before its reset command;
no right context result is claimed. Four page operations restored both exact
originals and the complete stock code/mirrors/SRAM; stock1.2.57 resumed.
Across all three trials/repair, twelve launched page operations are verified.

`console_reset.py` now preserves complete console capture on errors and retries
only missing read-only telemetry (up to three rounds). Actual absence, wrong
identity or active OTA stops before DEB0; the reset itself is sent at most once.
Six tests cover these gates. A live presence-only capture observed both temples,
OTA0 and stock1.2.57 without a reset. Stock status reads still timed out on both
temples. That check does not establish a working glasses application.

Additional evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-stager-hardware-qualification-v1/audit.json`
- `native-task-context-hardware-bilateral-staged-v3/audit.json`
- `native-task-context-hardware-bilateral-staged-v3/native-context-left-result.bin`
- `native-case-console-presence-capture-v1/console.txt`

Next build the fixed-HELLO-only probe around actual native pulse execution,
using the proven left context and checking each route's context before queries.
Use the captured console gate; do not spend another flash cycle solely repeating
the right phase-A context. Preserve the live RTOS tick configuration and exact
case restoration. The cold-fallback guard remains offline-tested; right native
context, physical Apollo reset delivery and wired SBL communication remain
unverified. No glasses firmware or custom UART query bytes were sent by these
context trials. The USB port is closed and the glasses remain unrecovered.

Register/programming references:
[ST G0B1 device header](https://github.com/STMicroelectronics/cmsis-device-g0/blob/master/Include/stm32g0b1xx.h),
[ST flash HAL](https://github.com/STMicroelectronics/stm32g0xx-hal-driver/blob/master/Src/stm32g0xx_hal_flash.c).
The reconstruction/native audit supplies the actual retail case bank-selection
and pulse call paths; generic vendor documentation alone does not bind them.
