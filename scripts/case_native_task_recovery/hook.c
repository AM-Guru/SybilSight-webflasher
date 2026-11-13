/* Native-task context qualification. No UART, image or provisioning writer. */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define CFG ((volatile uint32_t *)(uintptr_t)0x20011f00u)
#define MAGIC 0x4b483247u
struct evidence {
 uint32_t magic,schema,status,stage,caller,route,brr,nonce;
 uint32_t ipsr,primask,scheduler_before,scheduler_after,hal_before,hal_after;
 uint32_t reset_flag_before,reset_flag_after;
 uint32_t uart_before[4],uart_after[4],gpio_before[7],gpio_after[7];
 uint32_t reserved[25],checksum;
};
_Static_assert(sizeof(struct evidence)==256,"fixed evidence schema");
#define OUT ((volatile struct evidence *)(uintptr_t)0x20011a00u)
static uint32_t fnv(volatile const uint8_t *p,uint32_t n) {
 uint32_t v=2166136261u;
 for(uint32_t i=0;i<n;i++) {v^=p[i];v*=16777619u;} return v;
}
static void native_pulse(void) { ((void(*)(void))(uintptr_t)0x0800b679u)(); }
static uint32_t scheduler(void) {return ((uint32_t(*)(void))(uintptr_t)0x0800ca4du)();}
static void snapshot(volatile uint32_t *uart,volatile uint32_t *gpio) {
 for(uint32_t i=0;i<4;i++)uart[i]=R(0x40004800u+4*i);
 const uint32_t addresses[7]={0x50000400u,0x50000404u,0x50000408u,0x5000040cu,0x50000424u,0x50000414u,0x50000014u};
 for(uint32_t i=0;i<7;i++)gpio[i]=R(addresses[i]);
}
__attribute__((section(".text.entry"))) void hook_main(uint32_t caller) {
 uint32_t route=CFG[3],brr=CFG[4],nonce=CFG[5];
 if(CFG[0]!=MAGIC || CFG[1]!=~MAGIC || CFG[2]!=9 || route>1 ||
    (brr!=64 && brr!=556) || !nonce || CFG[6] ||
    CFG[7]!=fnv((volatile const uint8_t*)CFG,28) ||
    caller!=(route?0x08009b15u:0x08009affu)) {
  native_pulse(); return;
 }
 /* Clear the one-shot before any native call; later stock resets fall back. */
 CFG[0]=0; CFG[1]=0;
 volatile uint32_t *words=(volatile uint32_t*)OUT;
 for(uint32_t i=0;i<64;i++)words[i]=0;
 OUT->schema=9;OUT->stage=1;OUT->caller=caller;OUT->route=route;OUT->brr=brr;OUT->nonce=nonce;
 uint32_t ipsr,primask;
 __asm__ volatile("mrs %0, ipsr":"=r"(ipsr));
 __asm__ volatile("mrs %0, primask":"=r"(primask));
 OUT->ipsr=ipsr;OUT->primask=primask;OUT->scheduler_before=scheduler();
 OUT->reset_flag_before=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 if(ipsr || primask || OUT->scheduler_before!=2 || OUT->reset_flag_before!=1)OUT->status=1;
 OUT->hal_before=R(0x20000120u);snapshot(OUT->uart_before,OUT->gpio_before);
 OUT->stage=2;
 native_pulse();
 OUT->stage=3;OUT->hal_after=R(0x20000120u);OUT->scheduler_after=scheduler();
 OUT->reset_flag_after=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 snapshot(OUT->uart_after,OUT->gpio_after);
 if(OUT->scheduler_after!=2 || OUT->reset_flag_after!=1)OUT->status=2;
 OUT->magic=0x3143544eu;
 OUT->checksum=fnv((volatile const uint8_t*)OUT,252);
}
