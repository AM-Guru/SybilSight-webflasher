/* Right VBUS power-cycle under Case CPU takeover. Zero flash writes. */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
#ifndef CYCLES
#define CYCLES 3u
#endif
#ifndef OFF_MS
#define OFF_MS 3000u
#endif
#ifndef ON_MS
#define ON_MS 2000u
#endif
struct result {uint32_t magic,version,status,cycles,writes,mask,error,pad;uint8_t baseline[10],final_regs[10];uint32_t checksum;};
_Static_assert(sizeof(struct result)==56,"schema");
static void off(void){__asm__ volatile("cpsid i":::"memory");}
static void call(uint32_t a){((void(*)(void))(uintptr_t)a)();off();}
static uint32_t wait_tick(void){for(uint32_t i=0;i<200000u;i++)if(R(0xe000e010u)&0x10000u)return 1;return 0;}
static uint32_t delay_ms(uint32_t ms){R(0xe000e014u)=63999u;R(0xe000e018u)=0;R(0xe000e010u)=5u;for(uint32_t i=0;i<ms;i++){if(!wait_tick()){OUT->error|=0x100u;return 0;}R(0x40003000u)=0xaaaau;}R(0xe000e010u)=0;return 1;}
static uint32_t read_yhm(volatile uint8_t*out){uint32_t mask=0;for(uint32_t i=0;i<10;i++){uint8_t v=0;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&v);off();out[i]=v;if(ok)mask|=1u<<i;}return mask;}
static uint32_t write_yhm(uint32_t index,uint8_t value){if(index<3||index>7)return 0;OUT->writes|=1u<<index;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,const void*))(uintptr_t)0x08009109u)(index,1,&value);off();return ok;}
void bridge_main(void){
 volatile uint8_t*b=(volatile uint8_t*)OUT;for(uint32_t i=0;i<56;i++)b[i]=0;OUT->version=1;
 call(0x08004eed);call(0x08008439);call(0x08006a41);call(0x08002889);
 R(0xe000e010)=0;R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0x40003000)=0xaaaa;
 OUT->mask=read_yhm(OUT->baseline);if(OUT->mask!=0x3ffu){OUT->status=1;goto done;}
 for(uint32_t c=0;c<CYCLES;c++){
  if(!write_yhm(4,0xae)){OUT->status=2;goto done;}
  if(!delay_ms(OFF_MS)){OUT->status=7;goto done;}
  if(!write_yhm(4,0xaf)){OUT->status=3;goto done;}
  if(!delay_ms(ON_MS)){OUT->status=7;goto done;}
  OUT->cycles=c+1u;call(0x08002cb9u);
 }
 OUT->mask=read_yhm(OUT->final_regs);OUT->status=(OUT->mask==0x3ffu && OUT->final_regs[4]==0xaf)?0:4;
done:OUT->magic=0x31534e53;uint32_t h=2166136261u;for(uint32_t i=0;i<52;i++){h^=b[i];h*=16777619u;}OUT->checksum=h;
 R(0xe000ed0cu)=0x05fa0004u;for(;;){}
}
