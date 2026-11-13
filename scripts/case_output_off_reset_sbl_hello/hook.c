/* Seated off-state reset capture: arm RX, hold selected YHM side at AE, call
 * the native reset primitive, switch to AF, retain UART bytes and raw PB9
 * transitions, then return to AE. Host restores stock output afterward. No
 * temple UART transmit path exists.
 */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define U 0x40004800u
#define B 0x50000400u
#define CFG ((volatile uint32_t *)(uintptr_t)0x20011f00u)
#define RAW_CAPACITY 988u
struct evidence {uint32_t w[72];uint8_t raw[RAW_CAPACITY];uint32_t checksum;};
_Static_assert(sizeof(struct evidence)==1280,"fixed passive evidence");
#define OUT ((volatile struct evidence *)(uintptr_t)0x20011a00u)
#define O(n) OUT->w[n]
enum {MAGIC,SCHEMA,STATUS,STAGE,CALLER,ROUTE,BRR,NONCE,IPSR,PRIMASK,SCHED0,SCHED1,
 RESET0,RESET1,TICK0,TICK_PULSE,TICK_RX,TICK_END,RX,CURSOR,ERRORS,RESTORE,FLAGS,
 PRIMASK1,IPSR1,WAIT_DONE,CAPTURE_TICKS,TX,STCTRL0,STLOAD0,STCTRL1,STLOAD1,
 HAL_START,HAL_END,
 UART0=34,UART1=39,GPIO0=44,GPIO1=50,APB0=56,CCIPR0,CFGR,PLLCFGR,APB1,CCIPR1,
 UART_MATCH,GPIO_MATCH,
 PRE_SAMPLES,PRE_TRANSITIONS,PRE_LOW,PRE_FLAGS,
 POST_SAMPLES,POST_TRANSITIONS,POST_LOW,POST_FLAGS};
