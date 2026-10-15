/* Volatile Case recovery qualification. Stage 0: no YHM writes, no temple TX.
 * Records stock clock and UART setup for a later separately qualified probe. */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
struct result { uint32_t magic,version,status,phases,writes,baseline_mask,restore_mask,error,restore_failure,stage,variant,reserved; uint8_t baseline[10],restored[10],padding[4],raw[128]; uint32_t registers[13],checksum; };
_Static_assert(sizeof(struct result)==256,"schema");
static void off(void){__asm__ volatile("cpsid i":::"memory");}
static void call(uint32_t a){((void(*)(void))(uintptr_t)a)();off();}
static uint32_t read(volatile uint8_t *out){uint32_t m=0;for(uint32_t i=0;i<10;i++){uint8_t b=0;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&b);off();out[i]=b;if(ok)m|=1u<<i;}return m;}
void bridge_main(void){volatile uint8_t*b=(volatile uint8_t*)OUT;for(uint32_t i=0;i<256;i++)b[i]=0;OUT->version=3;
 call(0x08004eed);call(0x08008439);call(0x08006a41);call(0x08002889);
 R(0xe000e010)=0;R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0x40003000)=0xaaaa;
 R(0x40021034)|=3;R(0x200000a0)=8;R(0x200000a4)=0;R(0x200000a8)=0;R(0x200000ac)=2;R(0x200000b0)=0;
 *(volatile uint8_t*)0x20000114=0;*(volatile uint8_t*)0x200000bf=1;for(uint32_t i=0;i<5;i++)R(0x2000007c+4*i)=0;
 OUT->baseline_mask=read(OUT->baseline);
 const uint8_t expected[10]={0x81,0x11,4,0xaf,0xaf,3,0x81,0x20,0x33,0xff};
 if(OUT->baseline_mask!=0x3ff){OUT->status=1;goto done;}
 for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=expected[i]){OUT->status=1;goto done;}
 /* Same native temple UART initializer used by reviewed HELLO bridge. */
 call(0x08006cf9);OUT->stage=1;
 const uint32_t addresses[13]={0x40021000,0x40021008,0x4002100c,0x40004800,0x40004804,0x40004808,0x4000480c,0x4000481c,0x50000000,0x50000400,0x50000420,0x50000424,0x200000f0};
 for(uint32_t i=0;i<13;i++)OUT->registers[i]=R(addresses[i]);
 /* Exact peripheral cleanup from reviewed V7 bridge 0x20010A50. */
 R(0x40004800)=0;R(0x50000400)&=~0x000f0000u;R(0x50000028)=8;
 OUT->restore_mask=read(OUT->restored);if(OUT->restore_mask!=0x3ff)OUT->status=2;
 for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=OUT->restored[i])OUT->status=2;
 done:OUT->magic=0x31534e53;uint32_t h=2166136261;for(uint32_t i=0;i<252;i++){h^=b[i];h*=16777619;}OUT->checksum=h;
 for(;;){call(0x08002cb9);R(0x40003000)=0xaaaa;}
}
