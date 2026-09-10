// Public surface of the compliance app layer. Kept to exactly what the
// bind / payment / issue gates consume — screening is enforced there, not at
// quote time (ADR-0067). Import provider/repository internals from their own
// modules; do not widen this barrel back to `export *` (that re-exported
// symbols nobody imports through here and tripped the dead-code ratchet).
export { getSanctionsService } from './serviceFactory.js';
export { resolveIndividualScreeningSubject } from './sanctionsSubject.js';
export { SanctionsBlockError } from './sanctionsService.js';
