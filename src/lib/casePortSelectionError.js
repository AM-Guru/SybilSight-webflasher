/** Chrome reports both an empty chooser and an explicit cancel as NotFoundError. */
export function explainG2CaseSelectionError(error, transport) {
  const message = String(error?.message ?? error ?? "");
  const notSelected = error?.name === "NotFoundError"
    || /no device selected|no port selected by the user/i.test(message);
  if (!notSelected) return error;
  const alternate = transport === "WebUSB" ? "Web Serial fallback" : "WebUSB";
  return new Error(
    `No G2 Case was selected in the ${transport} picker. If you canceled, retry when ready. `
    + `Chrome may call the Case "USB Serial"; select that row to enable Connect. `
    + `If the picker was empty, check that the Case is connected with a data-capable USB cable, `
    + `then reconnect it and try ${alternate}.`,
    { cause: error },
  );
}
