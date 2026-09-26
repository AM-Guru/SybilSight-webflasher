// Release the local CH340 lease before a new chooser or page exit. Remote
// support owns its separate Case port and tears it down through its own path.
export async function releaseSelectedLocalCasePort({ portRef, sessionRef, remotePortRef }) {
  const port = portRef.current;
  if (!port || port === remotePortRef.current) return false;
  // Make stale analysis/actions unable to reuse this handle even if close
  // rejects because the device was unplugged during teardown.
  portRef.current = null;
  sessionRef.current = null;
  try {
    await port.close?.();
  } catch (error) {
    // Case ROM/application transitions can close Chrome's SerialPort before
    // the operator clicks Disconnect. Its lease is already gone in that case.
    if (!/port is already closed/i.test(String(error?.message ?? error))) {
      throw error;
    }
  }
  return true;
}
