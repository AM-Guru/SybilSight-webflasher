/* SRAM left read-only version control using complete pinned stock UART path.
 * Custom SysTick updates only HAL timeout counter; no RTOS scheduler is started.
 * No flash writes, no temple reset, one fixed 5-byte version request. */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
struct result{uint32_t magic,version,status,count,writes,baseline_mask,restore_mask,error,restore_failure,stage,tx_count,reserved;uint8_t baseline[10],restored[10],padding[4],raw[128];uint32_t registers[13],checksum;};
_Static_assert(sizeof(struct result)==256,"schema");
static void off(void){__asm__ volatile("cpsid i":::"memory");}
static void on(void){__asm__ volatile("cpsie i":::"memory");}
static void call(uint32_t a){((void(*)(void))(uintptr_t)a)();off();}
void tick_handler(void){R(0x20000120u)++;R(0x40003000u)=0xaaaau;}
static uint32_t read_yhm(volatile uint8_t*out){uint32_t m=0;for(uint32_t i=0;i<10;i++){uint8_t v=0;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&v);off();out[i]=v;if(ok)m|=1u<<i;}return m;}
static uint32_t write_yhm(uint32_t i,uint8_t v){if(i<3||i>7)return 0;OUT->writes|=1u<<i;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,const void*))(uintptr_t)0x08009109u)(i,1,&v);off();return ok;}
static uint32_t wait_ms(uint32_t ms){uint32_t begin=R(0x20000120);on();for(uint32_t n=0;n<500000u;n++)if((uint32_t)(R(0x20000120)-begin)>=ms){off();return 1;}off();return 0;}
void bridge_main(void){volatile uint8_t*b=(volatile uint8_t*)OUT;for(uint32_t i=0;i<256;i++)b[i]=0;OUT->version=5;
 call(0x08004eed);call(0x08008439);call(0x08006a41);call(0x08002889);R(0xe000e010)=0;R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0x40003000)=0xaaaa;
 R(0x40021034)|=3;R(0x200000a0)=8;R(0x200000a4)=0;R(0x200000a8)=0;R(0x200000ac)=2;R(0x200000b0)=0;*(volatile uint8_t*)0x20000114=0;*(volatile uint8_t*)0x200000bf=1;for(uint32_t i=0;i<5;i++)R(0x2000007c+4*i)=0;
 OUT->baseline_mask=read_yhm(OUT->baseline);const uint8_t expected[10]={0x81,0x11,4,0xaf,0xaf,3,0x81,0x20,0x33,0xff};
 if(OUT->baseline_mask!=0x3ff){OUT->status=1;goto done;}for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=expected[i]){OUT->status=1;goto done;}
 call(0x08006cf9);OUT->stage=1;OUT->registers[0]=R(0x40021008);OUT->registers[1]=R(0x4002100c);OUT->registers[2]=R(0x4000480c);
 if(OUT->registers[0]!=0x12||OUT->registers[1]!=0x32020802||OUT->registers[2]!=64){OUT->status=3;goto cleanup;}
 /* Only SysTick is enabled; its RAM vector increments the stock HAL counter. */
 R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0xe000ed08)=0x20010000;R(0x20000120)=0;R(0xe000e014)=63999;R(0xe000e018)=0;R(0xe000e010)=7;
 if(!wait_ms(2)){OUT->status=3;goto cleanup;}
 ((void(*)(uint32_t,uint32_t,uint32_t))(uintptr_t)0x08004e9fu)(0x50000000u,8u,1u);off();
 if(!write_yhm(5,3)||!write_yhm(6,0xc1)||!write_yhm(3,0xa6)||!wait_ms(30)||!write_yhm(7,3)){OUT->status=4;goto cleanup;}
 const uint8_t request[5]={0x24,0,0,0,0xa6};
 for(uint32_t i=0;i<128;i++)*(volatile uint8_t*)(0x20000664u+i)=0;
 OUT->stage=2;on();OUT->registers[8]=((uint32_t(*)(uint32_t,const void*,uint32_t,uint32_t))(uintptr_t)0x08002745u)(1u,request,5u,1u);off();OUT->tx_count=5;
 OUT->registers[3]=R(0x40004800);OUT->registers[4]=R(0x50000000);OUT->registers[5]=R(0x50000400);OUT->registers[6]=R(0x50000014);OUT->registers[7]=R(0x50000414);OUT->registers[9]=R(0x20000120);
 for(uint32_t i=0;i<128;i++)OUT->raw[i]=*(volatile uint8_t*)(0x20000664u+i);OUT->count=128;OUT->stage=3;
 cleanup:off();R(0xe000e010)=0;R(0x40004800)=0;R(0x50000400)&=~0x000f0000u;R(0x50000028)=8;
 if(OUT->writes){const uint8_t order[4]={7,6,5,3};for(uint32_t i=0;i<4;i++)if(!write_yhm(order[i],OUT->baseline[order[i]]))OUT->restore_failure|=1u<<order[i];}
 OUT->restore_mask=read_yhm(OUT->restored);if(OUT->restore_mask!=0x3ff||OUT->restore_failure)OUT->status=8;for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=OUT->restored[i])OUT->status=8;
 done:OUT->magic=0x31534e53;uint32_t h=2166136261u;for(uint32_t i=0;i<252;i++){h^=b[i];h*=16777619u;}OUT->checksum=h;for(;;){call(0x08002cb9);R(0x40003000)=0xaaaa;}
}
