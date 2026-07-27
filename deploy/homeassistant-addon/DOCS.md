# SybilSight Remote Support

This local Home Assistant app runs the WebFlasher rendezvous relay. It has no
device access and keeps no session database. The person's browser owns the USB
connection and accepts only the five read-only diagnostic actions declared by
the relay protocol.

Set `operator_key` to a unique secret of at least 24 characters. Caddy should
proxy `/remote-support/ws` and `/remote-support/healthz` from
`webflasher.sybilsight.com` to `local-sybilsight-remote-support:8787`.
