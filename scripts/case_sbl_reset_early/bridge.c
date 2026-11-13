/* Stock PB9 reset train followed by early-armed fixed HELLO. No image writer.
 * Case 1.2.57 native calls require complete host-side code hash verification.
 * Selecting case VBUS is NOT evidence of a battery-powered Apollo reset.
 */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define UART 0x40004800u
#define HOST_UART 0x40013800u
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
#ifndef ROUTE_LEFT
#define ROUTE_LEFT 0
#endif
#ifndef UART_BRR
#define UART_BRR 64
#endif
#ifndef HELLO_ATTEMPTS
#define HELLO_ATTEMPTS 20
#endif
#define RECEIVE_MS 400u
#define WATCHDOG_INTERVAL 8u
#ifndef YHM_PROFILE
#define YHM_PROFILE 2
#endif
#define GPIOB 0x50000400u
#include "reset_actions.h"
_Static_assert(ROUTE_LEFT == 0 || ROUTE_LEFT == 1, "fixed physical route");
_Static_assert(UART_BRR == 64 || UART_BRR == 556, "qualified nominal baud divisors");
_Static_assert(HELLO_ATTEMPTS == 20, "fixed bounded reset/capture schedule");
_Static_assert(YHM_PROFILE >= 0 && YHM_PROFILE <= 3, "reviewed profiles");
struct result {
 uint32_t magic, version, status, count, writes, baseline_mask, restore_mask;
 uint32_t error, restore_failure, attempts, tx_count, found;
 uint8_t baseline[10], restored[10], padding[4], raw[128];
 uint32_t registers[13], checksum;
};
_Static_assert(sizeof(struct result) == 256, "fixed retained schema");
static void off(void) { __asm__ volatile("cpsid i":::"memory"); }
static void call(uint32_t a) { ((void(*)(void))(uintptr_t)a)(); off(); }
static void gate(void) {
 ((void(*)(uint32_t,uint32_t,uint32_t))(uintptr_t)0x08004e9fu)(0x50000000u,8u,1u); off();
}
static uint32_t watchdog_descriptor_allowed(void) {
 return R(0x20000014)==4 && R(0x20000018)<=1 && R(0x2000001c)==0
    && R(0x20000020)==2 && R(0x20000024)==0;
}
static uint32_t watchdog(void) {
 /* SRAM launches skip the stock C runtime's initialized-data copy.
  * Never let the native PB2 helper configure a stale GPIO pin mask. */
 if(!watchdog_descriptor_allowed()) {
  OUT->status=15; return 0;
 }
 call(0x08002cb9); OUT->registers[9]++; return 1;
}
static uint32_t read_yhm(volatile uint8_t *out) {
 uint32_t mask = 0;
 for (uint32_t i=0;i<10;i++) {
  uint8_t v=0;
  uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&v);
  off(); out[i]=v; if(ok) mask|=1u<<i;
 }
 return mask;
}
static uint32_t write_yhm(uint32_t index, uint8_t value) {
 if(index<3 || index>7) return 0;
 OUT->writes|=1u<<index;
 uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,const void*))(uintptr_t)0x08009109u)(index,1,&value);
 off(); return ok;
}
static uint32_t baseline_allowed(void) {
 /* Same five structural baselines as src/lib/yhmProfiles.js. Profile 2
  * includes the independently pinned observed-33-entry1 (8d/33) variant. */
 const uint8_t table[5][10]={
  {0x81,0x11,4,0xaf,0xaf,3,0x8d,0x20,YHM_PROFILE==2?0x33:0x22,0xff},
  {0x81,0x00,4,0xae,0xae,3,0x81,0x20,0x22,0xff},
  {0x81,0x11,4,0xaf,0xaf,3,0x81,0x20,0x22,0xff},
  {0x81,0x01,4,0xaf,0xae,3,0x81,0x20,0x22,0xff},
  {0x81,0x10,4,0xae,0xaf,3,0x81,0x20,0x22,0xff}
 };
 uint8_t reg8=YHM_PROFILE==0?0x22:YHM_PROFILE==3?0x45:0x33;
 for(uint32_t row=0;row<5;row++) {
  uint32_t match=1;
  for(uint32_t col=0;col<10;col++) {
   uint8_t expected=col==8 && row>0?reg8:table[row][col];
   if(OUT->baseline[col]!=expected) match=0;
  }
  if(match) return 1;
 }
 return 0;
}
static uint32_t crc32_ring(uint32_t start) {
 uint32_t crc=0xffffffffu;
 for(uint32_t i=4;i<96;i++) {
  crc^=OUT->raw[(start+i)&127u];
  for(uint32_t bit=0;bit<8;bit++) crc=(crc>>1)^((crc&1u)?0xedb88320u:0u);
 }
 return ~crc;
}
/* PB8/PB9 fields, their output latches, and the PA3 gate latch.
 * The packed snapshots also cover fields changed by stock UART helpers. */
