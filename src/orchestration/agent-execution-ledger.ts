export type AgentExecutionType =
  | "opencode_subagent"
  | "deterministic_adapter"
  | "reviewed_pipeline"
  | "external_port"
  | "orchestrator_decision"

export type AgentExecutionStatus = "invoked" | "completed" | "waiting_for_user" | "blocked" | "failed"

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
  summary: string
  input_refs: string[]
  output_refs: string[]
  evidence_refs: string[]
  artifact_refs: string[]
  dependency_call_ids: string[]
  error?: { code: string; message: string; retryable: boolean }
}

export interface PublicAgentCollaborationMetrics {
  total_calls: number
  completed_calls: number
  blocked_calls: number
  failed_calls: number
  active_calls: number
  completion_rate: number
  retry_attempts: number
  calls_with_artifact_refs: number
  artifact_reference_rate: number
  unresolved_dependency_refs: number
}

export type AgentExecutionLedgerOwner = {
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
    input_refs: uniquePublicRefs(input.input_refs),
    output_refs: uniquePublicRefs(input.output_refs),
    evidence_refs: uniquePublicRefs(input.evidence_refs),
    artifact_refs: uniquePublicRefs(input.artifact_refs),
    dependency_call_ids: [...new Set(input.dependency_call_ids)],
    summary: redactPublicText(input.summary),
    ...(input.error ? { error: { ...input.error, message: redactPublicText(input.error.message) } } : {}),
  }
  owner.execution_ledger.push(record)
  return record
}

export function redactPublicText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/][^\s,;]+|\/(?:home|Users)\/[^\s,;]+)/g, "[PRIVATE_PATH]")
}

export function summarizeAgentCollaboration(records: PublicAgentExecutionRecord[]): PublicAgentCollaborationMetrics {
  const latest = new Map<string, PublicAgentExecutionRecord>()
  for (const record of records) latest.set(record.call_id, record)
  const calls = [...latest.values()]
  const completed = calls.filter((record) => record.status === "completed")
  const knownCallIds = new Set(records.map((record) => record.call_id))
  const dependencyRefs = new Set(records.flatMap((record) => record.dependency_call_ids))
  const completedCallsWithArtifacts = completed.filter((record) => record.artifact_refs.length > 0).length
  return {
    total_calls: calls.length,
    completed_calls: completed.length,
    blocked_calls: calls.filter((record) => record.status === "blocked").length,
    failed_calls: calls.filter((record) => record.status === "failed").length,
    active_calls: calls.filter((record) => record.status === "invoked" || record.status === "waiting_for_user").length,
    completion_rate: ratio(completed.length, calls.length),
    retry_attempts: records.filter((record) => record.status === "invoked" && record.attempt > 1).length,
    calls_with_artifact_refs: completedCallsWithArtifacts,
    artifact_reference_rate: ratio(completedCallsWithArtifacts, completed.length),
    unresolved_dependency_refs: [...dependencyRefs].filter((callId) => !knownCallIds.has(callId)).length,
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function uniquePublicRefs(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0 && !looksSensitive(value)))]
}

function looksSensitive(value: string): boolean {
  return /(?:authorization|api[_-]?key|token|secret|hidden[_-]?test|reference[_-]?solution|assessment_secure|code_lab_secure)/i.test(value)
    || /(?:^[A-Za-z]:[\\/]|^\/home\/|^\/Users\/)/.test(value)
}