static uint32_t fnv(volatile const uint8_t *p,uint32_t n) {
 uint32_t h=2166136261u;for(uint32_t i=0;i<n;i++){h^=p[i];h*=16777619u;}return h;
}
static uint32_t tick(void){return R(0x20000120u);}
static uint32_t scheduler(void){return ((uint32_t(*)(void))(uintptr_t)0x0800ca4du)();}
static void pulse(void){((void(*)(void))(uintptr_t)0x0800b679u)();}
static uint32_t sensor(uint32_t channel,uint32_t value){return ((uint32_t(*)(uint32_t,uint32_t))(uintptr_t)0x080099e9u)(channel,value);}
static uint32_t ipsr(void){uint32_t v;__asm__ volatile("mrs %0, ipsr":"=r"(v));return v;}
static uint32_t primask(void){uint32_t v;__asm__ volatile("mrs %0, primask":"=r"(v));return v;}
static void uart_save(volatile uint32_t *s) {
 for(uint32_t i=0;i<4;i++)s[i]=R(U+4*i);s[4]=R(U+0x2cu);
}
static void gpio_save(volatile uint32_t *s) {
 s[0]=R(B)&0xf0000u;s[1]=R(B+4)&0x300u;s[2]=R(B+8)&0xf0000u;
 s[3]=R(B+12)&0xf0000u;s[4]=R(B+36)&255u;s[5]=R(B+20)&0x300u;
}
static void masked(uint32_t a,uint32_t mask,uint32_t value){R(a)=(R(a)&~mask)|(value&mask);}
static void gpio_restore(volatile const uint32_t *s,uint32_t latch) {
 masked(B,0xf0000u,0);masked(B+4,0x300u,s[1]);masked(B+8,0xf0000u,s[2]);
 masked(B+12,0xf0000u,s[3]);masked(B+36,255u,s[4]);
 R(B+24)=latch|((latch^0x300u)<<16);masked(B,0xf0000u,s[0]);
}
static void edge_sample(uint32_t post) {
 uint32_t base=post?POST_SAMPLES:PRE_SAMPLES,bit=(R(B+16)>>9)&1u;
 uint32_t samples=O(base),flags=O(base+3);
 if(!samples)flags=4u|bit|(bit<<1);
 else {
  uint32_t last=(flags>>1)&1u;
  if(bit!=last)O(base+1)++;
  flags=(flags&~2u)|(bit<<1);
 }
 O(base)=samples+1u;if(!bit)O(base+2)++;O(base+3)=flags;
}
static void capture(uint32_t post,uint32_t quiet) {
 edge_sample(post);
 uint32_t isr=R(U+28);
 if(quiet) {
  O(FLAGS)|=(isr&15u)<<16;
  if(isr&32u)(void)R(U+36);
  if(isr&15u)R(U+32)=isr&15u;
  return;
 }
 O(ERRORS)|=isr&15u;
 if(isr&32u) {
  uint32_t c=O(CURSOR),value=R(U+36);O(RX)++;
  if(c<RAW_CAPACITY){OUT->raw[c]=(uint8_t)value;O(CURSOR)=c+1u;}
 }
 if(isr&15u)R(U+32)=isr&15u;
}
static void rx_configure(void) {
 R(0x4002103cu)|=1u<<18;R(U)=0;R(U+4)=0;R(U+8)=0;R(U+12)=64;R(U+44)=0;
 masked(B,0xf0000u,0);masked(B+4,0x300u,0);masked(B+8,0xf0000u,0);masked(B+12,0xf0000u,0);
 masked(B+36,255u,0x44u);masked(B,0xf0000u,0xa0000u);
 R(U+32)=15;R(U+24)=8;R(U)=5;
}
static uint32_t send_hello(void) {
 const uint8_t hello[8]={0x14,0x55,0x9d,0xe9,0,0,8,0};
 R(U)=13;
 for(uint32_t j=0;j<8;j++) {
  uint32_t ready=0;
  for(uint32_t n=0;n<200000u;n++) {
   capture(1u,0u);
   if(R(U+28)&0x80u){ready=1;break;}
  }
  if(!ready){R(U)=5;return 0;}
  R(U+40)=hello[j];O(TX)++;
 }
 uint32_t complete=0;
 for(uint32_t n=0;n<200000u;n++) {
  capture(1u,0u);
  if(R(U+28)&0x40u){complete=1;break;}
 }
 R(U)=5;return complete;
}
static uint32_t capture_systick_wraps(uint32_t target,uint32_t base,uint32_t progress_word,uint32_t post,uint32_t quiet) {
 uint32_t elapsed=0,last=R(0xe000e018u)&0x00ffffffu;
 for(uint32_t n=0;n<800000000u && elapsed<target;n++) {
  if(post && !quiet && O(TX)<160u && elapsed>=450u*(O(TX)/8u)) {
   if(!send_hello()){O(STATUS)=16u;return 0;}
  }
  capture(post,quiet);
  uint32_t now=R(0xe000e018u)&0x00ffffffu;
  if(now>last){elapsed++;O(progress_word)=base+elapsed;}
  last=now;
  if((n&65535u)==0)R(0x40003000u)=0xaaaau;
 }
 if(elapsed!=target){O(FLAGS)|=8u;return 0;}
 return elapsed;
}
static uint32_t receive(uint32_t duration) {
 (void)duration;O(TICK_RX)=0;
 uint32_t channel=O(ROUTE)?4u:3u;
 volatile uint8_t *cache=(volatile uint8_t *)(uintptr_t)0x20000090u;
 (void)sensor(channel,0xaeu);
 if(cache[channel]!=0xaeu){O(STATUS)=10u;return 0;}
 O(FLAGS)|=256u;
 uint32_t off=capture_systick_wraps(3000u,0u,WAIT_DONE,0u,1u);
 if(off!=3000u){O(STATUS)=11u;return 0;}
 /* Call the exact stock reset primitive while the selected output is AE.
  * RX was armed before this call; this moves the reset ahead of output-on. */
 pulse();O(TICK_PULSE)=off;O(FLAGS)|=4u;O(STAGE)=3;
 if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1){O(STATUS)=2;goto restore_off;}
 (void)sensor(channel,0xafu);
 if(cache[channel]!=0xafu){O(STATUS)=12u;goto restore_off;}
 O(FLAGS)|=512u;
 uint32_t on=capture_systick_wraps(9000u,off,WAIT_DONE,1u,0u);
 if(on!=9000u){O(STATUS)=13u;goto restore_off;}
 O(WAIT_DONE)=off+on;
 O(STAGE)=4;
 uint32_t post=capture_systick_wraps(3000u,off+on,TICK_END,1u,0u);O(TICK_END)=off+on+post;
 if(post!=3000u)O(STATUS)=14u;
