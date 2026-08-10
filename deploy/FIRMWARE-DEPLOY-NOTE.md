# Firmware assets are published and release-bound

Status: resolved in the deployment workflow. Found 2026-07-28 while bringing
both G2 temples to reviewed CFW 2.2.6.11; reproduced again by the 2026-07-30
status-1 recovery log.

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

## Resolution

The larger historical archive remains under `/share/sybilsight`; moving Caddy
to `/share/webflasher` would remove official restore binaries that are not
checked into this repository. The workflow now automates the safe form of
option B:

- versioned directories present in `dist/firmware-updates/source-files/` are
  copied to hidden incoming paths in the archive and renamed atomically;
- the site release is swapped with its exact catalog at
  `/firmware-catalog.json`;
- the shared archive index is still renamed last for older clients, but it is
  no longer the WebFlasher's release authority;
- `release.json` binds the app commit to the exact catalog SHA-256;
- the browser refuses any temple mutation when that hash or pinned-image
  coverage differs; and
- deployment verification downloads and hashes the live newest reviewed custom
  target.

This split is intentional. The shared `/share/sybilsight` archive can be
refreshed or restored independently and contains official historical binaries
that are too large to keep in this repository. Its mutable `index.json` must
not be able to change the menu or invalidate a WebFlasher already published by
an atomic `/share/webflasher` release swap. Caddy serves the tracked latest CFW
and tracked official firmware directories from that atomic web root; other
official versioned paths fall back to the historical archive. Superseded CFW
releases are not offered by WebFlasher.

The production Caddy block therefore uses a file-aware matcher rooted at
`/share/webflasher` for every request beneath `source-files`. Files carried by
the atomic release—including its index, G2 images, and R1 packages—are served
from that release. A path absent from the release falls through to the larger
historical archive under `/share/sybilsight`. Version numbers never appear in
the routing configuration, so adding firmware cannot require a Caddy edit.

The deployment artifact now carries the canonical WebFlasher Caddy block and a
hash-pinned verifier. Before changing either firmware root or the website, the
production job downloads the active add-on Caddyfile and requires its extracted
WebFlasher block to match that canonical source exactly. Changes to the routing
policy still fail closed, while ordinary firmware additions reuse the stable
file-aware route automatically.

## Guard in the app

`src/App.jsx` now compares the fetched catalog against the compiled-in
`TEMPLE_FLASH_TARGETS` allowlist once the catalog loads, and logs a warning naming any
pinned image the library does not offer. That would have surfaced this condition on the
connect screen instead of silently offering only the legacy CFW.

The guard now blocks temple mutation rather than only reporting the drift.
