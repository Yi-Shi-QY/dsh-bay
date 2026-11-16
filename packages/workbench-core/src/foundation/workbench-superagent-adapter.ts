/**
 * @deprecated The Workbench-owned control agent is now called Bay Agent.
 * Keep this module as a source compatibility bridge for early alpha clients.
 */
export {
  WorkbenchBayAgentAdapter as WorkbenchSuperAgentAdapter,
  buildWorkbenchBayAgentPromptContext as buildWorkbenchAgentPromptContext,
  captureWorkbenchBayAgentExecutionLease as captureWorkbenchAgentExecutionLease,
  isWorkbenchBayAgentExecutionCurrent as isWorkbenchAgentExecutionCurrent,
  renderWorkbenchBayAgentPromptContext as renderWorkbenchAgentPromptContext,
  workbenchBayAgentExecutionStaleReason as workbenchAgentExecutionStaleReason,
} from './workbench-bay-agent-adapter.ts'
export type {
  ApplyWorkbenchBayAreaAgentReportInputV1 as ApplyWorkbenchAreaAgentReportInputV1,
  BuildWorkbenchBayAgentPromptContextInputV1 as BuildWorkbenchAgentPromptContextInputV1,
  CaptureWorkbenchBayAgentExecutionLeaseInputV1 as CaptureWorkbenchAgentExecutionLeaseInputV1,
  CaptureWorkbenchBayAgentPromptInputV1 as CaptureWorkbenchAgentPromptInputV1,
  WorkbenchBayAgentExecutionLeaseV1 as WorkbenchAgentExecutionLeaseV1,
  WorkbenchBayAgentExecutionStaleReason as WorkbenchAgentExecutionStaleReason,
  WorkbenchBayAgentPromptContextV1 as WorkbenchAgentPromptContextV1,
  WorkbenchBayAgentReportResult as WorkbenchAgentReportResult,
  WorkbenchBayAgentWorkItemV1 as WorkbenchAgentWorkItemV1,
  WorkbenchBayAgentAdapterControlPlane as WorkbenchSuperAgentAdapterControlPlane,
} from './workbench-bay-agent-adapter.ts'
