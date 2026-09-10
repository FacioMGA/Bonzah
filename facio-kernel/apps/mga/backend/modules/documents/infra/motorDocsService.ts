type MotorDocsModule = typeof import('../../../products/motor/documents/generateMotorDocPack.js');

const motorDocsModulePromise: Promise<MotorDocsModule> = import('../../../products/motor/documents/generateMotorDocPack.js');

export type MotorDocPack = import('../../../products/motor/documents/generateMotorDocPack.js').MotorDocPack;

export async function executeMotorDocPackGeneration(
  ...args: Parameters<MotorDocsModule['executeMotorDocPackGeneration']>
): ReturnType<MotorDocsModule['executeMotorDocPackGeneration']> {
  const mod = await motorDocsModulePromise;
  return mod.executeMotorDocPackGeneration(...args);
}
