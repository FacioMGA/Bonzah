## CHAMPS Recovery Classification

### This PR changes

- [ ] test substrate only
- [ ] test assertions only (implementation-detail cleanup)
- [ ] production behavior
- [ ] both tests and production behavior

### If behavior changed

- [ ] product/architecture signoff recorded
- [ ] behavior change documented in changelog/architecture notes

### Failure type addressed

- [ ] Type A - substrate failure
- [ ] Type B - implementation-detail failure
- [ ] Type C - behavioral regression

### Behavioral proof

- [ ] includes or updates at least one golden-path behavioral proof
- [ ] explains what observable contract remains protected

## Frontend CHAMPS Recovery Guardrails

### Classification for this PR

- [ ] Type A - substrate/path/alias/barrel drift
- [ ] Type B - DTO/model/props contract drift
- [ ] Type C - behavioral/UX regression signal

### Contract and behavior truth

- [ ] behavior changed? yes/no explicitly called out in PR description
- [ ] product contract changed? yes/no explicitly called out in PR description
- [ ] no raw API DTO types are consumed directly in UI-heavy surfaces/components
- [ ] any DTO -> product model mapping added/updated is explicit and product-owned

### Anti-theater checks

- [ ] no net-new `any`
- [ ] no `unknown as` / brute-force cast introduced without explicit justification
- [ ] no assertion removal or test weakening just to satisfy type-check

### Evidence gates

- [ ] `npm run type-check` is green
- [ ] touched behavior flows validated (tests and/or focused manual proof)

