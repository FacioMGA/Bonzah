function addTerm(terms: Set<string>, raw: unknown): void {
  const value = String(raw || '').trim();
  if (!value) return;
  terms.add(value);
}

function addPhoneTerms(terms: Set<string>, phone: string): void {
  const trimmed = String(phone || '').trim();
  if (!trimmed) return;
  addTerm(terms, trimmed);
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 6) addTerm(terms, digits);
}

export function buildAccountIntelligenceSearchTerms(input: {
  email?: string;
  phone?: string;
  policyNumbers?: string[];
  registrationNumbers?: string[];
}): string | null {
  const terms = new Set<string>();
  addTerm(terms, input.email);
  addPhoneTerms(terms, String(input.phone || ''));
  for (const policyNumber of input.policyNumbers || []) addTerm(terms, policyNumber);
  for (const registrationNumber of input.registrationNumbers || []) addTerm(terms, registrationNumber);
  const joined = Array.from(terms).join(' ');
  return joined || null;
}
