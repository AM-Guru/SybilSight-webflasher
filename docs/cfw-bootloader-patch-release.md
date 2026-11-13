# Bootloader requirement for subsequent G2 CFW releases

The currently pinned `SybilSight/230.87` bundle predates this requirement. It
contains the stock G2 2.3.0.24 bootloader and remains immutable. Every later
custom firmware bundle published through WebFlasher must contain a reviewed,
version-compatible patched `ota/s200_bootloader.bin` component.

Kalani confirmed the intended source on November 12, 2026. The available [G2 bootloader patch](https://github.com/drdaeman/g2-bootloader-patch)
at commit `6198d70e18293caebf8314d2e40bd3b1d0a5ee16` accepts only stock
2.3.2.14 bootloader SHA-256
`22a2b98e606b4d296e957a3a8b600a2158497638d79485c817c2025536329ba7`
and uses case 1.2.57 for its recovery relay. The current 2.3.0.24 CFW base
contains bootloader SHA-256
`52ed1c4d043f278f9011d2f2e6555b668ef2ff1e312695f5c28fa7986523b75b`.
These images differ at all three reviewed hook sites and are not interchangeable. The experimental 2.2.6.10 port in a
local fork has no hardware validation and does not cover the current base.

For a later CFW release:

1. Select the exact stock bootloader source and establish a hash-pinned patch
   for that version. Build a reproducible patched component and receipt from
   reviewed source. Do not transplant the 2.3.2.14 binary to another base.
2. Validate that only the reviewed hooks and appended code differ from the
   stock image, and that component length, partition bounds, CRC-32C, and the
   complete EVENOTA table remain valid after packaging.
3. Validate update and recovery on both physical temples with a compatible
   case before presenting a release as hardware validated. A simulator or
   static check does not establish safe flashing.
4. Add the stock SHA-256, patched component SHA-256, and source commit to
   `APPROVED_BOOTLOADER_PATCHES` in
   `scripts/verify_cfw_bootloader_release.py`. Add `bootloaderPatch` with
   `source`, `sourceCommit`, `stockSha256`, and `patchedSha256` to the new custom
   catalog entry. Update the deploy workflow's custom release hash pins.
5. Run `python3 scripts/test_verify_cfw_bootloader_release.py`,
   `python3 scripts/verify_cfw_bootloader_release.py
   dist/firmware-catalog.json dist`, and the normal site build/tests before
   publishing. Inspect the actual bootloader inside the final bundle.

The deployment workflow runs the release verifier and rejects any subsequent
CFW that lacks a reviewed patch identity. The approval map is intentionally
empty until a compatible patch is built and validated. No new CFW is authorized
by this document or by the passing legacy release check.
