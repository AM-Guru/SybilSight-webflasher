/* FI/v1 release identity. The inherited compiler folds marker bytes into
 * instructions, so replacing its rodata string alone cannot update this reply. */
void release_send_identity(const uint8_t *data, uint32_t len) {
    static const unsigned char marker[] = CFW_RELEASE_MARKER;
    if (len != 8u || !(data[4] | data[5] | data[6] | data[7])) return;
    unsigned side = FW_SIDE_ID();
    if (side != 1u && side != 2u) return;
    unsigned n = sizeof(marker) - 1u;
    unsigned char *reply = cfw_malloc(9u + n);
    if (!reply) return;
    reply[0] = 'F'; reply[1] = 'I'; reply[2] = 1u; reply[3] = side;
    for (unsigned i = 0; i < 4u; i++) reply[4u + i] = data[4u + i];
    reply[8] = n;
    for (unsigned i = 0; i < n; i++) reply[9u + i] = marker[i];
    ((int (*)(const void *, uint32_t))0x0047f17du)(reply, 9u + n);
    FW_FREE(reply);
}
