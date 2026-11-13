# Native case-task context prototype

Phase A places a guarded handoff at the two stock reset call sites. The
100-byte flash guard validates a one-shot configuration and the 484-byte SRAM
payload before entering it. Unarmed/corrupt inputs retain the stock pulse
call. The payload records caller, interrupt masks, scheduler state, reset flag,
HAL ticks, UART registers and GPIO registers around the **actual** stock pulse.
It returns to the original caller. It sends no UART queries or firmware images.

The hook is **not currently installed**. The adjacent `case_native_task_flash`
prototype now has an exact-page SRAM writer, live patch/restore transaction and
restore-only runner. Both read-only requests and real page program/readback/
restoration completed. Two context attempts remain unqualified: the passive
window was shorter than the actual automatic-reset period; the explicit-reset
trial stopped before native boot on a USB ROM sync timeout. Its interrupted
guard-page cleanup was repaired through restore-only, with full stock code,
pages, mirrors and SRAM verified. A third trial with changed-range SRAM staging
obtained valid **left** native-context evidence: expected caller, normal thread,
interrupts enabled, scheduler running, reset flag1 and70 elapsed HAL ticks.
The right attempt stopped before its reset on missing fresh telemetry. Both
original case pages/code/mirrors/SRAM are restored and stock1.2.57 resumed.
This proves left case-side execution, not physical Apollo reset or bootloader
entry. This directory itself has no flash writer.
`prepare_patch_plan.py` creates offline exact-page patch and restore artifacts
with `executionReady=false`. It does not grant a generic flash-write capability.
Only pages `0x08009800` and `0x0800D800` are candidates; vectors, serial storage,
other pages, OTP, option bytes and protection configuration are excluded.

`build.py` compiles the guard/payload and executes 17 native instruction cases
before emitting `validated-manifest.json`. The tests execute stock GPIO/delay
wrappers and the scheduler getter; the task delay and kernel state are fixtures.
They verify ABI return, exact native action sequence, one-shot handling and
fallbacks. They do not execute a complete FreeRTOS boot or establish physical
pulse timing, Apollo reset delivery, recovery eligibility or bootloader access.
`artifacts.py` rejects changed sources/artifacts, incomplete coverage and changes
outside the two call sites and erased tail.

`rom_epochs.py` provides fresh UID-bound read-only sessions. `qualify_storage.py`
saved/read the two original pages, verified the entire stock code twice, and
tested the reserved 8 KiB SRAM span across a five-second stock boot.
`read_mapping.py` executes a compiled, write-allowlisted SRAM reader for effective
flash registers. Both live helpers restore original SRAM and normal stock boot.
`audit_bank_selection.py` executes the actual stock bank selector and erase leaf
with register fixtures. No hardware erase is performed. The case's effective
`FLASH_OPTR=0xDEEFE1AA` selects bank 2 in that stock logic. This is not proof of
how ROM Extended Erase interprets host page indices.

Before a new installation, use the scoped transaction backend, verify live
UID/content/mapping again, preserve both original pages, and verify restoration
after each bounded context test. Do not boot from a partially programmed page.
Cold fallback is validated offline, not yet on hardware. No valid temple STATUS
or completed wired firmware recovery has been obtained.
