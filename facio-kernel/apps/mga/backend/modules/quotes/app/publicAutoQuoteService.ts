type PublicAutoQuoteServiceModule = typeof import('../../../products/motor/quotes/service.js');

const serviceModulePromise: Promise<PublicAutoQuoteServiceModule> = import('../../../products/motor/quotes/service.js');
const serviceModule: PublicAutoQuoteServiceModule = await serviceModulePromise;

export async function createPublicAutoSession(
  ...args: Parameters<PublicAutoQuoteServiceModule['createPublicAutoSession']>
): ReturnType<PublicAutoQuoteServiceModule['createPublicAutoSession']> {
  const mod = await serviceModulePromise;
  return mod.createPublicAutoSession(...args);
}

export async function forkPublicAutoPolicy(
  ...args: Parameters<PublicAutoQuoteServiceModule['forkPublicAutoPolicy']>
): ReturnType<PublicAutoQuoteServiceModule['forkPublicAutoPolicy']> {
  const mod = await serviceModulePromise;
  return mod.forkPublicAutoPolicy(...args);
}

export async function getOrQueuePublicIssuedPackLinks(
  ...args: Parameters<PublicAutoQuoteServiceModule['getOrQueuePublicIssuedPackLinks']>
): ReturnType<PublicAutoQuoteServiceModule['getOrQueuePublicIssuedPackLinks']> {
  const mod = await serviceModulePromise;
  return mod.getOrQueuePublicIssuedPackLinks(...args);
}

export async function getPublicIssueReadiness(
  ...args: Parameters<PublicAutoQuoteServiceModule['getPublicIssueReadiness']>
): ReturnType<PublicAutoQuoteServiceModule['getPublicIssueReadiness']> {
  const mod = await serviceModulePromise;
  return mod.getPublicIssueReadiness(...args);
}

export async function rateQuote(
  ...args: Parameters<PublicAutoQuoteServiceModule['rateQuote']>
): ReturnType<PublicAutoQuoteServiceModule['rateQuote']> {
  const mod = await serviceModulePromise;
  return mod.rateQuote(...args);
}

export async function unlockPublicAutoPolicy(
  ...args: Parameters<PublicAutoQuoteServiceModule['unlockPublicAutoPolicy']>
): ReturnType<PublicAutoQuoteServiceModule['unlockPublicAutoPolicy']> {
  const mod = await serviceModulePromise;
  return mod.unlockPublicAutoPolicy(...args);
}

export async function updatePublicAutoDraft(
  ...args: Parameters<PublicAutoQuoteServiceModule['updatePublicAutoDraft']>
): ReturnType<PublicAutoQuoteServiceModule['updatePublicAutoDraft']> {
  const mod = await serviceModulePromise;
  return mod.updatePublicAutoDraft(...args);
}

export function preserveIssueDetailsNonClobberFields(
  ...args: Parameters<PublicAutoQuoteServiceModule['preserveIssueDetailsNonClobberFields']>
): ReturnType<PublicAutoQuoteServiceModule['preserveIssueDetailsNonClobberFields']> {
  return serviceModule.preserveIssueDetailsNonClobberFields(...args);
}

export function filterQuoteDataPatchByStep(
  ...args: Parameters<PublicAutoQuoteServiceModule['filterQuoteDataPatchByStep']>
): ReturnType<PublicAutoQuoteServiceModule['filterQuoteDataPatchByStep']> {
  return serviceModule.filterQuoteDataPatchByStep(...args);
}
