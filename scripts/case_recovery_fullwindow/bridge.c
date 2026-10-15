/* Fixed, temporary right-temple reset + exact Ambiq HELLO. No flash APIs.
 * Clock, Case image and starting YHM state must match qualified stock.
 * UART RX is passive; TX is exactly 14559de900000800, once after stock reset.
 */
#include <stdint.h>
#define R(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define OUT ((volatile struct result *)(uintptr_t)0x20011a00u)
#define UART 0x40004800u
#ifndef CONTROL_LEFT
#define CONTROL_LEFT 0
#endif
#ifndef HELLO_BURSTS
#define HELLO_BURSTS 1
#endif
_Static_assert(HELLO_BURSTS==2000,"fixed schedules only");
struct result {uint32_t magic,version,status,count,writes,baseline_mask,restore_mask,error,restore_failure,stage,tx_count,reset_completed;uint8_t baseline[10],restored[10],padding[4],raw[128];uint32_t registers[13],checksum;};
_Static_assert(sizeof(struct result)==256,"fixed host schema");
static void off(void){__asm__ volatile("cpsid i":::"memory");}
static void call(uint32_t a){((void(*)(void))(uintptr_t)a)();off();}
static void gpio(uint32_t base,uint32_t mask,uint32_t high){((void(*)(uint32_t,uint32_t,uint32_t))(uintptr_t)0x08004e9fu)(base,mask,high);off();}
static void busy(uint32_t n){((void(*)(uint32_t))(uintptr_t)0x0800a7a3u)(n);off();}
static uint32_t wait_tick(void){for(uint32_t i=0;i<200000u;i++)if(R(0xe000e010u)&0x10000u)return 1;return 0;}
static uint32_t delay_ms(uint32_t ms){R(0xe000e014u)=63999u;R(0xe000e018u)=0;R(0xe000e010u)=5u;for(uint32_t i=0;i<ms;i++){if(!wait_tick()){OUT->error|=0x100u;return 0;}R(0x40003000u)=0xaaaau;}R(0xe000e010u)=0;return 1;}
static uint32_t reset_train(void){
#include "stock_waveform.inc"
 return 1;
}
static uint32_t read_yhm(volatile uint8_t*out){uint32_t mask=0;for(uint32_t i=0;i<10;i++){uint8_t v=0;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,void*))(uintptr_t)0x08009041u)(i,1,&v);off();out[i]=v;if(ok)mask|=1u<<i;}return mask;}
static uint32_t write_yhm(uint32_t index,uint8_t value){if(index<3||index>7)return 0;OUT->writes|=1u<<index;uint32_t ok=((uint32_t(*)(uint32_t,uint32_t,const void*))(uintptr_t)0x08009109u)(index,1,&value);off();return ok;}
static void capture_byte(void){uint32_t isr=R(UART+0x1c);OUT->error|=isr&15u;if(isr&0x20u){uint8_t b=(uint8_t)R(UART+0x24);OUT->registers[11]++;if(OUT->count<96u)OUT->raw[OUT->count++]=b;}if(isr&15u)R(UART+0x20)=isr&15u;}
static uint32_t capture_ms(uint32_t ms){R(0xe000e014u)=63999u;R(0xe000e018u)=0;R(0xe000e010u)=5u;for(uint32_t t=0;t<ms;t++){uint32_t ok=0;for(uint32_t i=0;i<200000u;i++){capture_byte();if(OUT->count>=96u)return 1;if(R(0xe000e010u)&0x10000u){ok=1;break;}}if(!ok){OUT->error|=0x100u;return 0;}R(0x40003000)=0xaaaa;OUT->registers[9]++;}R(0xe000e010)=0;return 1;}
void bridge_main(void){volatile uint8_t*b=(volatile uint8_t*)OUT;for(uint32_t i=0;i<256;i++)b[i]=0;OUT->version=4;
 call(0x08004eed);call(0x08008439);call(0x08006a41);call(0x08002889);R(0xe000e010)=0;R(0xe000e180)=0xffffffff;R(0xe000e280)=0xffffffff;R(0x40003000)=0xaaaa;
 R(0x40021034)|=3;R(0x200000a0)=8;R(0x200000a4)=0;R(0x200000a8)=0;R(0x200000ac)=2;R(0x200000b0)=0;*(volatile uint8_t*)0x20000114=0;*(volatile uint8_t*)0x200000bf=1;for(uint32_t i=0;i<5;i++)R(0x2000007c+4*i)=0;
 OUT->baseline_mask=read_yhm(OUT->baseline);const uint8_t expected[10]={0x81,0x11,4,0xaf,0xaf,3,0x81,0x20,0x33,0xff};
 if(OUT->baseline_mask!=0x3ff){OUT->status=1;goto done;}for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=expected[i]){OUT->status=1;goto done;}
 call(0x08006cf9);OUT->stage=1;
 OUT->registers[0]=R(0x40021000);OUT->registers[1]=R(0x40021008);OUT->registers[2]=R(0x4002100c);OUT->registers[3]=R(UART);OUT->registers[4]=R(UART+4);OUT->registers[5]=R(UART+8);OUT->registers[6]=R(UART+0xc);
 if(OUT->registers[1]!=0x12u||OUT->registers[2]!=0x32020802u||OUT->registers[3]!=9u||OUT->registers[4]!=0u||OUT->registers[6]!=64u){OUT->status=3;goto cleanup;}
 OUT->registers[12]=CONTROL_LEFT;
 if(CONTROL_LEFT){
  gpio(0x50000000u,8u,1u);
  if(!write_yhm(5,3)||!write_yhm(6,0xc1)||!write_yhm(CONTROL_LEFT==1?3u:4u,0xa6)||!delay_ms(30)||!write_yhm(7,CONTROL_LEFT==1?3u:5u)){OUT->status=4;goto cleanup;}
 }else{
  /* Stock right reset configuration: PB9 output push-pull, no pull, speed 3. */
  R(UART)=0;const uint32_t cfg[5]={0x200,1,0,3,0};((void(*)(uint32_t,const void*))(uintptr_t)0x08004d31u)(0x50000400u,cfg);off();
  if(!write_yhm(5,3)||!write_yhm(6,0xc1)||!write_yhm(4,0xa6)){OUT->status=4;goto cleanup;}
  if(!delay_ms(30)||!write_yhm(7,5)){OUT->status=4;goto cleanup;}
  OUT->stage=2;if(!reset_train()){OUT->status=5;goto cleanup;}OUT->reset_completed=1;
  R(0x50000400)=(R(0x50000400)&~0x000c0000u)|0x00080000u;
 }
 /* Native uncontrolled transfer reasserts PA3 after routing writes. */
 gpio(0x50000000u,8u,1u);
 /* Same TE-only => RE-only direction change as stock. */
 R(UART+0x20)=15u;R(UART+0x18)=8u;R(UART)=0;R(UART+0xcu)=556u;R(UART)=9u;OUT->stage=3;
 R(0x20000014u)=4u;R(0x20000018u)=1u;R(0x2000001cu)=0u;R(0x20000020u)=0u;R(0x20000024u)=0u;
 const uint8_t hello[8]={0x14,0x55,0x9d,0xe9,0,0,8,0};
 const uint8_t version[5]={0x24,0,CONTROL_LEFT==2?1:0,0,CONTROL_LEFT==2?0xa7:0xa6};
 const uint8_t *request=CONTROL_LEFT?version:hello;uint32_t length=CONTROL_LEFT?5u:8u;
 uint32_t bursts=CONTROL_LEFT?1u:HELLO_BURSTS;
 
 
 for(uint32_t burst=0;burst<bursts;burst++){
  if(burst){call(0x08006cf9u);gpio(0x50000000u,8u,1u);R(UART+0x20)=15u;R(UART+0x18)=8u;R(UART)=0;R(UART+0xcu)=556u;R(UART)=9u;}
  if(burst%8u==0u){call(0x08002cb9u);OUT->registers[10]++;}
  OUT->registers[8]=burst+1u;
  for(uint32_t n=0;n<length;n++){uint32_t ok=0;for(uint32_t i=0;i<200000u;i++)if(R(UART+0x1c)&0x80u){ok=1;break;}if(!ok){OUT->status=6;goto cleanup;}R(UART+0x28)=request[n];OUT->tx_count++;}
  uint32_t complete=0;for(uint32_t i=0;i<200000u;i++)if(R(UART+0x1c)&0x40u){complete=1;break;}
  if(!complete){OUT->status=6;goto cleanup;}call(0x08006c81u);R(UART)=0;R(UART+0xcu)=556u;R(UART)=5u;OUT->registers[7]=R(UART);
  if(!capture_ms(400u)){OUT->status=7;goto cleanup;}
  if(OUT->count>=96u){OUT->stage=5;goto cleanup;}
  if(OUT->error){OUT->status=9;goto cleanup;}
 }
 OUT->stage=4;
 cleanup:R(0xe000e010)=0;R(UART)=0;R(0x50000400)&=~0x000f0000u;R(0x50000028)=8;
 if(OUT->writes){const uint8_t order[4]={7,6,5,CONTROL_LEFT==1?3:4};for(uint32_t i=0;i<4;i++)if(!write_yhm(order[i],OUT->baseline[order[i]]))OUT->restore_failure|=1u<<order[i];}
 OUT->restore_mask=read_yhm(OUT->restored);if(OUT->restore_mask!=0x3ff||OUT->restore_failure)OUT->status=8;for(uint32_t i=0;i<10;i++)if(OUT->baseline[i]!=OUT->restored[i])OUT->status=8;
 done:OUT->magic=0x31534e53;uint32_t h=2166136261u;for(uint32_t i=0;i<252;i++){h^=b[i];h*=16777619u;}OUT->checksum=h;R(0xe000ed0c)=0x05fa0004u;for(;;){}
}
