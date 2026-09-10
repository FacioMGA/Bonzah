import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { MOTOR_UW_CONFIG_FIXTURE } from '../../../../test/fixtures/motor/underwriting.js';
import { buildDefaultProgramMbeProductConfig } from '../../../mbe/domain/programProduct.js';
import { fixtureProductKit, fixtureProgrammeDefinition } from '../../../../products/programDefinitionFixtures.js';
import {
  getProgrammeDefinitionEditorDescriptor,
  validateProgramDefinitionComponents,
} from '../programRuntimeDefinitions.js';
import { parseImmutablePolicyDocumentConfiguration } from '../../../policy/app/productRegistryService.js';

beforeAll(() => {
  registerAllProducts();
});

const shared = {
  questionnaire: {
    requiredness: {},
    claimsContract: { fnol: {}, fullClaimForm: {} },
    sections: [{
      id: 'risk',
      title: 'Risk details',
      questions: [{ key: 'risk.reference', label: 'Risk reference', type: 'text' }],
    }],
  },
  workflow: { approvalRules: [], billing: {}, referralOnly: false, externalIssuance: { mode: 'NONE' } },
  channels: { questions: true, quote: true, payment: false },
  documents: {
    productKit: fixtureProductKit('abbeygate_motor'),
    issuedPack: { requiredTypes: ['MOTOR_CERTIFICATE_PDF'] },
    sources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }],
  },
};

