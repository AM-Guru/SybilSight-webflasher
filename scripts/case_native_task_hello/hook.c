/* Native RTOS pulse + fixed HELLO discovery. No image/provisioning writer. */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define U 0x40004800u
#define B 0x50000400u
#define CFG ((volatile uint32_t *)(uintptr_t)0x20011f00u)
struct evidence {uint32_t w[64];uint8_t raw[128];uint32_t reserved[31],checksum;};
_Static_assert(sizeof(struct evidence)==512,"fixed retained schema");
#define OUT ((volatile struct evidence *)(uintptr_t)0x20011a00u)
#define O(n) OUT->w[n]
enum {MAGIC,SCHEMA,STATUS,STAGE,CALLER,ROUTE,BRR,NONCE,IPSR,PRIMASK,SCHED0,SCHED1,
 RESET0,RESET1,TICK0,TICK_PULSE,TICK_TX,TICK_END,ATTEMPTS,TX,RX,CURSOR,ERRORS,FOUND,
 RESTORE,FLAGS,PRIMASK1,IPSR1,YIELDS,BOUNDED_OUT,STCTRL0,STLOAD0,STCTRL1,STLOAD1,
 UART0=34,UART1=39,GPIO0=44,GPIO1=50,APB0=56,CCIPR0,CFGR,PLLCFGR,APB1,CCIPR1,
 UART_MATCH,GPIO_MATCH};
