export type AgentExecutionType = "deterministic_adapter" | "reviewed_pipeline"
export type AgentExecutionStatus = "invoked" | "completed" | "blocked" | "failed"

export interface PublicAgentExecutionRecord {
  record_id: string
  call_id: string
  round_no: number
  attempt: number
  execution_type: AgentExecutionType
  agent: string
  stage: string
  status: AgentExecutionStatus
  timestamp: string
  input_refs: string[]
  output_refs: string[]
  evidence_refs: string[]
  artifact_refs: string[]
  dependency_call_ids: string[]
  error?: { code: string; retryable: boolean }
}

export interface AgentExecutionLedgerOwner {
  session_id: string
  round_no: number
  execution_ledger: PublicAgentExecutionRecord[]
}

export function appendAgentExecution(
  owner: AgentExecutionLedgerOwner,
  input: Omit<PublicAgentExecutionRecord, "record_id" | "round_no" | "timestamp"> & {
    round_no?: number
    timestamp?: string
  },
): PublicAgentExecutionRecord {
  const record: PublicAgentExecutionRecord = {
    ...input,
    record_id: `${owner.session_id}-LEDGER-${String(owner.execution_ledger.length + 1).padStart(4, "0")}`,
    round_no: input.round_no ?? owner.round_no,
    timestamp: input.timestamp ?? new Date().toISOString(),
    input_refs: unique(input.input_refs),
    output_refs: unique(input.output_refs),
    evidence_refs: unique(input.evidence_refs),
    artifact_refs: unique(input.artifact_refs),
    dependency_call_ids: unique(input.dependency_call_ids),
  }
  owner.execution_ledger.push(record)
  return record
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}
