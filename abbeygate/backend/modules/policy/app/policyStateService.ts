// App-layer re-export of the canonical domain implementation.
// Exists so http/* (which cannot import domain/* directly per the layer
// contract) has a stable app entry point. Implementation lives in
// `../domain/policyStateService.ts`. See ADR-0011.
export * from '../domain/policyStateService.js';
