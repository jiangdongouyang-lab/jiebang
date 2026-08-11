import { describe, expect, test } from "bun:test"
import { appendAgentExecution, redactPublicText, summarizeAgentCollaboration, type AgentExecutionLedgerOwner } from "../src/orchestration/agent-execution-ledger"
import { createLearningOrchestratorApiHandler } from "../src/orchestration/learning-orchestrator-api"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("agent execution ledger", () => {
  test("appends ordered records without overwriting prior attempts", () => {
    const owner: AgentExecutionLedgerOwner = { session_id: "SESSION-1", round_no: 2, execution_ledger: [] }
    const base = {
      call_id: "CALL-1",
      attempt: 1,
      execution_type: "deterministic_adapter" as const,
      agent: "profile-builder",
      stage: "objective_diagnosis",
      summary: "profile adapter",
      input_refs: ["diagnosis-result"],
      output_refs: ["profile:v1"],
      evidence_refs: [],
      artifact_refs: [],
      dependency_call_ids: [],
    }
    appendAgentExecution(owner, { ...base, status: "invoked", timestamp: "2026-08-11T00:00:00.000Z" })
    appendAgentExecution(owner, { ...base, status: "completed", timestamp: "2026-08-11T00:00:01.000Z" })

    expect(owner.execution_ledger.map((entry) => entry.record_id)).toEqual([
      "SESSION-1-LEDGER-0001",
      "SESSION-1-LEDGER-0002",
    ])
    expect(owner.execution_ledger.map((entry) => entry.status)).toEqual(["invoked", "completed"])
    expect(owner.execution_ledger.every((entry) => entry.round_no === 2)).toBe(true)
  })

  test("deduplicates references and removes sensitive names and private absolute paths", () => {
    const owner: AgentExecutionLedgerOwner = { session_id: "SESSION-2", round_no: 1, execution_ledger: [] }
    appendAgentExecution(owner, {
      call_id: "CALL-2",
      attempt: 1,
      execution_type: "reviewed_pipeline",
      agent: "code-lab",
      stage: "assessment",
      status: "completed",
      summary: "reviewed public release",
      input_refs: ["profile", "profile", "api_key:abc", "/home/private/artifact"],
      output_refs: ["role-c:public-release", "code_lab_secure"],
      evidence_refs: ["role-c:review-reports"],
      artifact_refs: ["role-c:artifact"],
      dependency_call_ids: [],
    })

    expect(owner.execution_ledger[0]!.input_refs).toEqual(["profile"])
    expect(owner.execution_ledger[0]!.output_refs).toEqual(["role-c:public-release"])
  })

  test("redacts secrets and private paths from public summaries and errors", () => {
    expect(redactPublicText("Bearer abc.def token=secret /home/alice/run.json C:\\Users\\alice\\run.json")).toBe(
      "Bearer [REDACTED] token=[REDACTED] [PRIVATE_PATH] [PRIVATE_PATH]",
    )
  })

  test("derives collaboration metrics from the latest state of each call", () => {
    const owner: AgentExecutionLedgerOwner = { session_id: "SESSION-3", round_no: 1, execution_ledger: [] }
    const add = (callId: string, status: "invoked" | "completed" | "blocked", attempt = 1, deps: string[] = []) => appendAgentExecution(owner, {
      call_id: callId, attempt, execution_type: "external_port", agent: "port", stage: "assessment", status,
      summary: status, input_refs: [], output_refs: [], evidence_refs: [],
      artifact_refs: status === "completed" ? ["artifact:public"] : [], dependency_call_ids: deps,
    })
    add("CALL-A", "invoked")
    add("CALL-A", "completed")
    add("CALL-B", "invoked", 2, ["CALL-MISSING"])
    add("CALL-B", "blocked", 2, ["CALL-MISSING"])

    expect(summarizeAgentCollaboration(owner.execution_ledger)).toEqual({
      total_calls: 2,
      completed_calls: 1,
      blocked_calls: 1,
      failed_calls: 0,
      active_calls: 0,
      completion_rate: 0.5,
      retry_attempts: 1,
      calls_with_artifact_refs: 1,
      artifact_reference_rate: 1,
      unresolved_dependency_refs: 1,
    })
  })

  test("publishes the ledger on create and replays it unchanged through GET", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "agent-ledger-api-"))
    try {
      const handle = createLearningOrchestratorApiHandler({ data_root: dataRoot })
      const headers = { "content-type": "application/json", authorization: "Bearer learner-ledger-1" }
      const created = await handle(new Request("http://localhost/orchestrator/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: "SESSION-LEDGER-API",
          run_id: "RUN-LEDGER-API",
          mode: "deterministic",
          learner_request: { learner_id: "learner-ledger-1", goal: "学习 Python 循环" },
        }),
      }))
      expect(created.status).toBe(201)
      const createdBody = await created.json() as any
      expect(createdBody.execution_ledger).toHaveLength(3)
      expect(createdBody.execution_ledger.every((entry: any) => entry.execution_type === "deterministic_adapter")).toBe(true)
      expect(createdBody.collaboration_metrics).toMatchObject({ total_calls: 3, completed_calls: 2, active_calls: 1 })

      const restored = await handle(new Request("http://localhost/orchestrator/sessions/SESSION-LEDGER-API", {
        headers: { authorization: "Bearer learner-ledger-1" },
      }))
      expect((await restored.json() as any).execution_ledger).toEqual(createdBody.execution_ledger)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
