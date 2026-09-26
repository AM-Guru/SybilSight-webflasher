import assert from "node:assert/strict";
import test from "node:test";

import { preferredG2CaseTransport } from "../src/lib/serial.js";
import { explainG2CaseSelectionError } from "../src/lib/casePortSelectionError.js";

test("WebUSB is the preferred G2 Case transport when both APIs are available", () => {
  assert.equal(
    preferredG2CaseTransport({ webUsb: true, webSerial: true }),
    "webusb",
  );
});

test("Web Serial remains the compatibility fallback", () => {
  assert.equal(
    preferredG2CaseTransport({ webUsb: false, webSerial: true }),
    "serial",
  );
  assert.equal(
    preferredG2CaseTransport({ webUsb: false, webSerial: false }),
    null,
  );
});

test("an empty or canceled G2 Case picker gives a usable next step for both transports", () => {
  const usbError = Object.assign(new Error("No device selected."), { name: "NotFoundError" });
  const serialError = Object.assign(new Error("No port selected by the user."), { name: "NotFoundError" });
  const usb = explainG2CaseSelectionError(usbError, "WebUSB");
  const serial = explainG2CaseSelectionError(serialError, "Web Serial");
  assert.match(usb.message, /canceled.*USB Serial.*select that row.*picker was empty.*data-capable USB cable.*Web Serial fallback/i);
  assert.match(serial.message, /canceled.*USB Serial.*select that row.*picker was empty.*data-capable USB cable.*WebUSB/i);
  assert.equal(usb.cause, usbError);
  assert.equal(serial.cause, serialError);
  const transportFailure = new Error("Failed to claim interface");
  assert.equal(explainG2CaseSelectionError(transportFailure, "WebUSB"), transportFailure);
});
