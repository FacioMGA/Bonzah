// App-layer entrypoint for issue-readiness. It wires the repository port once,
// then re-exports the domain evaluator for HTTP/app callers.
import { configureIssueReadinessRepository } from '../domain/issueReadinessRepositoryPort.js';
import * as repository from './read/issueReadinessRepository.js';

configureIssueReadinessRepository(repository);

export * from '../domain/issueReadiness.js';
