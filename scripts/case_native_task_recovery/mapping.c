#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile uint32_t *)(uintptr_t)0x20011a00u)
void mapping_main(void) {
 __asm__ volatile("cpsid i":::"memory");
 OUT[0]=0x504d3247u;OUT[1]=1;OUT[2]=R(0x40022020u);OUT[3]=R(0x40022000u);
 OUT[4]=R(0x40022014u);OUT[5]=R(0x40022010u);OUT[6]=~OUT[2];
 volatile const uint8_t *p=(volatile const uint8_t*)OUT;uint32_t h=2166136261u;
 for(uint32_t i=0;i<28;i++){h^=p[i];h*=16777619u;}OUT[7]=h;
 for(;;)R(0x40003000u)=0xaaaau;
}
