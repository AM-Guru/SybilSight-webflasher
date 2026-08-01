// GENERATED FILE — do not edit by hand.
// Rebuild with: npm run archive:firmware
//
// Every Apollo-main payload that the temple writer is permitted to install.
// This table is the writer's own trust root: it is compiled into the bundle and
// is deliberately independent of the fetched firmware catalog, so a tampered
// index.json cannot widen what may be written to a temple.
//
// hardwareValidated marks images whose case-USB temple transfer has actually
// been exercised on hardware. Pinned-but-unvalidated images are still gated on
// exact hashes; they simply have no transfer evidence behind them yet.

export const TEMPLE_FLASH_TARGETS = Object.freeze([
  Object.freeze({
    imageSha256: "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0",
    mainSha256: "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
    mainBytes: 3539474,
    version: "2.2.6.10",
    label: "Legacy reviewed SybilSight CFW 2.2.6.10",
    hardwareValidated: true,
  }),
  Object.freeze({
    imageSha256: "4df14a0d7cf4ac6af6f16ed18f5cda7d782c73e07e6269f9b09062fe01ab3d36",
    mainSha256: "c392e91c22511249eed39375eeb81740aa289bb7a4b6498c7babb04f5cf3781b",
    mainBytes: 3541556,
    version: "2.2.6.12",
    label: "SybilSight CFW (2.2.6.12)",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86",
    mainSha256: "be8f5459e32065fbe3038accea49d418ba81884fc8ec4ed8927f37e219407dcf",
    mainBytes: 3542584,
    version: "2.2.6.11",
    label: "SybilSight CFW (2.2.6.11)",
    hardwareValidated: true,
  }),
  Object.freeze({
    imageSha256: "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
    mainSha256: "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863",
    mainBytes: 3523396,
    version: "2.2.6.10",
    label: "Stock Even Realities G2 2.2.6.10",
    hardwareValidated: true,
  }),
  Object.freeze({
    imageSha256: "f9a93621a7141e0ae54ca6371cd2f1b4afbffa61f302ace096e0656ba25b1754",
    mainSha256: "36cf41979ca1f6fbb5357ab728ab1d7daa6f36c1de7d6817f2fcf0b0f6a5090b",
    mainBytes: 3502504,
    version: "2.2.4.34",
    label: "Stock Even Realities G2 2.2.4.34",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "b3b0e213f7eb9568c97603a011b4a0261f9a4dbf9f7c933ff16b25aeb7efe0a6",
    mainSha256: "5497c4cdbb6b8ec83882ff8fab6093ad07ab38f7a317874d06942ca3898a19cf",
    mainBytes: 3367956,
    version: "2.2.0.24",
    label: "Stock Even Realities G2 2.2.0.24",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "75ca2a401f813cf23f864106f4dedbc7e00c4c4b37cd50dcf17f7e9fe503c63e",
    mainSha256: "32cec3ec3d3f76d91704187bf5265636896998bb9f51a79e512917fd690121d1",
    mainBytes: 3306316,
    version: "2.1.1.12",
    label: "Stock Even Realities G2 2.1.1.12",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "1aa72ae9bd4e291866193e80f3f950eb35450d87bd3eab1ed017cb5c3875b3fa",
    mainSha256: "511a82862fadf6f0c0f5609ddb91793143bf3593df14c0aea9023f1dac594f1a",
    mainBytes: 3300560,
    version: "2.1.1.8",
    label: "Stock Even Realities G2 2.1.1.8",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "4b0055531530b3206f7e3acf103e30edeba6c35ed746aba09e52083efb6a2592",
    mainSha256: "2557d7ce9364726e25266d276c0e5400475282cbe5a1c6c93d12cebbf41884f4",
    mainBytes: 3292228,
    version: "2.0.9.20",
    label: "Stock Even Realities G2 2.0.9.20",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "a5e74e6830f4d9f4b8d06e18f11fb7e8f57383e3204504c299c413ce44940c23",
    mainSha256: "2fd4a0317d1fff5e89da8961872efb7fd7436b7778cbfabf7117204d097d5531",
    mainBytes: 3276612,
    version: "2.0.8.20",
    label: "Stock Even Realities G2 2.0.8.20",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "47bdd17b9227d56566280fad42248dbecfe4fc70017ad9c74c3d949e27116b5e",
    mainSha256: "50f48eae3e031885086fa85d5e6f36d3d36582674adf5c6ec1d50da502f029eb",
    mainBytes: 3189184,
    version: "2.0.7.16",
    label: "Stock Even Realities G2 2.0.7.16",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "f3c4c40aa122f61e859b82ee5eaa296ac8fa3a96e7b9905fd8d112ded732c5da",
    mainSha256: "e295640f17a9a6c48734960f003ab663cf34b6835b212afa042db3c5703f5462",
    mainBytes: 3184984,
    version: "2.0.6.14",
    label: "Stock Even Realities G2 2.0.6.14",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "83e3cc196df2d7bd74f735f2ffbfd9f01c204da2cb73a1fb6fee5119f1125e21",
    mainSha256: "dfc0d525940547abb9645d60e1862c8b7e969af0794c851d0b6d1c69c3142c55",
    mainBytes: 3158492,
    version: "2.0.5.12",
    label: "Stock Even Realities G2 2.0.5.12",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "84866f11895c34d15838736a373a50f06765232e2561fedd8ba1b62ba509c09c",
    mainSha256: "5cd7785bb232c298d66c0655c1236c8b8924419bdd61b9b35cf0ff04bd18ff4c",
    mainBytes: 3069108,
    version: "2.0.3.20",
    label: "Stock Even Realities G2 2.0.3.20",
    hardwareValidated: false,
  }),
  Object.freeze({
    imageSha256: "d45005d5f75985339b234550b384899bb89fb37cfe4de4928abc9e882f0709e2",
    mainSha256: "ad951aec8e4140392c12715d2d1f8d575c8e288ab35331a635e2277cfb2b56fc",
    mainBytes: 2471336,
    version: "2.0.1.14",
    label: "Stock Even Realities G2 2.0.1.14",
    hardwareValidated: false,
  }),
]);

export function findTempleFlashTarget(imageSha256) {
  if (typeof imageSha256 !== "string") return null;
  const digest = imageSha256.toLowerCase();
  return TEMPLE_FLASH_TARGETS.find((t) => t.imageSha256 === digest) ?? null;
}
