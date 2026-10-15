/* SPDX-License-Identifier: MIT
 * Volatile STM32G0 Case 1.2.57 sensing experiment. No temple UART or flash API.
 * Stock 0xCE34 water-sense selection only; ADC values have no calibrated units.
 */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define RESULT ((volatile struct result *)(uintptr_t)0x20011a00u)
#define ADC 0x40012400u
#define PHASES 10u
#ifndef SENSE_VARIANT
#define SENSE_VARIANT 0
#endif
_Static_assert(SENSE_VARIANT==0 || SENSE_VARIANT==1,"fixed sensing variants only");
#define LOOPS 200000u
struct result {
 uint32_t magic, version, status, phases, write_mask, baseline_mask;
 uint32_t restore_mask, adc_error, restore_fail, adc_init_stage, reserved0, reserved1;
 uint8_t baseline[10], restored[10], padding[4];
 uint32_t raw[PHASES][8], trimmed[PHASES];
 uint8_t selected[PHASES][10];
 uint32_t fallback_raw[PHASES][8], fallback_trimmed[PHASES];
 uint8_t fallback_selected[PHASES][10];
 uint32_t fallback_mask, checksum;
};
_Static_assert(sizeof(struct result)==1000,"host schema");
static void irq_off(void) { __asm__ volatile("cpsid i" ::: "memory"); }
static void call0(uint32_t address) { ((void (*)(void))(uintptr_t)address)(); irq_off(); }
static void settle(void) { for (volatile uint32_t i=0;i<150000u;i++) __asm__ volatile("nop"); }
static uint32_t read_yhm(volatile uint8_t *out) {
 uint32_t mask=0;
 for(uint32_t i=0;i<10;i++) {
  uint8_t v=0;
  uint32_t ok=((uint32_t (*)(uint32_t,uint32_t,void *))(uintptr_t)0x08009041u)(i,1,&v);
  irq_off(); out[i]=v; if(ok)mask|=1u<<i;
 }
 return mask;
}
static uint32_t write_yhm(uint32_t index,uint8_t value) {
 /* All callers are fixed sensing values or the captured baseline, indexes 3..6. */
 if(index<3u || index>6u)return 0;
 RESULT->write_mask|=1u<<index;
 uint32_t ok=((uint32_t (*)(uint32_t,uint32_t,const void *))(uintptr_t)0x08009109u)(index,1,&value);
 irq_off(); return ok;
}
static uint32_t baseline_allowed(void) {
 const uint8_t fixed[10]={0x81,0x11,0x04,0xaf,0xaf,0x03,0x81,0x20,0x33,0xff};
 for(uint32_t i=0;i<10;i++)
  if(RESULT->baseline[i]!=(i==8 && RESULT->baseline[8]==0x22 ? 0x22:fixed[i]))return 0;
 return 1;
}
static uint32_t restore(void) {
 if(RESULT->write_mask) {
  /* Restore mux/config before the original per-side output state. */
  const uint8_t order[4]={6,5,3,4};
  for(uint32_t j=0;j<4;j++)
   if(!write_yhm(order[j],RESULT->baseline[order[j]]))RESULT->restore_fail|=1u<<order[j];
 }
 RESULT->restore_mask=read_yhm(RESULT->restored);
 if(RESULT->restore_mask!=0x3ffu || RESULT->restore_fail)return 0;
 for(uint32_t i=0;i<10;i++)if(RESULT->baseline[i]!=RESULT->restored[i])return 0;
 return 1;
}
static uint32_t wait_bits(uint32_t offset,uint32_t mask,uint32_t set) {
 for(uint32_t n=0;n<LOOPS;n++)if(((REG(ADC+offset)&mask)!=0u)==set)return 1;
 return 0;
}
static uint32_t adc_stop(void) {
 if(REG(ADC+8)&4u) {REG(ADC+8)|=16u;if(!wait_bits(8,4u|16u,0))return 0;}
 if(REG(ADC+8)&1u) {REG(ADC+8)|=2u;if(!wait_bits(8,1u|2u,0))return 0;}
 return 1;
}
static uint32_t sample(uint32_t phase,uint32_t fallback) {
 volatile uint32_t *raw=fallback?RESULT->fallback_raw[phase]:RESULT->raw[phase];
 uint32_t total=0,high=0,low=0xffffffffu;
 REG(ADC)=0x1fu; REG(ADC+8)|=1u;
 if(!wait_bits(0,1u,1)) {RESULT->adc_error=1;goto fail;}
 REG(ADC+8)|=4u;
 for(uint32_t i=0;i<8;i++) {
  if(!wait_bits(0,4u,1)){RESULT->adc_error=2;goto fail;}
  uint32_t value=REG(ADC+0x40);
  if(value>4095u){RESULT->adc_error=3;goto fail;}
  raw[i]=value; total+=value;
  if(value>high)high=value;if(value<low)low=value;
 }
 if(!adc_stop()){RESULT->adc_error=4;return 0;}
 /* Avoid runtime division helper; total is bounded by 8*4095. */
 volatile uint32_t numerator=total-high-low;
 uint32_t quotient=0;
 while(numerator>=6u){numerator-=6u;quotient++;}
 if(fallback)RESULT->fallback_trimmed[phase]=quotient;else RESULT->trimmed[phase]=quotient;return 1;
fail:
 (void)adc_stop();return 0;
}
void bridge_main(void) {
 volatile uint8_t *bytes=(volatile uint8_t *)RESULT;
 for(uint32_t i=0;i<sizeof(*RESULT);i++)bytes[i]=0;
 RESULT->version=2;
 /* Same stock clock/GPIO initialization as the existing hardware-proven bridge. */
 call0(0x08004eedu);call0(0x08008439u);call0(0x08006a41u);call0(0x08002889u);
 REG(0xe000e010u)=0;REG(0xe000e180u)=0xffffffffu;REG(0xe000e280u)=0xffffffffu;
 REG(0x40003000u)=0xaaaau;
 REG(0x40021034u)|=3u;
 REG(0x200000a0u)=8;REG(0x200000a4u)=0;REG(0x200000a8u)=0;
 REG(0x200000acu)=2;REG(0x200000b0u)=0;
 *(volatile uint8_t *)(uintptr_t)0x20000114u=0;
 for(uint32_t i=0;i<5;i++)REG(0x2000007cu+4*i)=0;
 *(volatile uint8_t *)(uintptr_t)0x200000bfu=1;
 RESULT->baseline_mask=read_yhm(RESULT->baseline);
 if(RESULT->baseline_mask!=0x3ffu || !baseline_allowed()){RESULT->status=1;goto done;}
 /* ADC init/calibration runs before any YHM writes; reset descriptor state. */
 for(uint32_t i=0;i<104;i++)*(volatile uint8_t *)(uintptr_t)(0x200008e4u+i)=0;
 RESULT->adc_init_stage=1;call0(0x080068f1u);RESULT->adc_init_stage=2;
 REG(0xe000e180u)=0xffffffffu;REG(0xe000e280u)=0xffffffffu;
 RESULT->reserved0=SENSE_VARIANT;RESULT->reserved1=REG(ADC+0x28u);
 /* Stock sequencer uses F sentinels in unused ranks; rank 1 must be channel 4. */
 if((RESULT->reserved1&15u)!=4u || (REG(ADC+0x0cu)&0x00200018u)!=0x00200000u){RESULT->status=6;goto cleanup;}
 if(REG(0x20000940u) || (REG(0x2000093cu)&0x10u)){RESULT->status=6;goto cleanup;}
 for(uint32_t phase=0;phase<PHASES;phase++) {
  uint32_t side=phase&1u;
  call0(0x08002cb9u);
  uint8_t output=SENSE_VARIANT?0xae:0xaf;
  uint8_t selector=SENSE_VARIANT?(side?0x87:0x85):(side?0x8d:0x8b);
  if(!write_yhm(5,3) || !write_yhm(3+side,output) || !write_yhm(6,selector)) {RESULT->status=2;goto cleanup;}
  settle();
  /* Match stock order: no diagnostic ACMD reads between mux write and ADC. */
  if(!sample(phase,0)){RESULT->status=4;goto cleanup;}
  if(read_yhm(RESULT->selected[phase])!=0x3ffu){RESULT->status=3;goto cleanup;}
  for(uint32_t i=0;i<10;i++) {
   uint8_t expected=i==6?selector:i==3+side?output:(SENSE_VARIANT && i==1)?(uint8_t)(RESULT->baseline[1]&~(side?0x10u:1u)):RESULT->baseline[i];
   if(RESULT->selected[phase][i]!=expected){RESULT->status=3;goto cleanup;}
  }
  if(SENSE_VARIANT && RESULT->trimmed[phase]<=620u) {
   uint8_t bias=side?7u:11u;
   if(!write_yhm(5,bias)){RESULT->status=2;goto cleanup;}
   settle();
   if(!sample(phase,1)){RESULT->status=4;goto cleanup;}
   if(read_yhm(RESULT->fallback_selected[phase])!=0x3ffu){RESULT->status=3;goto cleanup;}
   for(uint32_t i=0;i<10;i++) {
    uint8_t expected=i==6?selector:i==5?bias:i==3+side?output:i==1?(uint8_t)(RESULT->baseline[1]&~(side?0x10u:1u)):RESULT->baseline[i];
    if(RESULT->fallback_selected[phase][i]!=expected){RESULT->status=3;goto cleanup;}
   }
   RESULT->fallback_mask|=1u<<phase;
  }
  if(!restore()){RESULT->status=5;goto done;}
  RESULT->phases=phase+1;
 }
cleanup:
 if(!restore())RESULT->status=5;
done:
 /* Fixed retained result; no serial writer, temple frame, or flash mutation. */
 RESULT->magic=0x31534e53u;
 uint32_t hash=2166136261u;
 for(uint32_t i=0;i<sizeof(*RESULT)-4;i++){hash^=bytes[i];hash*=16777619u;}
 RESULT->checksum=hash;
 for(;;){call0(0x08002cb9u);REG(0x40003000u)=0xaaaau;}
}
