# G2 pogo main-firmware flasher

`g2_pogo_flasher.py` implements the recovered `0x52` through `0x55`
product-test OTA protocol exposed by a **running** G2 temple application.

It is intentionally fail-closed:

- only a complete, six-component EVENOTA package with the reviewed topology is
  accepted;
- outer component CRC-32C, the main image's nested reflected CRC-32, vector
  table, load address, installed span, filename, storage type, and package
  layout are validated;
- only `ota/s200_firmware_ota.bin` (component type 0) can be transmitted;
- `ota/s200_bootloader.bin` is always rejected;
- mutating operation requires two risk confirmations plus the complete image
  SHA-256;
- `0x52` and `0x53` are never blindly replayed;
- only `0x54` data records are retried, using the firmware's explicitly
  supported previous-sequence behavior;
- every 6-KiB deferred-write boundary gets a configurable settling interval;
  and
- success requires a matching, checksum-valid post-reboot version response.

## Transport requirement

The serial device must expose one temple's raw UART at 1,000,000 baud, 8N1,
without flow control.

The stock case CH340 port (`/dev/cu.usbserial-10` in the current test setup)
is the case STM32's USART1 console. It is **not** a transparent temple UART and
cannot be passed directly to this tool. A later case transport must load a
separately reviewed SRAM bridge, select one YHM2510 contact route, and present
the transaction API expected by the flasher. The existing
`g2_case_pogo_read_bridge.py` remains intentionally read-only.

Do not attach a generic USB-UART adapter directly to the charging contacts.
Use the case's level-shifting/routing front end or an electrically validated
fixture.

## Offline inspection

```sh
python3 scripts/firmware/g2_pogo_flasher.py inspect \
  firmware/ota/2026-07-22/g2-2.2.6.10-e28738432d7b612d625331b00383149b.bin
```

Add `--json` for machine-readable output. Inspection does not open a serial
port.

## Read-only preflight

After a raw temple-UART endpoint exists:

```sh
python3 scripts/firmware/g2_pogo_flasher.py preflight \
  --device /dev/cu.usbserial-X \
  --direct-temple-uart-confirmed \
  --expect-version 2.2.6.10
```

This sends only the recovered `0x24` version query.

## Main-firmware flash

Run `inspect` first and copy the complete image SHA-256 from its output:

```sh
python3 scripts/firmware/g2_pogo_flasher.py flash \
  firmware/ota/2026-07-22/g2-2.2.6.10-e28738432d7b612d625331b00383149b.bin \
  --device /dev/cu.usbserial-X \
  --direct-temple-uart-confirmed \
  --execute-main-ota \
  --accept-single-slot-risk \
  --confirm-image-sha256 \
  f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa \
  --expect-current-version 2.2.6.10 \
  --log /path/to/g2-pogo-flash.json
```

The tool sends:

1. one `0x52` start;
2. one `0x53` containing the exact 128-byte main-component header;
3. all sequenced `0x54` records, each containing at most 1,000 data bytes and
   CRC-16/CCITT-FALSE; and
4. one `0x55` result check.

For the mirrored `2.2.6.10` image this is 3,524 data records carrying
3,523,396 bytes.

The `0x54` reply is an acceptance/enqueue acknowledgement, not a durable-write
acknowledgement. The default 100-ms delay at every 6-KiB boundary is
conservative but still experimental; validate it on sacrificial hardware
before relying on the tool for recovery.

If the final reply races the application reset, the tool reports
`finish_ack=False` and continues to require the exact package version during
postflight. Lack of a matching postflight response is failure or uncertain
state, never success.

## What this tool cannot do

- It cannot communicate through the unmodified stock case USB console.
- It cannot back up installed Apollo MRAM, INFO0/INFOC, calibration, pairing
  state, or keys.
- It cannot operate after the temple application or its box-UART task has
  stopped.
- It cannot enter or use the protected Ambiq SBL.
- It cannot safely rewrite the Even bootloader.

Exact installed-state backup still requires permitted SWD/debug read access or
custom code that implements a read service. Dead-application restoration
requires a separately proven Apollo SBL/MRAM-recovery or SWD route.

## Tests

```sh
python3 -m unittest -v scripts/firmware/test_g2_pogo_flasher.py
```

The tests are offline. They validate the mirrored package, bootloader
rejection, nested-image corruption rejection, version decoding, reply status
handling, and idempotent `0x54` retry behavior.
