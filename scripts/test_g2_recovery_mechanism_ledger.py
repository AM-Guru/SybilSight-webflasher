import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
GOAL = ROOT / "work/usb-stock-recovery-20261104/goal"
LEDGER = GOAL / "finite-recovery-mechanism-ledger.json"
STATE = GOAL / "GOAL-STATE.json"
DOC = ROOT / "docs/g2-wired-recovery-goal.md"


class RecoveryMechanismLedgerTests(unittest.TestCase):
    def test_inventory_is_finite_unique_and_present_in_narrative(self):
        ledger = json.loads(LEDGER.read_text())
        rows = ledger["mechanisms"]
        ids = [row["id"] for row in rows]
        self.assertEqual(ids, [f"W{index:02d}" for index in range(1, 24)])
        self.assertEqual(len(ids), len(set(ids)))
        narrative = DOC.read_text()
        for identifier in ids:
            self.assertIn(f"| {identifier} |", narrative)
        output = next(row for row in rows if row["id"] == "W16")
        self.assertFalse(output["physicalOutputVoltageVerified"])
        self.assertFalse(output["apolloResetVerified"])
        self.assertEqual(output["templeFirmwareImageBytesSent"], 0)
        self.assertEqual(
            hashlib.sha256(Path(output["evidence"]).read_bytes()).hexdigest(),
            output["evidenceSha256"],
        )
        ota = next(row for row in rows if row["id"] == "W17")
        self.assertEqual(ota["id"], "W17")
        self.assertFalse(ota["apolloResetVerified"])
        self.assertEqual(ota["templeFirmwareImageBytesSent"], 0)
        self.assertEqual(
            hashlib.sha256(Path(ota["evidence"]).read_bytes()).hexdigest(),
            ota["evidenceSha256"],
        )
        reset = next(row for row in rows if row["id"] == "W18")
        self.assertTrue(reset["caseResetConfirmed"])
        self.assertFalse(reset["physicalApolloResetVerified"])
        self.assertEqual(
            hashlib.sha256(Path(reset["evidence"]).read_bytes()).hexdigest(),
            reset["evidenceSha256"],
        )
        edge = next(row for row in rows if row["id"] == "W19")
        self.assertTrue(edge["leftCaptureQualified"] and edge["rightCaptureQualified"])
        self.assertTrue(edge["exactCaseFlashSramAndOutputRestoredBothRoutes"])
        self.assertEqual(edge["validSblStatusFrames"], 0)
        self.assertFalse(edge["physicalApolloResetVerified"])
        for name in ("combinedEvidence", "leftEvidence", "rightEvidence", "postReadOnlyEvidence"):
            self.assertEqual(
                hashlib.sha256(Path(edge[name]).read_bytes()).hexdigest(),
                edge[name + "Sha256"],
            )
        off_reset = next(row for row in rows if row["id"] == "W20")
        self.assertTrue(off_reset["leftCaptureQualified"] and off_reset["rightCaptureQualified"])
        self.assertTrue(off_reset["exactCaseFlashSramAndOutputRestoredBothRoutes"])
        self.assertEqual(off_reset["validSblStatusFrames"], 0)
        self.assertFalse(off_reset["physicalApolloResetVerified"])
        for name in ("combinedEvidence", "leftEvidence", "rightEvidence", "postReadOnlyEvidence"):
            self.assertEqual(
                hashlib.sha256(Path(off_reset[name]).read_bytes()).hexdigest(),
                off_reset[name + "Sha256"],
            )
        hello = next(row for row in rows if row["id"] == "W21")
        self.assertTrue(hello["leftCaptureQualified"] and hello["rightCaptureQualified"])
        self.assertEqual(hello["validSblStatusFrames"], 0)
        self.assertEqual(hello["fixedHelloBytesSentPerRoute"], 160)
        self.assertFalse(hello["rightInitialTransactionRestoredStock"])
        self.assertTrue(hello["rightRestoreOnlyRestoredStock"])
        for name in ("combinedEvidence", "leftEvidence", "rightEvidence", "rightRestoreOnlyEvidence", "postReadOnlyEvidence"):
            self.assertEqual(
                hashlib.sha256(Path(hello[name]).read_bytes()).hexdigest(),
                hello[name + "Sha256"],
            )
        slow = next(row for row in rows if row["id"] == "W22")
        self.assertTrue(slow["leftCaptureQualified"] and slow["rightCaptureQualified"])
        self.assertTrue(slow["guardedCaseStockRestoredBothRoutes"])
        self.assertEqual(slow["validSblStatusFrames"], 0)
        self.assertEqual(slow["fixedHelloBytesSentPerRoute"], 160)
        for name in ("combinedEvidence", "leftEvidence", "rightEvidence", "postReadOnlyEvidence"):
            self.assertEqual(
                hashlib.sha256(Path(slow[name]).read_bytes()).hexdigest(),
                slow[name + "Sha256"],
            )

    def test_proof_rules_and_immediate_order_preserve_target_identity(self):
        ledger = json.loads(LEDGER.read_text())
        self.assertEqual(
            ledger["rules"],
            {
                "silentProbeIsRecovery": False,
                "caseOnlyExecutionIsRecovery": False,
                "secondaryIdentityMayBindOriginal": False,
                "writerMayRunWithoutTargetStatus": False,
            },
        )
        sequence = ledger["immediateSequence"]
        self.assertEqual(len(sequence), 4)
        self.assertIn("device-bound INFO0/INFOC", sequence[0])
        self.assertIn("bind identity", sequence[1])
        self.assertIn("normal wired OTA dry run", sequence[1])
        self.assertIn("CRC-valid original SBL STATUS", sequence[2])
        self.assertIn("bind route/baud/storage", sequence[2])
        self.assertIn("hash-pinned schema-13 stock writer", sequence[2])
        self.assertIn("both original temples boot matching stock firmware", sequence[3])

    def test_state_points_to_ledger_and_exact_baud_artifacts(self):
        state = json.loads(STATE.read_text())
        self.assertEqual(state["finiteMechanismLedger"], str(LEDGER.resolve()))
        builds = state["stockSblImageCandidate"]["schema13BridgeBuilds"]
        for baud, expected_brr in (("115200", 556), ("1000000", 64)):
            row = builds[baud]
            bridge = Path(row["path"]) / "bridge.bin"
            self.assertEqual(row["templeUartBrr"], expected_brr)
            self.assertEqual(
                hashlib.sha256(bridge.read_bytes()).hexdigest(),
                row["bridgeSha256"],
            )

    def test_bootloader_log_discriminator_is_positive_only_and_not_a_mechanism(self):
        ledger = json.loads(LEDGER.read_text())
        self.assertEqual(len(ledger["diagnosticDiscriminators"]), 7)
        discriminator = ledger["diagnosticDiscriminators"][0]
        self.assertEqual(discriminator["id"], "D01")
        self.assertFalse(discriminator["recoveryMechanism"])
        adc = ledger["diagnosticDiscriminators"][3]
        self.assertEqual(adc["id"], "D04")
        self.assertFalse(adc["recoveryMechanism"])
        self.assertTrue(adc["exactYhmRestore"])
        self.assertFalse(adc["physicalPogoVoltageVerified"])
        for name in ("build", "hardwareAudit", "postReadOnlyAudit"):
            self.assertEqual(
                hashlib.sha256(Path(adc[name]).read_bytes()).hexdigest(),
                adc[name + "Sha256"],
            )
        concurrent_ble = ledger["diagnosticDiscriminators"][4]
        self.assertEqual(concurrent_ble["id"], "D05")
        self.assertFalse(concurrent_ble["recoveryMechanism"])
        self.assertFalse(concurrent_ble["physicalApolloResetVerified"])
        self.assertEqual(concurrent_ble["applicationVersionReplies"], 0)
        self.assertEqual(
            hashlib.sha256(Path(concurrent_ble["evidence"]).read_bytes()).hexdigest(),
            concurrent_ble["evidenceSha256"],
        )
        quiet = ledger["diagnosticDiscriminators"][5]
        self.assertEqual(quiet["id"], "D06")
        self.assertFalse(quiet["recoveryMechanism"])
        self.assertEqual(quiet["quietTransitionsPerRun"], 0)
        self.assertFalse(quiet["authenticatedTempleReplyObserved"])
        self.assertFalse(quiet["physicalApolloResetVerified"])
        self.assertTrue(quiet["caseStockRestoredAllRuns"])
        self.assertEqual(
            hashlib.sha256(Path(quiet["evidence"]).read_bytes()).hexdigest(),
            quiet["evidenceSha256"],
        )
        self.assertEqual(quiet["postReadOnlyApplicationVersionReplies"], 0)
        self.assertEqual(
            hashlib.sha256(Path(quiet["postReadOnlyEvidence"]).read_bytes()).hexdigest(),
            quiet["postReadOnlyEvidenceSha256"],
        )
        case_current = ledger["diagnosticDiscriminators"][6]
        self.assertEqual(case_current["id"], "D07")
        self.assertFalse(case_current["recoveryMechanism"])
        self.assertFalse(case_current["physicalApolloResetVerified"])
        self.assertEqual(case_current["medianCurrentRaw"], {
            "before": -9, "off": -9, "after": -9,
        })
        self.assertEqual(
            hashlib.sha256(Path(case_current["evidence"]).read_bytes()).hexdigest(),
            case_current["evidenceSha256"],
        )
        self.assertFalse(discriminator["addsTempleCommandBytes"])
        self.assertIn("inconclusive", discriminator["negativeEvidence"])
        state = json.loads(STATE.read_text())
        audit = json.loads(Path(state["evenBootloaderPogoLogAudit"]).read_text())
        emulator = json.loads(Path(state["evenBootloaderObserverEmulatorReport"]).read_text())
        self.assertTrue(audit["sameAsApplicationCaseUart2"])
        self.assertFalse(audit["physicalRouteVerified"])
        self.assertTrue(emulator["passed"])
        self.assertEqual(len(emulator["cases"]), state["evenBootloaderObserverFixturesPassed"])
        passive = ledger["diagnosticDiscriminators"][1]
        self.assertEqual(passive["id"], "D02")
        self.assertFalse(passive["recoveryMechanism"])
        self.assertFalse(passive["addsTempleCommandBytes"])
        self.assertTrue(passive["hardwareValidated"])
        self.assertTrue(passive["offlineExactPagePlanPrepared"])
        self.assertEqual(passive["offlineWriterCasesPassed"], 27)
        self.assertTrue(passive["hostMutationRunnerImplemented"])
        self.assertTrue(passive["hardwareStagingQualified"])
        self.assertTrue(passive["hardwareCaptureExecuted"])
        self.assertTrue(passive["originalTargetPresenceBound"])
        self.assertEqual(passive["originalTargetReceiveBytes"], 0)
        self.assertFalse(passive["exactLoggerMarkerObserved"])
        self.assertFalse(passive["physicalApolloResetVerified"])
        self.assertTrue(passive["caseStockRestored"])
        passive_manifest = json.loads(Path(state["passiveBootloaderLogPrototype"]).joinpath("validated-manifest.json").read_text())
        passive_emulator = json.loads(Path(state["passiveBootloaderLogEmulatorReport"]).read_text())
        self.assertEqual(passive_manifest["maxTempleBytesSent"], 0)
        self.assertTrue(passive_emulator["compiledHookExecuted"])
        writer = json.loads(Path(state["passiveBootloaderLogWriter"]).joinpath("validated-writer.json").read_text())
        plan = json.loads(Path(state["passiveBootloaderLogPlan"]).joinpath("plan.json").read_text())
        self.assertEqual(len(writer["cases"]), state["passiveBootloaderLogWriterCasesPassed"])
        self.assertEqual(len(plan["pages"]), 2)
        self.assertTrue(state["passiveBootloaderLogHostMutationRunnerImplemented"])
        self.assertTrue(state["passiveBootloaderLogStagingHardwareQualified"])
        self.assertTrue(state["passiveBootloaderLogHardwareExecuted"])
        self.assertTrue(state["passiveBootloaderLogOriginalTargetExecuted"])
        self.assertTrue(state["passiveBootloaderLogOriginalTargetBound"])
        audit = json.loads(Path(passive["captureAudit"]).read_text())
        presence = json.loads(Path(passive["presenceAudit"]).read_text())
        self.assertEqual(audit["outcome"], "passive-capture-complete-stock-restored-no-marker")
        self.assertEqual(audit["nativeHello"]["left"]["totalReceiveBytes"], 0)
        self.assertEqual(audit["templeCommandBytes"], 0)
        self.assertTrue(audit["transaction"]["fullStockVerified"])
        self.assertTrue(audit["transaction"]["sramRestored"])
        self.assertTrue(presence["operatorInsertionConfirmed"])
        self.assertTrue(presence["leftPresent"])
        self.assertTrue(presence["rightPresent"])
        self.assertTrue(presence["leftNoReply"])
        self.assertTrue(presence["rightNoReply"])
        edges = ledger["diagnosticDiscriminators"][2]
        self.assertEqual(edges["id"], "D03")
        self.assertFalse(edges["recoveryMechanism"])
        self.assertFalse(edges["addsTempleCommandBytes"])
        self.assertTrue(edges["hardwareValidated"])
        self.assertTrue(edges["compiledHookExecuted"])
        self.assertEqual(edges["staticCasesPassed"], 12)
        self.assertEqual(edges["compiledRuntimeCasesPassed"], 8)
        self.assertEqual(edges["hostTestsPassed"], 13)
        self.assertEqual(edges["offlineWriterCasesPassed"], 27)
        self.assertTrue(edges["hostMutationRunnerImplemented"])
        self.assertTrue(edges["hardwareStagingQualified"])
        self.assertTrue(edges["hardwareCaptureExecuted"])
        self.assertTrue(edges["emptyCaseControlQualified"])
        self.assertTrue(edges["originalTargetCaptureExecuted"])
        self.assertTrue(edges["originalTargetBound"])
        self.assertEqual(edges["originalTargetTransitions"], 0)
        self.assertEqual(edges["originalTargetLowSamples"], 0)
        self.assertEqual(edges["originalTargetReceiveBytes"], 0)
        self.assertTrue(edges["originalTargetStockRestored"])
        edge_manifest = json.loads(Path(edges["build"]).joinpath("validated-manifest.json").read_text())
        edge_emulator = json.loads(Path(edges["emulatorReport"]).read_text())
        edge_writer = json.loads(Path(state["pogoEdgeDiscriminatorWriter"]).joinpath("validated-writer.json").read_text())
        self.assertEqual(edge_manifest["maxTempleBytesSent"], 0)
        self.assertTrue(edge_manifest["rawInputTransitionCounters"])
        self.assertTrue(edge_emulator["passed"])
        self.assertTrue(edge_emulator["compiledHookExecuted"])
        self.assertEqual(len(edge_writer["cases"]), 27)
        straps = ledger["activeForcedStrapMatrix"]
        self.assertEqual(straps["hardwareCasesCompleted"], 8)
        self.assertEqual(straps["validSblStatusFrames"], 0)
        self.assertEqual(straps["caseFlashWrites"], 0)
        self.assertTrue(straps["stockCaseRestoredEveryCase"])
        self.assertFalse(straps["physicalApolloResetVerified"])
        cycles = ledger["chargerRouteCycleMatrix"]
        self.assertEqual(cycles["hardwareCasesCompleted"], 4)
        self.assertEqual(cycles["validSblStatusFrames"], 0)
        self.assertEqual(cycles["preCycleBytePattern"], "0000")
        self.assertEqual(cycles["preCycleUartErrorMaskPerCase"], 10)
        self.assertTrue(cycles["stockCaseRestoredEveryCase"])
        self.assertFalse(cycles["physicalApolloResetVerified"])


if __name__ == "__main__":
    unittest.main()
