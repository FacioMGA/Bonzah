import {
  buildDocumentEmailGateway,
  buildDocumentStorageGateway,
  buildPolicyReadRepository,
} from './infraAdapters.js';

export function buildEmailPolicyDocumentsDeps() {
  return {
    repo: buildPolicyReadRepository(),
    storage: buildDocumentStorageGateway(),
    notifications: buildDocumentEmailGateway(),
  };
}
