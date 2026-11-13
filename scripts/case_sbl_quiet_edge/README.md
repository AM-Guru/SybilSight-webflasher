# Seated G2 quiet-window edge probe

This is a volatile Case SRAM probe for the stock 1.2.57 Smart Case. It runs the
stock PB9 reset train, sends only the fixed Ambiq SBL HELLO on one selected
route, and samples PB9 plus UART receive during each 400 ms interval after the
Case UART reports transmit complete and the transmitter is disabled. It writes
no Case flash and contains no temple firmware writer.

The retained result keeps the existing schema-7 reset, route, raw UART ring,
and exact restoration checks. In `registers`, fields 0, 1, 4, and 9 are reused
after their preflight checks for quiet samples, quiet transitions, low samples,
and a packed last level plus quiet UART byte count. UART bytes can still be
buffered self echo; only receive-window GPIO transitions suggest post-transmit
line activity, and even those do not identify the driver or prove Apollo reset.

The source-pinned build executes the compiled Cortex-M0+ payload under 32
Unicorn fault/response cases, including injected quiet-window edges. The host
requires two full exact stock Case-code readbacks, the matching Case identity,
bilateral contacts, inactive OTA, exact SRAM payload hash, an authenticated
readiness frame, retained result checksum, and exact YHM/GPIO restoration. It
restores stock Case application in `finally` even if the probe fails.

This probe does not know the original temples' INFO0/INFOC wired-recovery
provisioning or whether the Case waveform reaches Apollo reset. A silent result
cannot establish that wired recovery is impossible.
