# Read-only temple version query through the stock case

`g2_stock_case_diagnostics.py` sends two fixed product-test version requests
through the normal B200 1.2.57 case USB protocol at 1 Mbaud. It uploads no SRAM
bridge, enters no ROM loader, sends no reset command, and transfers no image.
It has no arbitrary forwarding option and imports no firmware writer.

```sh
python3 -m pip install pyserial
python3 scripts/g2_stock_case_diagnostics.py \
  --device /dev/cu.usbserial-XXXX --case-serial CASE_SERIAL \
  --output work/stock-version-new-session
```

Use an otherwise idle USB port and an unused output directory. Both temples
must be seated. The tool requires a fresh exact case identity banner, case
version 1.2.57, both contacts present, and inactive temple OTA before sending
either version request. If the serial banner is absent, it stops; it does not
reset the case to obtain one. Opening a CH340 port may itself affect the case
depending on the adapter/driver. DTR/RTS are set before open and no deliberate
reset pulse is generated. A case startup log does not prove a temple reset.

The only transmitted bytes are `DEA0\n`, `DEA3\n`, and:

| Requested side | Complete USB packet |
| --- | --- |
| Left | `5aa57f0424000000a6` |
| Right | `5aa57f0424000100a7` |

Only complete 14-byte `5aa5ff09` frames with valid outer checksums and payload
prefix `24010305` count as version replies. Request echoes, ASCII console
hex dumps, OTA acknowledgements, and truncated frames do not count. Replies
contain no side ID or serial number: the audit records the **requested** route
and per-query capture interval, not independent physical temple identity.
All captures remain local; they can contain case identifiers.

Exit 0 means both query intervals contained valid version replies. Exit 2
means a partial/no reply or a failed preflight/transport operation; inspect
`audit.json`. Neither outcome authorizes a firmware write. A version reply
establishes only that the responder handled this application request; it does
not establish CFW activation, healthy displays, successful full boot, or SBL
entry. No response cannot distinguish battery, contact, transport, firmware,
or hardware failure.

On 2026-11-04, the secondary test pair returned firmware **2.2.6.10**, hardware
**5**, in the left-query interval, while the right-query interval contained
`receive header timeout` and no valid version reply. Neither display woke
outside the case. This is a positive control for the stock application query,
not proof that the secondary right temple is healthy or that the experimental
[SBL entry mechanism](case_sbl_discovery/README.md) works on retail hardware.

```sh
python3 -m unittest discover -s scripts -p 'test_g2_stock_case_diagnostics.py' -v
```
