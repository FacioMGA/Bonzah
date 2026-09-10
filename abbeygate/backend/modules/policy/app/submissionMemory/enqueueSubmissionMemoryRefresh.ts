// App-layer re-export so HTTP transport never imports infra directly
// (mirrors claims' app/mailgraph/enqueueClaimMemoryRefresh.ts).
export { enqueueSubmissionMemoryRefresh } from '../../infra/submissionMemory/enqueueSubmissionMemoryRefresh.js';
