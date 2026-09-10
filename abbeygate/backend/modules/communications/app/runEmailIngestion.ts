/**
 * runEmailIngestion — selects an ingestion adapter and runs the ingest
 * pipeline (ADR-0044). One app entrypoint the HTTP route + scheduler use.
 */

import { loadSampleInbox, listSampleConversations } from '../infra/ingest/sampleInboxAdapter.js';
import { parseUpload, type UploadPayload } from '../infra/ingest/uploadAdapter.js';
import { fetchGraphMessages } from '../infra/ingest/outlookGraphAdapter.js';
import { ingestEmails, type IngestEmailsResult, type IngestSource, type IngestTarget } from './ingestEmails.js';

// App-layer re-export so HTTP transport never reaches into infra directly.
export { listSampleConversations };

export interface RunEmailIngestionInput {
  source: IngestSource;
  actorId?: string;
  /** sample: optional conversation/file filter. */
  filterKey?: string;
  /** Optional explicit business-object link (verified, never forced). */
  target?: IngestTarget;
  /** upload: JSON messages or raw .eml/.txt files. */
  upload?: UploadPayload;
  /** graph: mailbox UPN + token override + count. */
  graph?: { accessToken?: string; mailbox?: string; top?: number };
}

export async function runEmailIngestion(input: RunEmailIngestionInput): Promise<IngestEmailsResult> {
  const messages = await (async () => {
    switch (input.source) {
      case 'sample':
        return loadSampleInbox(input.filterKey);
      case 'upload':
        if (!input.upload) throw new Error('upload payload required for source=upload');
        return parseUpload(input.upload);
      case 'graph':
        return fetchGraphMessages(input.graph ?? {});
      default:
        throw new Error(`unknown ingestion source: ${String(input.source)}`);
    }
  })();

  return ingestEmails({ messages, source: input.source, actorId: input.actorId, target: input.target });
}
