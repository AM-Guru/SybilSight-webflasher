# SybilSight Remote Support

This local Home Assistant app runs the WebFlasher rendezvous relay. It has no
device access and keeps no session database. The person's browser owns the USB
and Bluetooth connections. The relay forwards bounded serial operations plus
four fixed requester-side recovery tasks; it never accepts arbitrary shell,
JavaScript, firmware URLs, payload bytes, or device identifiers.

Set `operator_key` to a unique secret of at least 24 characters. Caddy should
proxy `/remote-support/ws` and `/remote-support/healthz` from
`webflasher.sybilsight.com` to `local-sybilsight-remote-support:8787`.
