# CFW seam map (2.2.9.22 keys → 2.2.10.10) with openCFW counterparts

Generated 2026-09-15 from `scripts/cfw/g2-2.2.10.10-address-profile.json`. Every `FW_*` function pointer the
patches call is listed with the reviewed derivation, which names the openCFW / Cordio / zlib / FreeRTOS
symbol where one is known. Use it to replace raw addresses with names when the patches move onto an
openCFW-derived tree.

| key (old) | new | used by | identity (from the review) |
|---|---|---|---|
| `0x440d9b` | `0x440d9b` | zlib_glue.c |  |
| `0x442389` | `0x442389` | zlib_glue.c | 2.2.10.69 FW_SEM_TAKE: FreeRTOS xQueueSemaphoreTake(handle, ticks) (same address in 2.2.9.22 and 2.2.10.10; |
| `0x442b65` | `0x442b65` | zlib_glue.c |  |
| `0x442c4d` | `0x442c4d` | zlib_glue.c |  |
| `0x442c8d` | `0x442c8d` | zlib_glue.c |  |
| `0x442cf3` | `0x442cf3` | zlib_glue.c |  |
| `0x4448e1` | `0x444909` | gesture_fwd.c |  |
| `0x458383` | `0x458703` | malloc.h |  |
| `0x4583c7` | `0x458747` | malloc.h |  |
| `0x45cfdd` | `0x45d35d` | als_sensor.c,mic_control.c,settings_ext.c,zlib_glue.c |  |
| `0x45e521` | `0x45e8a1` | gesture_fwd.c |  |
| `0x45e6e9` | `0x45ea69` | settings_ext.c |  |
| `0x4622d7` | `0x462657` | gesture_fwd.c |  |
| `0x4622ed` | `0x46266d` | gesture_fwd.c,zlib_glue.c |  |
| `0x46a39f` | `0x46a983` | settings_ext.c,zlib_glue.c |  |
| `0x46aac9` | `0x46b0ad` | mic_control.c | 2.2.10.62 FW_PEER_SEND: inter-temple common-data send (2.2.10.10 0x46b0ac, Thumb +1; |
| `0x46f137` | `0x46f71b` | gesture_fwd.c:asm |  |
| `0x4708d1` | `0x470eb5` | zlib_glue.c |  |
| `0x4745bd` | `0x475815` | BLE_FORCE_FAST_SITE callee |  |
| `0x479483` | `0x47a717` | zlib_glue.c |  |
| `0x4794cf` | `0x47a763` | zlib_glue.c |  |
| `0x479d83` | `0x47b017` | zlib_glue.c |  |
| `0x47c18d` | `0x47d429` | mic_control.c | 2.2.10.24 FW_CONN_FAST: connection-parameter fast-profile setter (2.2.10.10 0x47d428, Thumb +1; |
| `0x47ce03` | `0x47e09f` | zlib_glue.c |  |
| `0x47d809` | `0x47eaa5` | als_sensor.c,settings_ext.c |  |
| `0x47d90f` | `0x47ebab` | settings_ext.c |  |
| `0x47da6d` | `0x47ed09` | mic_control.c |  |
| `0x47eeb2` | `0x48016a` | validate_ring_battery_stock |  |
| `0x47eebf` | `0x480177` | ring predicate callee |  |
| `0x47efa8` | `0x480260` | validate_ring_battery_stock |  |
| `0x47efa9` | `0x480261` | ring_battery.c |  |
| `0x48c1e9` | `0x48d519` | malloc.h |  |
| `0x48c307` | `0x48d637` | malloc.h |  |
| `0x49da09` | `0x49ed3d` | settings_ext.c |  |
| `0x4a60c1` | `0x4a73f5` | zlib_glue.c |  |
| `0x4a9be2` | `0x4aaf16` | validate_ring_battery_stock |  |
| `0x4ac333` | `0x4ad667` | settings_ext.c |  |
| `0x4b2fed` | `0x4b4ea5` | ring predicate callee |  |
| `0x4b5be5` | `0x4b7ac9` | compass.c |  |
| `0x4b7b29` | `0x4b9a0d` | als_sensor.c |  |
| `0x4b80ef` | `0x4b9fd3` | als_sensor.c |  |
| `0x4b8161` | `0x4ba045` | als_sensor.c |  |
| `0x4b81d3` | `0x4ba0b7` | zlib_glue.c |  |
| `0x4beded` | `0x4c0cd1` | als_sensor.c |  |
| `0x4bef4b` | `0x4c0e2f` | als_sensor.c |  |
| `0x4bf177` | `0x4c105b` | als_sensor.c |  |
| `0x4bf483` | `0x4c1367` | als_sensor.c |  |
| `0x4ca71f` | `0x4cca83` | mic_control.c | 2.2.10.69 FW_DM_CONN_CCB: Cordio dmConnCcbById(connId) -> dmConnCcb_t* or NULL (2.2.10.10 0x4cca82, Thumb +1; |
| `0x4db279` | `0x4ddb05` | mic_control.c | 2.2.10.50 FW_DM_SET_PHY: Cordio DmSetPhy(connId, allPhys, txPhys, rxPhys, phyOptions) (2.2.10.10 0x4ddb04, Thumb +1; |
| `0x4e644f` | `0x4e8ce3` | texture_cache.c |  |
| `0x4e64a1` | `0x4e8d35` | texture_cache.c |  |
| `0x4e64fd` | `0x4e8d91` | texture_cache.c |  |
| `0x4ebad3` | `0x4ee367` | gesture_fwd.c |  |
| `0x4ebd09` | `0x4ee59d` | zlib_glue.c |  |
| `0x4ee3bb` | `0x4f0c4f` | zlib_glue.c |  |
| `0x4f3d77` | `0x4f660b` | zlib_glue.c |  |
| `0x4f3d8b` | `0x4f661f` | zlib_glue.c |  |
| `0x512d84` | `0x515634` | validate_ring_battery_stock |  |
| `0x512da3` | `0x515653` | ring dash getter callee |  |
| `0x516e75` | `0x519725` | zlib_glue.c |  |
| `0x516f0b` | `0x5197bb` | zlib_glue.c |  |
| `0x516fa9` | `0x519859` | zlib_glue.c |  |
| `0x517039` | `0x5198e9` | zlib_glue.c |  |
| `0x51c485` | `0x51ed29` | compass.c |  |
| `0x51d815` | `0x5200b9` | mic_control.c | 2.2.10.42 FW_PIN_WRITE: the board's logical-pin writer dispatcher (2.2.10.10 0x5200b8, Thumb +1; |
| `0x5410ef` | `0x543997` | mic_control.c | 2.2.10.69 FW_HCI_LE_SET_DATA_LEN: Cordio HciLeSetDataLen(handle, txOctets, txTime) (2.2.10.10 0x543996, Thumb +1; |
| `0x553d39` | `0x5565e1` | mic_control.c | 2.2.10.18 FW_CODEC_CTRL: thread.audio codec-control message poster (2.2.10.10 0x5565e0, Thumb +1). |
| `0x553d5b` | `0x556603` | mic_control.c | 2.2.10.28 FW_CODEC_PREP: codec-prep message poster the stock service_audio_manager acquire posts immediately before ctrl(1) (2.2.10.10 0x556602, Thumb +1; |
| `0x55d4d7` | `0x55fd7f` | zlib_glue.c |  |
| `0x55d55f` | `0x55fe07` | zlib_glue.c |  |
| `0x5681a9` | `0x56ac65` | mic_control.c | 2.2.10.46 FW_AUDM_ACQUIRE: service_audio_manager acquire (LEFT-only; |
| `0x568337` | `0x56adf3` | mic_control.c | 2.2.10.46 FW_AUDM_RELEASE: service_audio_manager release (LEFT-only); |
| `0x56873b` | `0x56b1f7` | mic_control.c | 2.2.10.51 FW_AUDM_PEER_MSG_ORIG: stock common-data handler for inter-temple frame 0x010C (2.2.10.10 0x56b1f6, Thumb +1; |
| `0x592d01` | `0x595905` | mic_control.c | 2.2.10.41 FW_CODEC_PWR_ON: gx8002 power ON (drv_gx8002b.c; |
| `0x592db5` | `0x5959b9` | mic_control.c | 2.2.10.41 FW_CODEC_PWR_OFF: gx8002 power OFF (drv_gx8002b.c; |
| `0x593139` | `0x595d3d` | mic_control.c | 2.2.10.62 FW_LC3_ENCODE_MONO: stock SVC_Lc3EncodeMono (2.2.10.10 0x595d3c, Thumb +1; |
| `0x593371` | `0x595f75` | mic_control.c |  |
| `0x5934c9` | `0x5960cd` | mic_control.c |  |
| `0x59f47d` | `0x5a2081` | zlib_glue.c |  |
| `0x5a8ca3` | `0x5ab8cb` | mic_control.c |  |
| `0x5a8d53` | `0x5ab97b` | mic_control.c |  |
| `0x5a8db9` | `0x5ab9e1` | mic_control.c |  |
| `0x5a8e0f` | `0x5aba37` | mic_control.c |  |
| `0x5ab2f1` | `0x5adf19` | mic_control.c |  |
| `0x5d60eb` | `0x5d8ddb` | zlib_glue.c | 2.2.10.69 FW_INFLATE_RESET: zlib 1.1.4 inflateReset (2.2.10.10 0x5d8dda, Thumb +1; |
| `0x5d612b` | `0x5d8e1b` | zlib_glue.c |  |
| `0x5d6167` | `0x5d8e57` | zlib_glue.c |  |
| `0x5d6235` | `0x5d8f25` | zlib_glue.c |  |