static uint32_t gpio_snapshot(void) {
 return ((R(GPIOB)>>16)&15u) | (((R(GPIOB+12)>>16)&15u)<<4)
  | (((R(GPIOB+8)>>16)&15u)<<8) | (((R(GPIOB+4)>>8)&3u)<<12)
  | ((R(GPIOB+36)&255u)<<14) | (((R(GPIOB+20)>>8)&3u)<<22)
  | (((R(0x50000014)>>3)&1u)<<24);
}
static uint32_t reset_release(void) {
 R(UART)=0;
 R(GPIOB)&=~0x000f0000u;
 R(GPIOB+12)&=~0x000f0000u;
 if((R(GPIOB)|R(GPIOB+12))&0x000f0000u) { OUT->status=14; return 0; }
 OUT->padding[1]|=8u;
 return 1;
}
static void gpio_restore(uint32_t s) {
 /* Disable both drivers before restoring pull/speed/type/AF and mode last. */
 R(GPIOB)&=~0x000f0000u;
 R(GPIOB+12)=(R(GPIOB+12)&~0x000f0000u)|(((s>>4)&15u)<<16);
 R(GPIOB+8)=(R(GPIOB+8)&~0x000f0000u)|(((s>>8)&15u)<<16);
 R(GPIOB+4)=(R(GPIOB+4)&~0x300u)|(((s>>12)&3u)<<8);
 R(GPIOB+36)=(R(GPIOB+36)&~255u)|((s>>14)&255u);
 uint32_t latch=(s>>22)&3u;
 R(GPIOB+24)=(latch<<8)|((latch^3u)<<24);
 R(0x50000018)=((s>>24)&1u)?8u:0x00080000u;
 R(GPIOB)=(R(GPIOB)&~0x000f0000u)|((s&15u)<<16);
 OUT->registers[12]=gpio_snapshot();
 if(OUT->registers[12]==s) OUT->padding[1]|=16u;
 else OUT->status=13;
}
static uint32_t delay_ticks(uint32_t ms) {
 R(0xe000e014)=63999; R(0xe000e018)=0; R(0xe000e010)=5;
 for(uint32_t t=0;t<ms;t++) {
  uint32_t tick=0;
  for(uint32_t i=0;i<200000u;i++) if(R(0xe000e010)&0x10000u) { tick=1; break; }
  if(!tick) { OUT->status=12; R(0xe000e010)=0; return 0; }
  uint32_t n=(uint32_t)OUT->padding[2]+((uint32_t)OUT->padding[3]<<8)+1;
  OUT->padding[2]=(uint8_t)n; OUT->padding[3]=(uint8_t)(n>>8);
  R(0x40003000)=0xaaaa;
 }
 R(0xe000e010)=0; return 1;
}
static uint32_t stock_reset(void) {
 /* Same PB9 descriptor as the stock no-reply reset caller at 0x0800D36C.
  * RX is unavailable for this entire train. OS ticks are nominal 1 ms;
  * busy loops execute the original native instructions. Neither proves a
  * measured pad waveform or which reset, if any, reaches Apollo. */
 R(UART)=0;
 R(GPIOB)&=~0x000f0000u;
 R(GPIOB+12)&=~0x000f0000u;
 R(GPIOB+4)&=~0x200u;
 R(GPIOB+8)=(R(GPIOB+8)&~0x000c0000u)|0x000c0000u;
 R(GPIOB)=(R(GPIOB)&~0x000c0000u)|0x00040000u;
 OUT->padding[0]=0x40; OUT->padding[1]|=1u;
 uint32_t hash=2166136261u;
 for(uint32_t i=0;i<RESET_ACTIONS;i++) {
  uint32_t kind=reset_actions[i][0],value=reset_actions[i][1];
  for(uint32_t word=0;word<2;word++) {
   uint32_t n=word?value:kind;
   for(uint32_t byte=0;byte<4;byte++) { hash^=(n>>(8*byte))&255u; hash*=16777619u; }
  }
  if(kind<2) {
   ((void(*)(uint32_t,uint32_t,uint32_t))(uintptr_t)0x08004e9fu)(kind?GPIOB:0x50000000u,kind?512u:8u,value); off();
  } else if(kind==2) { if(!delay_ticks(value)) return 0; }
  else { ((void(*)(uint32_t))(uintptr_t)0x0800a7a3u)(value); off(); }
  OUT->registers[2]=hash; OUT->registers[3]=i+1;
 }
 if(hash!=RESET_FNV) { OUT->status=11; return 0; }
 OUT->padding[1]|=4u;
 return reset_release();
}
static uint32_t host_ready(void) {
 /* Exact host pin/framing configuration from the reviewed USB/pogo bridge:
  * PA9/10 AF1, USART1 115200 8E1 at the already-checked 64-MHz clock. */
 R(0x40021040)|=0x4000;
 R(0x50000000)=(R(0x50000000)&0xffc3ffffu)|0x00280000u;
 R(0x50000004)&=0xfffff9ffu;
 R(0x50000008)=(R(0x50000008)&0xffc3ffffu)|0x00280000u;
 R(0x5000000c)&=0xffc3ffffu;
 R(0x50000024)=(R(0x50000024)&0xfffff00fu)|0x00000110u;
 R(HOST_UART)=0; R(HOST_UART+4)=0; R(HOST_UART+8)=0;
 R(HOST_UART+12)=556; R(HOST_UART+32)=15; R(HOST_UART)=0x140d;
 uint32_t words[8]={0x37523247u,7u|0x03000000u|((ROUTE_LEFT?0u:1u)<<8)|((uint32_t)YHM_PROFILE<<16),UART_BRR,HELLO_ATTEMPTS,RECEIVE_MS,RESET_ACTIONS,RESET_FNV,0};
 const uint8_t *bytes=(const uint8_t*)words;
 uint32_t crc=0xffffffffu;
 for(uint32_t i=0;i<(8u-1u)*4u;i++) {
  crc^=bytes[i];
  for(uint32_t bit=0;bit<8;bit++) crc=(crc>>1)^((crc&1u)?0xedb88320u:0u);
 }
 words[8u-1u]=~crc;
 for(uint32_t n=0;n<8u*4u;n++) {
  uint32_t ready=0;
  for(uint32_t i=0;i<200000u;i++) if(R(HOST_UART+28)&0x80u) { ready=1; break; }
  if(!ready) return 0;
  R(HOST_UART+40)=bytes[n];
 }
 for(uint32_t i=0;i<200000u;i++) if(R(HOST_UART+28)&0x40u) return 1;
 return 0;
}
static void capture_byte(void) {
 uint32_t isr=R(UART+0x1c); OUT->error|=isr&15u;
 if(isr&0x20u) {
  uint8_t value=(uint8_t)R(UART+0x24);
  OUT->registers[8]++;
  uint32_t cursor=OUT->registers[10];
  OUT->raw[cursor]=value;
  cursor=(cursor+1u)&127u;
  OUT->registers[10]=cursor;
  if(OUT->count<128u) OUT->count++;
  if(OUT->count>=96u) {
   uint32_t start=(cursor+128u-96u)&127u;
   if(OUT->raw[(start+4)&127u]==1 && OUT->raw[(start+5)&127u]==0 && OUT->raw[(start+6)&127u]==96 && OUT->raw[(start+7)&127u]==0) {
    uint32_t expected=0;
    for(uint32_t i=0;i<4;i++) expected|=(uint32_t)OUT->raw[(start+i)&127u]<<(8*i);
    if(expected==crc32_ring(start)) OUT->found=1;
   }
  }
 }
 if(isr&15u) R(UART+0x20)=isr&15u;
}
static uint32_t capture_ms(uint32_t ms) {
 R(0xe000e014)=63999; R(0xe000e018)=0; R(0xe000e010)=5;
 for(uint32_t t=0;t<ms;t++) {
  uint32_t tick=0;
  for(uint32_t i=0;i<200000u;i++) {
   capture_byte(); if(OUT->found) { R(0xe000e010)=0; return 1; }
   if(R(0xe000e010)&0x10000u) { tick=1; break; }
  }
  if(!tick) { OUT->error|=0x100; R(0xe000e010)=0; return 0; }
  R(0x40003000)=0xaaaa;
 }
 R(0xe000e010)=0; return 1;
}
void bridge_main(void) {
 volatile uint8_t *bytes=(volatile uint8_t*)OUT;
 for(uint32_t i=0;i<256;i++) bytes[i]=0;
 OUT->version=7;
 call(0x08004eed); call(0x08008439); call(0x08006a41); call(0x08002889);
 R(0xe000e010)=0; R(0xe000e180)=0xffffffff; R(0xe000e280)=0xffffffff; R(0x40003000)=0xaaaa;
 R(0x40021034)|=3;
 R(0x20000014)=4; R(0x20000018)=0; R(0x2000001c)=0; R(0x20000020)=2; R(0x20000024)=0;
 R(0x200000a0)=8; R(0x200000a4)=0; R(0x200000a8)=0; R(0x200000ac)=2; R(0x200000b0)=0;
 *(volatile uint8_t*)0x20000114=0; *(volatile uint8_t*)0x200000bf=1;
 for(uint32_t i=0;i<5;i++) R(0x2000007c+4*i)=0;
 OUT->baseline_mask=read_yhm(OUT->baseline);
 if(OUT->baseline_mask!=0x3ff || !baseline_allowed()) { OUT->status=1; goto done; }
 OUT->registers[11]=gpio_snapshot();
 call(0x08006cf9);
 OUT->registers[0]=R(0x40021008); OUT->registers[1]=R(0x4002100c);
 OUT->registers[2]=R(UART); OUT->registers[3]=R(UART+4); OUT->registers[4]=R(UART+0xc);
 OUT->registers[5]=ROUTE_LEFT; OUT->registers[6]=UART_BRR; OUT->registers[7]=HELLO_ATTEMPTS;
 if(OUT->registers[0]!=0x12 || OUT->registers[1]!=0x32020802 || OUT->registers[2]!=9 || OUT->registers[3]!=0 || OUT->registers[4]!=64 || R(UART+8)!=0x1000u) { OUT->status=3; goto cleanup; }
 gate();
 if(!write_yhm(5,3) || !write_yhm(6,0xc1) || !write_yhm(ROUTE_LEFT?3:4,0xa6)) { OUT->status=4; goto cleanup; }
 if(!capture_ms(30) || !write_yhm(7,ROUTE_LEFT?3:5)) { OUT->status=4; goto cleanup; }
 if(!watchdog()) goto cleanup;
 if(!host_ready()) { OUT->status=10; goto cleanup; }
 OUT->padding[1]|=2u;
 if(!stock_reset()) goto cleanup;
 /* Native TX setup still creates an uncalibrated post-train gap. It runs
  * once; RX is acknowledged before HELLO and stays enabled until cleanup. */
 const uint8_t hello[8]={0x14,0x55,0x9d,0xe9,0,0,8,0};
 call(0x08006cf9); gate(); R(UART)=0; R(UART+0xc)=UART_BRR;
 R(UART+8)&=~0x1000u;
 if(R(UART+8)&0x1000u) { OUT->status=16; goto cleanup; }
 OUT->padding[1]|=32u;
 R(UART+0x20)=15; R(UART+0x18)=8; R(UART)=5;
 for(uint32_t attempt=0;attempt<HELLO_ATTEMPTS;attempt++) {
  /* RE remains enabled during external-watchdog service. CPU polling pauses;
   * receive overruns in that gap are retained and fail the result. */
  if(attempt && attempt%WATCHDOG_INTERVAL==0 && !watchdog()) goto cleanup;
  R(UART)=13;
  uint32_t acknowledged=0;
  for(uint32_t i=0;i<200000u;i++) if((R(UART+0x1c)&0x600000u)==0x600000u) { acknowledged=1; break; }
  if(!acknowledged) { OUT->status=17; goto cleanup; }
  OUT->padding[1]|=64u;
  OUT->attempts=attempt+1;
  for(uint32_t n=0;n<8;n++) {
   uint32_t ready=0;
   for(uint32_t i=0;i<200000u;i++) {
    capture_byte();
    if(R(UART+0x1c)&0x80u) { ready=1; break; }
   }
   if(!ready) { OUT->status=6; goto cleanup; }
   R(UART+0x28)=hello[n]; OUT->tx_count++;
  }
  uint32_t complete=0;
  for(uint32_t i=0;i<200000u;i++) {
   capture_byte();
   if(R(UART+0x1c)&0x40u) { complete=1; break; }
  }
  if(!complete) { OUT->status=6; goto cleanup; }
  R(UART)=5;
  if(!capture_ms(RECEIVE_MS)) { OUT->status=7; goto cleanup; }
  if(OUT->error) { OUT->status=9; goto cleanup; }
  if(OUT->found) break;
 }
 cleanup:
 R(0xe000e010)=0; R(UART)=0; R(0x50000400)&=~0x000f0000u; R(0x50000028)=8;
 if(OUT->writes) {
  const uint8_t order[4]={7,6,5,ROUTE_LEFT?3:4};
  for(uint32_t i=0;i<4;i++) if(!write_yhm(order[i],OUT->baseline[order[i]])) OUT->restore_failure|=1u<<order[i];
 }
 OUT->restore_mask=read_yhm(OUT->restored);
 if(OUT->restore_mask!=0x3ff || OUT->restore_failure) OUT->status=8;
 for(uint32_t i=0;i<10;i++) if(OUT->baseline[i]!=OUT->restored[i]) OUT->status=8;
 reset_release(); gpio_restore(OUT->registers[11]);
 done:
 OUT->magic=0x37545352;
 uint32_t h=2166136261u;
 for(uint32_t i=0;i<252;i++) { h^=bytes[i]; h*=16777619u; }
 OUT->checksum=h;
 for(;;) { if(watchdog_descriptor_allowed()) call(0x08002cb9); R(0x40003000)=0xaaaa; }
}
