/* Exact two-page case writer. Data is compiled in; no address/data command. */
#include <stdint.h>
#include "pages.h"
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define CR R(0x40022014u)
#define SR R(0x40022010u)
#define ACR R(0x40022000u)
#define CFG ((volatile uint32_t *)(uintptr_t)0x20013f00u)
#define OUT ((volatile uint32_t *)(uintptr_t)0x20013a00u)
#define BUSY 0x70000u
#define ERRORS 0x83fau
static uint32_t fnv(volatile const uint8_t *p,uint32_t n) {
 uint32_t h=2166136261u;for(uint32_t i=0;i<n;i++){h^=p[i];h*=16777619u;}return h;
}
static uint32_t equal(volatile const uint32_t *p,const uint32_t *q) {
 for(uint32_t i=0;i<512;i++)if(p[i]!=q[i])return 0;return 1;
}
static uint32_t idle(void) {
 for(uint32_t i=0;i<1048576u;i++) {
  if(!(SR&BUSY))return 1;
  R(0x40003000u)=0xaaaau;
 }return 0;
}
__attribute__((noreturn)) static void finish(uint32_t status) {
 OUT[2]=status;OUT[3]=100;OUT[14]=SR;OUT[15]=CR;
 OUT[16]=(SR&BUSY)?1u:0u;
 OUT[0]=0x31574647u;OUT[63]=fnv((volatile const uint8_t*)OUT,252);
 for(;;)R(0x40003000u)=0xaaaau;
}
void writer_main(void) {
 __asm__ volatile("cpsid i":::"memory");
 for(uint32_t i=0;i<64;i++)OUT[i]=0;
 OUT[1]=10;OUT[3]=1;
 uint32_t page=CFG[3],mode=CFG[4],nonce=CFG[5];
 if(CFG[0]!=0x46573247u || CFG[1]!=0xb9a8cdb8u || CFG[2]!=10 || page>1 || mode>2 || !nonce || CFG[6] || CFG[7]!=fnv((volatile const uint8_t*)CFG,28))finish(1);
 CFG[0]=0;CFG[1]=0;OUT[5]=mode;OUT[6]=nonce;OUT[17]=page;
 if(R(0x1fff7590u)!=CASE_UID0 || R(0x1fff7594u)!=CASE_UID1 || R(0x1fff7598u)!=CASE_UID2)finish(2);
 if(R(0x40022020u)!=0xdeefe1aau)finish(3);
 if(*(volatile const uint16_t*)(uintptr_t)0x1fff75e0u!=512)finish(4);
 if(CR!=0xc0000000u)finish(5);
 if(!idle())finish(6);
 uint32_t address=page?0x0800d800u:0x08009800u;
 volatile uint32_t *destination=(volatile uint32_t*)(uintptr_t)address;
 const uint32_t *original=page?original1:original0;
 const uint32_t *patched=page?patched1:patched0;
 const uint32_t *target=mode==1?original:patched;
 OUT[4]=address;OUT[7]=fnv((volatile const uint8_t*)destination,2048);
 OUT[8]=fnv((const uint8_t*)target,2048);
 uint32_t original_matches=equal(destination,original),target_matches=equal(destination,target);
 OUT[18]=original_matches;OUT[19]=target_matches;
 /* Read-only qualification requires original stock, never mutates FLASH regs. */
 if(mode==2){if(!original_matches)finish(7);OUT[9]=OUT[7];finish(0);}
 if(target_matches){OUT[9]=OUT[7];finish(0);}
 if(mode==0 && !original_matches)finish(7);
 OUT[3]=2;
 uint32_t old_acr=ACR;
 /* Code/data/stack stay in SRAM. Disable instruction cache/prefetch, set WS=2. */
 ACR=(old_acr&~0x307u)|2u;
 ACR|=0x800u;ACR&=~0x800u;
 R(0x40022008u)=0x45670123u;R(0x40022008u)=0xcdef89abu;
 uint32_t status=0;
 if(CR!=0x40000000u){status=8;goto done;}
 SR=0x883fbu;
 /* OPTR and stock bank-selector audit bind these logical pages to bank2. */
 CR=0x40000000u|0x10002u|0x2000u|((page?27u:19u)<<3);
 OUT[10]=1;OUT[3]=3;
 if(!idle()){status=9;goto done;}
 if(SR&ERRORS){status=9;goto done;}
 CR=0x40000000u;
 for(uint32_t i=0;i<512;i++)if(destination[i]!=0xffffffffu){status=12;goto done;}
 OUT[3]=4;
 for(uint32_t i=0;i<512;i+=2) {
  if(target[i]==0xffffffffu && target[i+1]==0xffffffffu)continue;
  SR=0x883fbu;CR=0x40000001u;
  destination[i]=target[i];
  __asm__ volatile("isb 0xf":::"memory");
  destination[i+1]=target[i+1];
  OUT[11]++;
  if(!idle()){status=10;goto done;}
  if(SR&ERRORS){status=10;goto done;}
  CR=0x40000000u;
 }
 OUT[3]=5;
 if(!equal(destination,target)){status=11;goto done;}
 OUT[9]=fnv((volatile const uint8_t*)destination,2048);
done:
 /* No further controller or flash access while a timed-out operation is busy. */
 if(!(SR&BUSY)) {
  CR=0xc0000000u;
  ACR|=0x800u;ACR&=~0x800u;ACR=old_acr;
  OUT[12]=1;
 }
 finish(status);
}
