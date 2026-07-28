# Firmware assets are not covered by the deploy pipeline

Status: open. Found 2026-07-28 while bringing both G2 temples to reviewed CFW 2.2.6.11.

## Symptom

`webflasher.sybilsight.com` ran the current app bundle but offered an **older firmware
library** than the bundle itself trusts. The CFW entry in the picker resolved to:

    g2-custom-2.2.6.10   version "2.2.6.10-cfw"
    /firmware-updates/source-files/2.2.6.10-cfw/g2-2.2.6.10-cfw.bin
    4,317,305 bytes   sha256 5c1539fd39c599e6…

while the repository (already on `origin/main`) has:

    g2-custom-2.2.6.11   version "2.2.6.11"
    /firmware-updates/source-files/2.2.6.11/g2-2.2.6.11.bin
    4,320,415 bytes   sha256 d2fb5dcef485b1bb…

Different sizes, different hashes — genuinely different firmware.

Consequence: a bilateral CFW update performed from production would have put the *legacy*
CFW on one temple and left reviewed CFW 2.2.6.11 on the other. That mismatched pair is the
exact cross-version condition behind the earlier bilateral-verification defect.

## Root cause

`deploy/webflasher.caddy` serves firmware from a **different filesystem root** than the app:

```
handle /firmware-updates/* {
    root * /share/sybilsight      # <-- firmware library
    file_server
}
handle {
    root * /share/webflasher      # <-- deployed dist/
    try_files {path} /index.html
    file_server
}
```

`.github/workflows/deploy.yml` builds `dist/` and publishes it to `/share/webflasher`.
Vite does copy `public/firmware-updates/` into `dist/`, so those files *are* in the
deployed artifact — but they land under `/share/webflasher/firmware-updates/`, which the
Caddy `handle /firmware-updates/*` block shadows. Nothing in the pipeline writes to
`/share/sybilsight`, so the firmware library only ever changes by hand.

That is why the app bundle and the firmware catalog drifted apart while both looked
"deployed": the bundle SHA on production matched `HEAD` exactly (a local build of the same
commit reproduced `assets/index-B1naFm0T.js` byte for byte), yet the catalog was months
behind it.

**The GitHub side needs nothing.** `origin/main` is in sync and already contains
`public/firmware-updates/source-files/2.2.6.11/g2-2.2.6.11.bin`. This is purely a
publish-path problem.

## Options

### A. Publish the firmware library with the site (recommended)

Delete the `handle /firmware-updates/*` block so firmware is served from the same deployed
root as the app. The pipeline then owns the whole surface, and the compiled-in writer
allowlist and the served catalog can never drift again.

```caddyfile
# (remove the /firmware-updates/* handle entirely; the final `handle` block
#  already serves it from /share/webflasher)
```

Check before switching: confirm nothing else depends on `/share/sybilsight`, and that
`try_files {path} /index.html` will not mask a missing firmware file by returning the app
shell. Firmware fetches should 404 honestly rather than receive HTML — worth an explicit
`handle /firmware-updates/*` block rooted at `/share/webflasher` with `file_server` and no
`try_files`.

### B. Keep the split root and sync the library

Leave routing alone and copy the archive across on release:

```bash
rsync -av --delete \
  public/firmware-updates/source-files/ \
  <host>:/share/sybilsight/firmware-updates/source-files/
```

This keeps the large binary archive out of the site artifact, but it stays a manual step —
the one that was missed here.

## Guard added in the app

`src/App.jsx` now compares the fetched catalog against the compiled-in
`TEMPLE_FLASH_TARGETS` allowlist once the catalog loads, and logs a warning naming any
pinned image the library does not offer. That would have surfaced this condition on the
connect screen instead of silently offering only the legacy CFW.

The guard reports the drift; it does not fix it. Either option above is still required.
