import { describe, expect, test } from "bun:test"
import { appendAgentExecution, type AgentExecutionLedgerOwner } from "../src/orchestration/agent-execution-ledger"

describe("agent execution ledger foundation", () => {
  test("appends state transitions without overwriting history", () => {
    const owner: AgentExecutionLedgerOwner = {
      session_id: "SESSION-LEDGER-1",
      round_no: 2,
      execution_ledger: [],
    }
    const invocation = {
      call_id: "CALL-PROFILE-1",
      attempt: 1,
      execution_type: "deterministic_adapter" as const,
      agent: "profile-builder",
      stage: "profile_synthesis",
      input_refs: ["diagnosis-result"],
      output_refs: [],
      evidence_refs: ["K001:F001", "K001:F001"],
      artifact_refs: [],
      dependency_call_ids: [],
    }
    appendAgentExecution(owner, { ...invocation, status: "invoked", timestamp: "2026-08-11T00:00:00.000Z" })
    appendAgentExecution(owner, { ...invocation, status: "completed", output_refs: ["profile-result"], timestamp: "2026-08-11T00:00:01.000Z" })

    expect(owner.execution_ledger).toHaveLength(2)
    expect(owner.execution_ledger.map((entry) => entry.status)).toEqual(["invoked", "completed"])
    expect(owner.execution_ledger.map((entry) => entry.record_id)).toEqual([
      "SESSION-LEDGER-1-LEDGER-0001",
      "SESSION-LEDGER-1-LEDGER-0002",
    ])
    expect(owner.execution_ledger[0]!.evidence_refs).toEqual(["K001:F001"])
  })

  test("keeps only caller-provided real references", () => {
    const owner: AgentExecutionLedgerOwner = { session_id: "SESSION-LEDGER-2", round_no: 1, execution_ledger: [] }
    appendAgentExecution(owner, {
      call_id: "CALL-C-1",
      attempt: 1,
      execution_type: "reviewed_pipeline",
      agent: "role-c-reviewed-pipeline",
      stage: "assessment",
      status: "completed",
      input_refs: ["profile"],
      output_refs: ["DELIVERY-REAL-1"],
      evidence_refs: ["trace:RUN-1:1"],
      artifact_refs: ["ARTIFACT-REAL-1"],
      dependency_call_ids: [],
    })

    expect(owner.execution_ledger[0]).toMatchObject({
      output_refs: ["DELIVERY-REAL-1"],
      evidence_refs: ["trace:RUN-1:1"],
      artifact_refs: ["ARTIFACT-REAL-1"],
    })
  })
})
