#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
struct result {uint32_t magic,version,status,mask;uint8_t regs[10];uint8_t pad[2];uint32_t checksum;};
_Static_assert(sizeof(struct result)==32,"schema");
static void off(void){__asm__ volatile("cpsid i":::"memory");}
static void call(uint32_t a){((void(*)(void))(uintptr_t)a)();off();}
void bridge_main(void){
 volatile uint8_t*b=(volatile uint8_t*)OUT;for(uint32_t i=0;i<32;i++)b[i]=0;OUT->version=1;
 call(0x08004eed);call(0x08008439);call(0x08006a41);call(0x08002889);
 R(0xe000e010)=0;R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0x40003000)=0xaaaa;
 uint32_t mask=0;for(uint32_t i=0;i<10;i++){uint8_t v=0;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&v);off();OUT->regs[i]=v;if(ok)mask|=1u<<i;}
 OUT->mask=mask;OUT->status=(mask==0x3ffu)?0:1;
 OUT->magic=0x31534e53;uint32_t h=2166136261u;for(uint32_t i=0;i<28;i++){h^=b[i];h*=16777619u;}OUT->checksum=h;
 R(0xe000ed0cu)=0x05fa0004u;for(;;){}
}
