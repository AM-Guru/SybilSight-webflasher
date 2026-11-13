/* Guarded stock-task handoff. An unarmed/corrupt SRAM payload uses stock. */
#include <stdint.h>
#ifndef PAYLOAD_BYTES
#error Missing compiled SRAM identity
#endif
#ifndef PAYLOAD_FNV
#error Missing compiled SRAM identity
#endif
#define CFG ((volatile uint32_t *)(uintptr_t)0x20011f00u)
__attribute__((section(".text.entry"))) void trampoline(void) {
 uint32_t caller=(uint32_t)(uintptr_t)__builtin_return_address(0);
 if(CFG[0]==0x4b483247u && CFG[1]==0xb4b7cdb8u) {
  volatile const uint8_t *code=(volatile const uint8_t*)(uintptr_t)0x20010000u;
  uint32_t h=2166136261u;
  for(uint32_t i=0;i<PAYLOAD_BYTES;i++){h^=code[i];h*=16777619u;}
  if(h==PAYLOAD_FNV){((void(*)(uint32_t))(uintptr_t)0x20010001u)(caller);return;}
 }
 ((void(*)(void))(uintptr_t)0x0800b679u)();
}
