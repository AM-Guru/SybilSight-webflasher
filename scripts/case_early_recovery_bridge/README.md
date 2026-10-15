# Temporary Case early-recovery research

This is a fixed SRAM diagnostic, not a firmware flasher or a proven recovery utility.

`early-hello` reproduces the right-route stock reset train, then sends exactly
`14559de900000800` and listens for one second. `left-control` sends the fixed
left-addressed read-only version request `24000000a6` without resetting a temple.
Both require the pinned complete Case code, Case serial, both contacts, inactive
OTA and the exact settled ten-byte YHM baseline. All code writes are to SRAM.
The program restores registers 3/4, 5, 6 and 7 as applicable, disables its UART,
then verifies all ten baseline bytes. Host reset returns the stock Case app.

The 103 GPIO/delay actions derive from modeled execution of stock 0x0800B678.
Native short-delay calls are preserved. Stock millisecond delays are replaced
by bounded polling of a 64 MHz SysTick, gated on the physically observed clock
configuration. This is software sequence evidence, not oscilloscope timing proof
or proof that the right Apollo actually reset.

Compiled models cover unknown/read-failed baseline, clock/framing mismatch,
YHM write failure, timer/Tx timeout, readback/restoration failure, noise and UART
errors. A passing model is not hardware receive-path qualification.

As of the first immediate hardware capture, the Case restored all ten register
bytes and firmware 1.2.57, but received HELLO echo plus one zero with framing error.
No CRC-valid Ambiq STATUS was observed. Early receive-path controls remain under
qualification; do not conclude that recovery is inaccessible from this capture.

Stock receive initializer is 0x08006C80 (Thumb 0x08006C81); 0x08006CF8 is TX-only.
The older V7 SBL raw-receive path used the TX initializer. Its silence is not a
qualified negative recovery observation. Source decompiler labels and the PT
command-map also disagree in places: resolve opcode dispatch pointers from the
pinned binary before selecting a command. In the locked main image, opcode 0x24
resolves through literal 0x00570140 to 0x00570571, the version query, rather than
the mislabeled command-map row 0x005726F0.

Updated qualification: removing the blocking 0x08002CB8 pulse-train helper from
the receive loop produced a complete left version reply 2.2.6.10 / HW5 with zero
UART errors. The corrected immediate right HELLO probe captured zero bytes, zero
UART errors, and exact ten-register restoration. This is a bounded 1-Mbaud
observation after the stock Case reset request, not proof of all recovery windows,
actual Apollo reset, retail SBL provisioning, or right-channel receive capability.
A no-reset `right-control` variant is prepared for the known-working pair.

Further hardware qualification: `right-control` received the complete checksum-valid
iPhone right response 2.3.0.24 / HW5 with zero UART errors and exact restoration.
`early-windowed` then sent four fixed HELLO frames at nominal offsets 0, 10, 50
and 250 ms following one stock right reset waveform. The Mac right returned zero
bytes and zero UART errors; all ten YHM bytes and Case 1.2.57 were restored.
These observations qualify both receive routes, but do not establish physical
Apollo reset, its INFO provisioning, other baud rates or the electrical root cause.