describe('programme definition publication validation', () => {
  it('gets the editor descriptor from the registered product runtime', () => {
    expect(getProgrammeDefinitionEditorDescriptor('MOTOR')).toMatchObject({
      productType: 'MOTOR',
    });
    expect(getProgrammeDefinitionEditorDescriptor('MOTOR').components.map((component) => component.key))
      .toEqual(['underwriting', 'coverage', 'questionnaire', 'workflow', 'channels', 'documents']);
  });

  it('accepts an explicit complete automated programme definition', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
      },
    })).not.toThrow();
  });

  it('rejects missing channel configuration rather than inventing a default', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        channels: {},
      },
    })).toThrow('requires boolean questions');
  });

  it('rejects a questionnaire with no configured sections rather than using a product manifest', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        questionnaire: { requiredness: {}, claimsContract: { fnol: {}, fullClaimForm: {} } },
      },
    })).toThrow('requires at least one configured section');
  });

  it('rejects an unknown configured question type before it can reach a surface', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        questionnaire: {
          ...shared.questionnaire,
          sections: [{
            id: 'risk',
            title: 'Risk details',
            questions: [{ key: 'risk.reference', label: 'Risk reference', type: 'unknown-widget' }],
          }],
        },
      },
    })).toThrow('has unsupported type "unknown-widget"');
  });

  it('rejects an absent document kit rather than publishing placeholder legal content', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        documents: { productKit: null, issuedPack: { requiredTypes: ['MOTOR_CERTIFICATE_PDF'] }, sources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }] },
      },
    })).toThrow('Published product kit requires schemaVersion 1');
  });

  it('rejects a Green Card selection that omits its Motor authority field', () => {
    const productKit = fixtureProductKit('abbeygate_motor');
    const { greenCardAuthority: _greenCardAuthority, ...brandWithoutAuthority } = productKit.brand;
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        documents: {
          productKit: { ...productKit, brand: brandWithoutAuthority },
          issuedPack: { requiredTypes: ['MOTOR_GREEN_CARD_PDF'] },
          sources: [{ documentType: 'MOTOR_GREEN_CARD_PDF', sourceId: 'motor-green-card', sourceVersion: 'v2' }],
        },
      },
    })).toThrow('Published Motor product kit brand.greenCardAuthority is required');
  });

  it('requires an explicit manual coverage declaration for manually priced products', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'BUSINESS',
      pricingMode: 'MANUAL',
      components: {
        underwriting: {},
        coverage: { schemaVersion: 1, mode: 'MANUAL' },
        ...shared,
        documents: { productKit: fixtureProductKit('abbeygate_business'), issuedPack: { requiredTypes: [] }, sources: [] },
      },
    })).not.toThrow();
    expect(() => validateProgramDefinitionComponents({
      productType: 'BUSINESS',
      pricingMode: 'MANUAL',
      components: { underwriting: {}, coverage: {}, ...shared },
    })).toThrow('requires { schemaVersion: 1, mode: "MANUAL" }');
  });

  it('does not require Motor Green Card settings for a non-Motor programme', () => {
    const productKit = fixtureProductKit('abbeygate_business');
    const {
      greenCardAuthority: _greenCardAuthority,
      greenCardIssuerName: _greenCardIssuerName,
      greenCardIssuerAddress: _greenCardIssuerAddress,
      uwSignatureAsset: _uwSignatureAsset,
      ...nonMotorBrand
    } = productKit.brand;
    expect(() => validateProgramDefinitionComponents({
      productType: 'BUSINESS',
      pricingMode: 'MANUAL',
      components: {
        underwriting: {},
        coverage: { schemaVersion: 1, mode: 'MANUAL' },
        ...shared,
        documents: {
          productKit: { ...productKit, brand: nonMotorBrand },
          issuedPack: { requiredTypes: [] },
          sources: [],
        },
      },
    })).not.toThrow();
  });

  it('rejects a required issued document without an explicit immutable source', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        documents: {
          ...shared.documents,
          sources: [],
        },
      },
    })).toThrow('missing required issued document MOTOR_CERTIFICATE_PDF');
  });

  it('rejects duplicate document source mappings rather than selecting one implicitly', () => {
    expect(() => validateProgramDefinitionComponents({
      productType: 'MOTOR',
      pricingMode: 'AUTOMATED',
      components: {
        underwriting: MOTOR_UW_CONFIG_FIXTURE,
        coverage: buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }),
        ...shared,
        documents: {
          ...shared.documents,
          sources: [
            { documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' },
            { documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'other-motor-certificate', sourceVersion: 'v1' },
          ],
        },
      },
    })).toThrow('documents.sources duplicates MOTOR_CERTIFICATE_PDF');
  });

  it('uses only the definition stored in the decision snapshot for documents', () => {
    const definition = fixtureProgrammeDefinition('MOTOR');
    const configuration = parseImmutablePolicyDocumentConfiguration({
      productType: 'MOTOR',
      policyProgramId: definition.programId,
      snapshot: { programDefinition: definition },
    });
    expect(configuration).toMatchObject({
      definitionId: definition.id,
      definitionVersion: definition.version,
      programId: definition.programId,
      binderProductAuthorityId: definition.binderProductAuthorityId,
    });
    expect(configuration.documentSources).toContainEqual({
      documentType: 'MOTOR_CERTIFICATE_PDF',
      sourceId: 'motor-certificate',
      sourceVersion: 'v2',
    });
  });

  it('fails closed when a decision snapshot omits programme document source mappings', () => {
    const definition = fixtureProgrammeDefinition('MOTOR');
    const { sources: _sources, ...documentsWithoutSources } = definition.documents;
    expect(() => parseImmutablePolicyDocumentConfiguration({
      productType: 'MOTOR',
      policyProgramId: definition.programId,
      snapshot: {
        programDefinition: {
          ...definition,
          documents: documentsWithoutSources,
        },
      },
    })).toThrow('Programme definition documents requires a sources array');
  });

  it('rejects a snapshot whose programme does not match the policy', () => {
    expect(() => parseImmutablePolicyDocumentConfiguration({
      productType: 'MOTOR',
      policyProgramId: 'other-programme',
      snapshot: { programDefinition: fixtureProgrammeDefinition('MOTOR') },
    })).toThrow('does not match the policy programme');
  });
});
