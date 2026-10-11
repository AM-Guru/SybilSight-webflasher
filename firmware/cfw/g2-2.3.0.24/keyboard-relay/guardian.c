/* Guardian identity contract v1, field 132: {'G','I',1,enabled}.
 * RAM-only, default off, 30-second renewal lease. Reads the authenticated
 * parent's live Cordio snapshot; names are not available from stock discovery.
 * Runs only on the parent's display task under its existing display gate. */
#define GUARDIAN_DEADLINE_ADDR 0x2029f5b4u
#define GUARDIAN_RENDERED_ADDR 0x2029f5b8u
#define GUARDIAN_DEADLINE (*(volatile uint32_t *)GUARDIAN_DEADLINE_ADDR)
#define GUARDIAN_RENDERED (*(volatile uint32_t *)GUARDIAN_RENDERED_ADDR)
typedef struct { uint8_t linked, address_valid, address[6]; } guardian_snapshot;
typedef struct { uint32_t magic; guardian_snapshot rendered; } guardian_state;
#define GUARDIAN_STATE ((volatile guardian_state *)0x2029f5a4u)
#define GUARDIAN_MAGIC 0x43534c31u

static int guardian_enabled(void) {
    uint32_t deadline = GUARDIAN_DEADLINE;
    if (!deadline) return 0;
    if ((int32_t)(deadline - FW_MS_TICK) > 0) return 1;
    /* Retire observed expiry so an old deadline cannot revive after tick wrap.
     * A concurrent settings renewal must not be cleared by this display task. */
    __atomic_compare_exchange_n((uint32_t *)GUARDIAN_DEADLINE_ADDR, &deadline, 0,
                                0, __ATOMIC_RELAXED, __ATOMIC_RELAXED);
    return 0;
}
static void guardian_apply_control(const uint8_t *p, uint32_t length) {
    if (length != 4 || p[0] != 'G' || p[1] != 'I' || p[2] != 1 || p[3] > 1) return;
    uint32_t deadline = FW_MS_TICK + 30000u;
    GUARDIAN_DEADLINE = p[3] ? (deadline ? deadline : 1) : 0;
}
int guardian_queue_get(uint32_t queue, void *message, uint8_t *priority, uint32_t timeout) {
    /* Let the original dashboard-only queue hook schedule the repaint. This
     * also clears an old strip when switched off or when the lease expires. */
    if ((uint32_t)guardian_enabled() != GUARDIAN_RENDERED) GUARDIAN_STATE->magic = 0;
    return ((int (*)(uint32_t,void *,uint8_t *,uint32_t))PARENT_DASHBOARD_QUEUE)(queue,message,priority,timeout);
}
void guardian_overlay(uint8_t *fb) {
    int enabled = guardian_enabled();
    if (!enabled) {
        /* Stock has just repainted its framebuffer. Do not erase its content.
         * Record the live snapshot to avoid an idle redraw every 500 ms. */
        guardian_snapshot s = ((guardian_snapshot (*)(void))PARENT_READ_LINK)();
        GUARDIAN_STATE->rendered = s;
        GUARDIAN_STATE->magic = GUARDIAN_MAGIC;
        GUARDIAN_RENDERED = 0;
        return;
    }
    ((void (*)(uint8_t *))PARENT_DASHBOARD_OVERLAY)(fb);
    if (!fb || GUARDIAN_STATE->magic != GUARDIAN_MAGIC) return;
    uint32_t x = *(volatile uint32_t *)0x20000744u + *(volatile uint32_t *)0x2000074cu;
    uint32_t y = *(volatile uint32_t *)0x20000748u + *(volatile uint32_t *)0x200777f4u;
    x = (x > 64 ? 64 : x) & ~1u; y = (y > 192 ? 192 : y) & ~1u;
    unsigned side = *(volatile uint8_t *)0x200784dbu;
    if (side != 1 && side != 2) return;
    /* The inherited strip is 24 rows at y+250. Put LEFT at y+236,
     * RIGHT at y+264: distinct binocular lines even for different privacy MACs.
     * Directional copies are allocation-free and safe for overlapping rows. */
    unsigned top = side == 2 ? 236 : 264;
    for (unsigned i = 0; i < 24; i++) {
        unsigned row = side == 2 ? i : 23-i;
        for (unsigned col = x/2; col < (x+576)/2; col++)
            fb[(y+top+row)*320+col] = fb[(y+250+row)*320+col];
    }
    for (unsigned row = 236; row < 288; row++)
        if (row < top || row >= top+24)
            for (unsigned col=x/2; col<(x+576)/2; col++) fb[(y+row)*320+col]=0;
    uint32_t d[2]={(uint32_t)(uintptr_t)fb,153600};
    ((void (*)(void *))0x0047e317u)(d);
    GUARDIAN_RENDERED = 1;
}
