"""Run schema-12 emitted code through the schema-11 native/UART fixture set."""
from case_native_task_hello import validate as base
from case_armed_sbl_probe.protocol import configuration, decode

HARDWARE_DERIVED_CASE = "empty-case-disabled-uart-brr-zero"
CASES = base.CASES + (HARDWARE_DERIVED_CASE,)


def run(stock_wrapped, patched, hook, case):
    old_configuration, old_decode = base.configuration, base.decode
    base.configuration, base.decode = configuration, decode
    try:
        result = base.run(
            stock_wrapped,
            patched,
            hook,
            "left-valid" if case == HARDWARE_DERIVED_CASE else case,
            initial_brr=0 if case == HARDWARE_DERIVED_CASE else 64,
        )
    finally:
        base.configuration, base.decode = old_configuration, old_decode
    result["case"] = case
    evidence = result.get("evidence")
    if evidence and not case.startswith("bad-") and case not in (
        "unarmed",
        "route-mismatch",
        "scheduler-stopped",
        "interrupts-masked",
        "reset-flag-missing",
        "tick-disabled",
        "tick-reload",
        "clock",
        "clock-source",
        "core-clock",
        "uart-live",
        "uart-layout",
        "gpio-not-output",
    ):
        if evidence["status"] == 0 and not 14_900 <= evidence["insertionWaitHalTicks"] <= 15_100:
            raise AssertionError("schema-12 insertion wait differs")
    result["caseBusyLockWaitFixture"] = True
    result["initialDisabledUartBrrFixture"] = (
        0 if case == HARDWARE_DERIVED_CASE else 64
    )
    result["boundary"] = (
        "Actual guard/hook/pulse/GPIO/busy/osDelay wrapper/scheduler getter instructions; "
        "the 15-second tick window, RTOS scheduling, UART/FIFO effects, protected SBL and "
        "physical insertion/reset are fixtures."
    )
    return result


def validate(stock_wrapped, patched, hook):
    for case in CASES:
        result = run(stock_wrapped, patched, hook, case)
        print(f"PASS {case}", flush=True)
        yield result
