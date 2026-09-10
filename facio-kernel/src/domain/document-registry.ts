import { documentPackSchema, type DocumentPack } from '../contracts/documents.js';
import { hash, KernelError } from './canonical.js';

/** Registration is a composition-root decision; browser metadata cannot register templates. */
export class DocumentPackRegistry {
  private readonly packs = new Map<string, DocumentPack>();
  constructor(packs: DocumentPack[] = []) {
    for (const value of packs) {
      const pack = documentPackSchema.parse(value);
      const key = `${pack.id}@${pack.version}`;
      if (this.packs.has(key))
        throw new KernelError(
          'DUPLICATE_TEMPLATE',
          'Document pack version is already registered',
          422,
        );
      this.packs.set(key, structuredClone(pack));
    }
  }
  list() {
    return [...this.packs.values()].map((pack) => ({
      pack: structuredClone(pack),
      packHash: hash(pack),
    }));
  }
  get(id: string, version: string) {
    const pack = this.packs.get(`${id}@${version}`);
    if (!pack)
      throw new KernelError(
        'DOCUMENT_PACK_NOT_REGISTERED',
        'This exact document pack is not registered',
        422,
      );
    return structuredClone(pack);
  }
}
