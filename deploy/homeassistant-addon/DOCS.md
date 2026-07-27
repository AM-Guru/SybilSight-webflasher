# SybilSight Remote Support

This local Home Assistant app runs the WebFlasher rendezvous relay. It has no
device access and keeps no session database. The person's browser owns the USB
connection and exposes only the exact G2 Case CH340 serial interface selected
for that attended session. The relay forwards bounded serial open/close, line
settings, DTR/RTS, reads, and writes; it cannot access any other part of the
customer's computer.

Set `operator_key` to a unique secret of at least 24 characters. Caddy should
proxy `/remote-support/ws` and `/remote-support/healthz` from
`webflasher.sybilsight.com` to `local-sybilsight-remote-support:8787`.