static uint32_t fnv(volatile const uint8_t *p,uint32_t n) {
 uint32_t h=2166136261u;for(uint32_t i=0;i<n;i++){h^=p[i];h*=16777619u;}return h;
}
static uint32_t tick(void){return R(0x20000120u);}
static uint32_t scheduler(void){return ((uint32_t(*)(void))(uintptr_t)0x0800ca4du)();}
static void pulse(void){((void(*)(void))(uintptr_t)0x0800b679u)();}
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
static uint32_t crc_ring(uint32_t start) {
 uint32_t crc=0xffffffffu;
 for(uint32_t i=4;i<96;i++){crc^=OUT->raw[(start+i)&127u];for(uint32_t b=0;b<8;b++)crc=(crc>>1)^((crc&1)?0xedb88320u:0);}
 return ~crc;
}
static void capture(void) {
 uint32_t isr=R(U+28);O(ERRORS)|=isr&15u;
 if(isr&32u) {
  uint32_t c=O(CURSOR);OUT->raw[c]=(uint8_t)R(U+36);O(RX)++;c=(c+1)&127u;O(CURSOR)=c;
  if(O(RX)>=96) {
   uint32_t s=(c+128u-96u)&127u;
   if(OUT->raw[(s+4)&127u]==1 && !OUT->raw[(s+5)&127u] && OUT->raw[(s+6)&127u]==96 && !OUT->raw[(s+7)&127u]) {
    uint32_t expected=0;for(uint32_t i=0;i<4;i++)expected|=(uint32_t)OUT->raw[(s+i)&127u]<<(8*i);
    if(expected==crc_ring(s))O(FOUND)=1;
   }
  }
 }
 if(isr&15u)R(U+32)=isr&15u;
}
static uint32_t wait_uart(uint32_t mask) {
 uint32_t start=tick();
 for(uint32_t n=0;n<200000u;n++) {
  capture();if((R(U+28)&mask)==mask)return !O(ERRORS);
  if((uint32_t)(tick()-start)>=10u)break;
 }return 0;
}
static uint32_t receive(void) {
 uint32_t start=tick();
 for(uint32_t n=0;n<4000000u;n++) {
  capture();if(O(ERRORS) || O(FOUND))return !O(ERRORS);
  if((uint32_t)(tick()-start)>=400u)return 1;
  if((n&65535u)==0)R(0x40003000u)=0xaaaau;
 }O(BOUNDED_OUT)=1;return 0;
}
static uint32_t uart_owned(uint32_t brr) {
 return (R(0x4002103cu)&(1u<<18)) && !(R(0x40021054u)&0x30u) &&
  (R(U)&~8u)==5 && !R(U+4) && !R(U+8) && R(U+12)==brr && !R(U+44) &&
  (R(B)&0xf0000u)==0xa0000u && (R(B+36)&255u)==0x44u;
}
static void finish(void) {
 O(TICK_END)=tick();O(SCHED1)=scheduler();O(RESET1)=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 O(IPSR1)=ipsr();O(PRIMASK1)=primask();O(STCTRL1)=R(0xe000e010u)&7u;O(STLOAD1)=R(0xe000e014u);
 O(APB1)=R(0x4002103cu);O(CCIPR1)=R(0x40021054u);O(STAGE)=5;O(MAGIC)=0x31484e47u;
 OUT->checksum=fnv((volatile const uint8_t*)OUT,508);
}
__attribute__((section(".text.entry"))) void hook_main(uint32_t caller) {
 uint32_t route=CFG[3],brr=CFG[4],nonce=CFG[5];
 if(CFG[0]!=0x4b483247u || CFG[1]!=0xb4b7cdb8u || CFG[2]!=11 || route>1 ||
    (brr!=64 && brr!=556) || !nonce || CFG[6]!=20 || CFG[7]!=fnv((volatile const uint8_t*)CFG,28) ||
    caller!=(route?0x08009b15u:0x08009affu)){pulse();return;}
 CFG[0]=0;CFG[1]=0;
 volatile uint32_t *words=(volatile uint32_t*)OUT;for(uint32_t i=0;i<128;i++)words[i]=0;
 O(SCHEMA)=11;O(STAGE)=1;O(CALLER)=caller;O(ROUTE)=route;O(BRR)=brr;O(NONCE)=nonce;
 O(IPSR)=ipsr();O(PRIMASK)=primask();O(SCHED0)=scheduler();O(RESET0)=*(volatile uint8_t*)(uintptr_t)0x200000bcu;
 O(STCTRL0)=R(0xe000e010u)&7u;O(STLOAD0)=R(0xe000e014u);
 O(APB0)=R(0x4002103cu);O(CCIPR0)=R(0x40021054u);O(CFGR)=R(0x40021008u);O(PLLCFGR)=R(0x4002100cu);
 uart_save(&O(UART0));gpio_save(&O(GPIO0));
 if(O(IPSR) || O(PRIMASK) || O(SCHED0)!=2 || O(RESET0)!=1 || O(STCTRL0)!=7 || O(STLOAD0)!=63999 ||
    O(CFGR)!=0x12 || O(PLLCFGR)!=0x32020802u || O(CCIPR0)&0x30u || R(0x20000124u)!=64000000u ||
    O(UART0) || O(UART0+1) || O(UART0+2) || O(UART0+3)!=64 || O(UART0+4) ||
    (O(GPIO0)&0xc0000u)!=0x40000u) {
  O(STATUS)=1;O(TICK0)=tick();pulse();O(TICK_PULSE)=tick();finish();return;
 }
 /* Only the UART clock and disabled registers are prepared. Native GPIO
  * output configuration is unchanged throughout the original pulse. */
 R(0x4002103cu)|=1u<<18;R(U)=0;R(U+4)=0;R(U+8)=0;R(U+12)=brr;R(U+44)=0;
 O(FLAGS)|=1;O(STAGE)=2;O(TICK0)=tick();pulse();O(TICK_PULSE)=tick();O(STAGE)=3;
 uint32_t latch=R(B+20)&0x300u;
 if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1){O(STATUS)=2;goto cleanup;}
 if(R(U) || R(U+4) || R(U+8) || R(U+12)!=brr || R(U+44) || (R(0x40021054u)&0x30u)){O(STATUS)=3;goto cleanup;}
 /* Stock 0x6308: PB8/PB9 AF4, push-pull, speed0, pull0. Mode last. */
 masked(B,0xf0000u,0);masked(B+4,0x300u,0);masked(B+8,0xf0000u,0);masked(B+12,0xf0000u,0);
 masked(B+36,255u,0x44u);masked(B,0xf0000u,0xa0000u);
 R(U+32)=15;R(U+24)=8;R(U)=13;
 if(!wait_uart(0x600000u)){O(STATUS)=4;goto cleanup;}
 O(FLAGS)|=2;O(STAGE)=4;
 const uint8_t hello[8]={0x14,0x55,0x9d,0xe9,0,0,8,0};
 for(uint32_t a=0;a<20;a++) {
  if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1){O(STATUS)=2;goto cleanup;}
  if(!uart_owned(brr)){O(STATUS)=3;goto cleanup;}
  R(U)=13;if(!wait_uart(0x600000u)){O(STATUS)=4;goto cleanup;}O(ATTEMPTS)=a+1;
  for(uint32_t n=0;n<8;n++) {
   if(!wait_uart(0x80u)){O(STATUS)=5;goto cleanup;}
   R(U+40)=hello[n];O(TX)++;if(O(TX)==1)O(TICK_TX)=tick();
  }
  if(!wait_uart(0x40u)){O(STATUS)=5;goto cleanup;}
  R(U)=5;
  if(!receive()){O(STATUS)=O(ERRORS)?7u:6u;goto cleanup;}
  if(O(ERRORS)){O(STATUS)=7;goto cleanup;}
  if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1){O(STATUS)=2;goto cleanup;}
  if(!uart_owned(brr)){O(STATUS)=3;goto cleanup;}
  if(O(FOUND))break;
  /* Background stock tasks retain CPU time; no tick/IRQ reconfiguration.
   * RX stays enabled across the yield. Any overrun is an explicit failure. */
  if(a+1<20) {
   ((uint32_t(*)(uint32_t))(uintptr_t)0x0800a7b1u)(5u);O(YIELDS)++;
   if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1){O(STATUS)=2;goto cleanup;}
   if(!uart_owned(brr)){O(STATUS)=3;goto cleanup;}
   capture();if(O(ERRORS)){O(STATUS)=7;goto cleanup;}
  }
 }
cleanup:
 R(0x4002103cu)|=1u<<18;
 R(U)=0;gpio_restore(&O(GPIO0),latch);
 R(U+4)=O(UART0+1);R(U+8)=O(UART0+2);R(U+12)=O(UART0+3);R(U+44)=O(UART0+4);R(U)=O(UART0);
 uart_save(&O(UART1));gpio_save(&O(GPIO1));O(UART_MATCH)=1;O(GPIO_MATCH)=1;
 for(uint32_t i=0;i<5;i++)if(O(UART0+i)!=O(UART1+i))O(UART_MATCH)=0;
 for(uint32_t i=0;i<5;i++)if(O(GPIO0+i)!=O(GPIO1+i))O(GPIO_MATCH)=0;
 if(O(GPIO1+5)!=latch)O(GPIO_MATCH)=0;
 masked(0x4002103cu,1u<<18,O(APB0));
 O(RESTORE)=O(UART_MATCH)|(O(GPIO_MATCH)<<1)|(((R(0x4002103cu)^(O(APB0)))&(1u<<18))?0u:4u);
 if(O(RESTORE)!=7)O(STATUS)=8;
 if((R(0xe000e010u)&7u)!=O(STCTRL0) || R(0xe000e014u)!=O(STLOAD0))O(STATUS)=9;
 finish();
}
