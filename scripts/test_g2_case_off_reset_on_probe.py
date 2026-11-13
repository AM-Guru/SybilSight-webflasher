"""Offline cleanup checks for the seated output-off reset sequence."""

from g2_case_off_reset_on_probe import run


def exercise(monkeypatch, tmp_path, *, confirm: bool):
    import g2_case_off_reset_on_probe as probe

    class Port:
        is_open = True
        flag = 1
        last_write = b""

        def write(self, data):
            self.last_write = data
            return len(data)

        def flush(self):
            pass

        def reset_input_buffer(self):
            pass

        def close(self):
            self.is_open = False

    port = Port()
    live = {
        "caseSerial": probe.CASE_SERIAL, "case_version": "1.2.57",
        "left_present": True, "right_present": True, "ota_glasses": 0,
    }
    monkeypatch.setattr(probe, "preflight", lambda *_args: live)
    monkeypatch.setattr(probe, "_open_case_console", lambda _device: port)
    monkeypatch.setattr(probe, "status", lambda *_args: b"****** B200 vol:")
    monkeypatch.setattr(probe, "_drain_case_console", lambda *_args: (
        b"reset gls L & R, reason: cmd" if port.last_write == b"DEB0\n" and confirm else b""
    ))
    monkeypatch.setattr(probe, "send_output", lambda _port, packet, expected: (
        setattr(port, "flag", expected) or b"ACK ****** B200 vol:", True
    ))
    monkeypatch.setattr(probe, "read_yhm", lambda *_args: {
        "outputFlagInSameCapture": port.flag,
        "hardwareReg3": 0xAF if port.flag else 0xAE,
        "hardwareReg4": 0xAF if port.flag else 0xAE,
    })
    monkeypatch.setattr(probe, "query_route", lambda _device, route: {
        "route": route, "versionReply": {"version": "2.4.0.24"}
    })
    monkeypatch.setattr(probe.time, "sleep", lambda _seconds: None)
    result = run("fake-port", tmp_path / "audit.json")
    assert result["resetRequestsSent"] == 1
    assert result["onAcknowledgedAndFlagEnabled"] is True
    assert result["usbPortClosed"] is True
    assert port.flag == 1
    assert (tmp_path / "audit.json").exists()
    return result


def test_qualified_sequence(monkeypatch, tmp_path):
    result = exercise(monkeypatch, tmp_path, confirm=True)
    assert result["resetConfirmed"] is True
    assert result["outcome"] == "both-application-replies"


def test_missing_reset_confirmation_still_restores_output(monkeypatch, tmp_path):
    result = exercise(monkeypatch, tmp_path, confirm=False)
    assert result["resetConfirmed"] is False
    assert result["outcome"] == "failed-closed"