restore_off:
 (void)sensor(channel,0xaeu);
 if(cache[channel]!=0xaeu)O(STATUS)=15u;
 else O(FLAGS)|=1024u;
 return O(STATUS)==0u;
}
static void finish(void) {
 O(HAL_END)=tick();O(SCHED1)=scheduler();O(RESET1)=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 O(IPSR1)=ipsr();O(PRIMASK1)=primask();O(STCTRL1)=R(0xe000e010u)&7u;O(STLOAD1)=R(0xe000e014u);
 O(APB1)=R(0x4002103cu);O(CCIPR1)=R(0x40021054u);O(STAGE)=5;O(MAGIC)=0x31484e47u;
 OUT->checksum=fnv((volatile const uint8_t*)OUT,1276u);
}
__attribute__((section(".text.entry"))) void hook_main(uint32_t caller) {
 uint32_t route=CFG[3],nonce=CFG[5],duration=CFG[6];
 if(CFG[0]!=0x4b483247u || CFG[1]!=0xb4b7cdb8u || CFG[2]!=17 || route>1 ||
    CFG[4]!=64 || !nonce || duration!=15000 || CFG[7]!=fnv((volatile const uint8_t*)CFG,28) ||
    caller!=(route?0x08009b15u:0x08009affu)){pulse();return;}
 CFG[0]=0;CFG[1]=0;
 volatile uint32_t *words=(volatile uint32_t*)OUT;for(uint32_t i=0;i<320;i++)words[i]=0;
 O(SCHEMA)=17;O(STAGE)=1;O(CALLER)=caller;O(ROUTE)=route;O(BRR)=64;O(NONCE)=nonce;O(CAPTURE_TICKS)=duration;
 O(IPSR)=ipsr();O(PRIMASK)=primask();O(SCHED0)=scheduler();O(RESET0)=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 O(STCTRL0)=R(0xe000e010u)&7u;O(STLOAD0)=R(0xe000e014u);
 O(APB0)=R(0x4002103cu);O(CCIPR0)=R(0x40021054u);O(CFGR)=R(0x40021008u);O(PLLCFGR)=R(0x4002100cu);
 uart_save(&O(UART0));gpio_save(&O(GPIO0));
 if(O(IPSR) || O(PRIMASK) || O(SCHED0)!=2 || O(RESET0)!=1 || O(STCTRL0)!=7 || O(STLOAD0)!=63999 ||
    O(CFGR)!=0x12 || O(PLLCFGR)!=0x32020802u || O(CCIPR0)&0x30u || R(0x20000124u)!=64000000u ||
    O(UART0) || O(UART0+1) || O(UART0+2) ||
    (O(UART0+3)!=0 && O(UART0+3)!=64) || O(UART0+4) ||
    (O(GPIO0)&0xc0000u)!=0x40000u) {
  O(STATUS)=1;O(TICK0)=0;pulse();O(TICK_PULSE)=0;finish();return;
 }
 R(0x4002103cu)|=1u<<18;R(U)=0;R(U+4)=0;R(U+8)=0;R(U+12)=64;R(U+44)=0;
 O(FLAGS)|=1;O(STAGE)=2;O(TICK0)=0;O(HAL_START)=tick();
 uint32_t latch=R(B+20)&0x300u;
 rx_configure();O(FLAGS)|=2;O(STAGE)=4;
 if(!receive(duration) && !O(STATUS))O(STATUS)=O(ERRORS)?7u:6u;
 R(0x4002103cu)|=1u<<18;R(U)=0;gpio_restore(&O(GPIO0),latch);
 R(U+4)=O(UART0+1);R(U+8)=O(UART0+2);R(U+12)=O(UART0+3);R(U+44)=O(UART0+4);R(U)=O(UART0);
 uart_save(&O(UART1));gpio_save(&O(GPIO1));O(UART_MATCH)=1;O(GPIO_MATCH)=1;
 for(uint32_t i=0;i<5;i++)if(O(UART0+i)!=O(UART1+i))O(UART_MATCH)=0;
 for(uint32_t i=0;i<5;i++)if(O(GPIO0+i)!=O(GPIO1+i))O(GPIO_MATCH)=0;
 if(O(GPIO1+5)!=latch)O(GPIO_MATCH)=0;
 masked(0x4002103cu,1u<<18,O(APB0));
 O(RESTORE)=O(UART_MATCH)|(O(GPIO_MATCH)<<1)|(((R(0x4002103cu)^O(APB0))&(1u<<18))?0u:4u);
 if(O(RESTORE)!=7)O(STATUS)=8;
 if((R(0xe000e010u)&7u)!=O(STCTRL0) || R(0xe000e014u)!=O(STLOAD0))O(STATUS)=9;
 finish();
}
