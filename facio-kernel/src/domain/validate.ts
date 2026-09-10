import { createHash } from 'node:crypto';
import type { z } from 'zod';
import {
  reportSchema,
  type Configuration,
  type Context,
  type Gap,
} from '../contracts/configuration.js';
import { catalog } from './catalog.js';
import { validateInsuranceDefinition } from './insurance-decision.js';

type SnapshotReference = { view: 'draft' | 'published'; version: number; hash: string };
type GapInput = Omit<Gap, 'id' | 'tenantId' | 'owner' | 'productId' | 'processId'> & {
  productId?: string;
  processId?: string;
};
const registeredCapabilities = new Set([
  'definition_validation',
  'manual_external_quote',
  'exact_money',
  'insurance_decisions',
  'coverage_rating',
]);

/** Checks only the metadata contract. A valid definition cannot certify production readiness. */
export function validateConfiguration(
  configuration: Configuration,
  context: Context,
  snapshot: SnapshotReference,
): z.infer<typeof reportSchema> {
  const gaps: Gap[] = [];
  let definitionValid = true;
  function add(input: GapInput, invalidatesDefinition = false): void {
    if (invalidatesDefinition) definitionValid = false;
    const productId = input.productId ?? null;
    const processId = input.processId ?? null;
    const identity = [
      context.tenantId,
      input.category,
      input.field,
      input.kind,
      input.requirementId,
      input.code,
      productId,
      processId,
    ];
    const gapId = `gap_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 20)}`;
    if (gaps.some((gap) => gap.id === gapId)) return;
    gaps.push({
      ...input,
      id: gapId,
      tenantId: context.tenantId,
      productId,
      processId,
      owner:
        catalog.find((item) => item.id === input.category)?.owner ??
        'Platform Engineering (delivery owner unassigned)',
    });
  }
  function metadata(
    category: Gap['category'],
    field: string,
    kind: Gap['kind'],
    currentState: string,
    expectedState: string,
    requirementId: string,
    scope: { productId?: string; processId?: string } = {},
  ): void {
    add(
      {
        category,
        field,
        kind,
        currentState,
        expectedState,
        requirementId,
        affectedJourney: scope.processId
          ? `Process ${scope.processId}`
          : scope.productId
            ? `Product ${scope.productId}`
            : 'Tenant configuration',
        severity: 'blocker',
        remediation: `Correct ${field} in the draft and validate again. ${expectedState}`,
        code: 'CONFIGURATION_GAP',
        ...scope,
      },
      true,
    );
  }
  function duplicateIds(
    items: readonly { id: string }[],
    category: Gap['category'],
    field: string,
    requirementId: string,
    scope: { productId?: string; processId?: string } = {},
  ): void {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id))
        metadata(
          category,
          `${field}.${item.id}`,
          'inconsistent',
          `Identifier ${item.id} appears more than once.`,
          'Identifiers must be unique within their collection.',
          requirementId,
          scope,
        );
      seen.add(item.id);
    }
  }

  if (!configuration.tenant)
    metadata(
      'tenant',
      'tenant',
      'missing',
      'Tenant definition is absent.',
      'Supply tenant identity, locale, currency, time zone and residency metadata.',
      'TEN-002',
    );
  else {
    try {
      new Intl.DateTimeFormat('en', { timeZone: configuration.tenant.timeZone }).format(0);
    } catch {
      metadata(
        'tenant',
        'tenant.timeZone',
        'invalid',
        `Unrecognised time zone: ${configuration.tenant.timeZone}.`,
        'Use a supported IANA time-zone identifier.',
        'TEN-002',
      );
    }
  }
  if (!configuration.operatingEntities.length)
    metadata(
      'operatingEntities',
      'operatingEntities',
      'missing',
      'No operating entities are defined.',
      'Define at least one operating entity.',
      'TEN-002',
    );
  if (!configuration.products.length)
    metadata(
      'products',
      'products',
      'missing',
      'No products are defined.',
      'Define at least one product and its entity/process references.',
      'PRD-001',
    );
  if (!configuration.processes.length)
    metadata(
      'processes',
      'processes',
      'missing',
      'No processes are defined.',
      'Define at least one process with a reachable terminal stage.',
      'PBR-003',
    );
  duplicateIds(
    configuration.operatingEntities,
    'operatingEntities',
    'operatingEntities',
    'TEN-002',
  );
  duplicateIds(configuration.products, 'products', 'products', 'PRD-009');
  duplicateIds(configuration.processes, 'processes', 'processes', 'PRD-009');
  duplicateIds(configuration.integrations, 'integrations', 'integrations', 'CFG-008');
  const entities = new Set(configuration.operatingEntities.map((entity) => entity.id));
  const processes = new Set(configuration.processes.map((process) => process.id));
  for (const entity of configuration.operatingEntities) {
    if (!entity.territories.length)
      metadata(
        'operatingEntities',
        `operatingEntities.${entity.id}.territories`,
        'missing',
        'No operating territories are defined.',
        'Declare at least one operating territory.',
        'TEN-002',
      );
  }
  for (const product of configuration.products) {
    const scope = { productId: product.id, processId: product.processId };
    const field = `products.${product.id}`;
    if (!entities.has(product.operatingEntityId))
      metadata(
        'products',
        `${field}.operatingEntityId`,
        'inconsistent',
        `Operating entity ${product.operatingEntityId} does not exist.`,
        'Reference a defined operating entity.',
        'PRD-009',
        scope,
      );
    if (!processes.has(product.processId))
      metadata(
        'products',
        `${field}.processId`,
        'inconsistent',
        `Process ${product.processId} does not exist.`,
        'Reference a defined process.',
        'PRD-009',
        scope,
      );
    if (product.insurance) {
      const entity = configuration.operatingEntities.find(
        (item) => item.id === product.operatingEntityId,
      );
      if (
        entity &&
        product.insurance.territories.some((territory) => !entity.territories.includes(territory))
      )
        metadata(
          'products',
          `${field}.insurance.territories`,
          'inconsistent',
          'The insurance definition includes territories outside its operating entity territory set.',
          'Keep product territories within the declared operating entity territories. This does not certify licensing.',
          'TEN-002',
          scope,
        );
      if (product.fields.length)
        metadata(
          'products',
          `${field}.fields`,
          'inconsistent',
          'A rich insurance product also declares legacy fields.',
          'Leave fields empty; insurance.riskFields is the sole owner of the risk schema.',
          'PRD-002',
          scope,
        );
      for (const issue of validateInsuranceDefinition(product.insurance))
        metadata(
          'products',
          `${field}.insurance.${issue.path}`,
          'invalid',
          issue.message,
          'Correct the typed insurance definition before activation.',
          'PRD-010',
          scope,
        );
    }
    if (
      !product.insurance &&
      product.requiredCapabilities.some((capability) =>
        ['insurance_decisions', 'coverage_rating'].includes(capability),
      )
    )
      metadata(
        'products',
        `${field}.insurance`,
        'missing',
        'This product requires configured insurance decisions or rating without an executable insurance definition.',
        'Author the typed insurance definition before activating these capabilities.',
        'PRD-010',
        scope,
      );
    if (!product.insurance && !product.fields.length)
      metadata(
        'products',
        `${field}.fields`,
        'missing',
        'No risk fields are defined.',
        'Declare at least one typed risk field.',
        'PRD-002',
        scope,
      );
    duplicateIds(product.fields, 'products', `${field}.fields`, 'PRD-002', scope);
    for (const capability of product.requiredCapabilities) {
      if (!registeredCapabilities.has(capability))
        add(
          {
            category: 'products',
            field: `${field}.requiredCapabilities.${capability}`,
            kind: 'unsupported',
            currentState: `Required capability ${capability} is not registered.`,
            expectedState:
              'Each required capability must have a registered, tested implementation; unsupported capabilities cannot be activated.',
            requirementId: 'PRD-010',
            affectedJourney: `Product ${product.id} using process ${product.processId}`,
            severity: 'blocker',
            remediation: `Implement and test a typed extension for ${capability}; do not activate this product while its required capability is unsupported.`,
            code: 'REQUIRES_ENGINEERING',
            ...scope,
          },
          true,
        );
    }
  }
  for (const process of configuration.processes) {
    const scope = { processId: process.id };
    const field = `processes.${process.id}`;
    duplicateIds(process.stages, 'processes', `${field}.stages`, 'PRD-009', scope);
    const stages = new Map(process.stages.map((stage) => [stage.id, stage]));
    if (!stages.size)
      metadata(
        'processes',
        `${field}.stages`,
        'missing',
        'No stages are defined.',
        'Define an initial stage and a reachable terminal stage.',
        'PBR-003',
        scope,
      );
    if (!stages.has(process.initialStage))
      metadata(
        'processes',
        `${field}.initialStage`,
        'inconsistent',
        `Initial stage ${process.initialStage} does not exist.`,
        'Reference a defined stage.',
        'PRD-009',
        scope,
      );
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    const commands = new Set<string>();
    for (const [index, transition] of process.transitions.entries()) {
      const transitionField = `${field}.transitions.${index}`;
      const commandKey = `${transition.from}:${transition.command}`;
      if (commands.has(commandKey))
        metadata(
          'processes',
          transitionField,
          'inconsistent',
          `Command ${transition.command} has multiple transitions from ${transition.from}.`,
          'A stage and command pair must have one deterministic destination.',
          'PBR-010',
          scope,
        );
      commands.add(commandKey);
      if (!stages.has(transition.from) || !stages.has(transition.to)) {
        metadata(
          'processes',
          transitionField,
          'inconsistent',
          `Transition ${transition.from} → ${transition.to} references an undefined stage.`,
          'Every transition endpoint must reference a defined stage.',
          'PRD-009',
          scope,
        );
        continue;
      }
      if (stages.get(transition.from)?.terminal)
        metadata(
          'processes',
          transitionField,
          'inconsistent',
          `Terminal stage ${transition.from} has an outgoing transition.`,
          'Terminal stages must have no outgoing transitions.',
          'PBR-003',
          scope,
        );
      outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition.to]);
      incoming.set(transition.to, [...(incoming.get(transition.to) ?? []), transition.from]);
    }
    const reachable = traverse(
      stages.has(process.initialStage) ? [process.initialStage] : [],
      outgoing,
    );
    const terminals = process.stages.filter((stage) => stage.terminal).map((stage) => stage.id);
    const canTerminate = traverse(terminals, incoming);
    if (![...reachable].some((stageId) => stages.get(stageId)?.terminal))
      metadata(
        'processes',
        `${field}.terminal`,
        'incomplete',
        'No terminal stage is reachable from the initial stage.',
        'Provide at least one reachable terminal stage.',
        'PRD-009',
        scope,
      );
    for (const stage of process.stages) {
      if (!reachable.has(stage.id))
        metadata(
          'processes',
          `${field}.stages.${stage.id}`,
          'inconsistent',
          `Stage ${stage.id} is unreachable from the initial stage.`,
          'Connect the stage from the initial path or remove it from the process.',
          'PRD-009',
          scope,
        );
      else if (!canTerminate.has(stage.id))
        metadata(
          'processes',
          `${field}.stages.${stage.id}.terminalPath`,
          'incomplete',
          `Stage ${stage.id} cannot reach a terminal stage.`,
          'Provide a path to a terminal stage; closed cycles and dead ends cannot complete.',
          'PRD-009',
          scope,
        );
    }
  }
  for (const integration of configuration.integrations) {
    add({
      category: 'integrations',
      field: `integrations.${integration.id}.connectionStatus`,
      kind: integration.connectionStatus === 'disconnected' ? 'incomplete' : 'unknown',
      currentState: `Declared status is ${integration.connectionStatus}; this service has not verified provider connectivity.`,
      expectedState:
        'Connection health must be verified by an authorised provider adapter and recorded with evidence.',
      requirementId: 'PBR-007',
      affectedJourney: `Journeys depending on integration ${integration.id}`,
      severity: 'warning',
      remediation:
        'Implement the provider adapter and run an authorised connection check; a configured status is not live connection evidence.',
      code: 'DISCOVERY_REQUIRED',
    });
  }
  for (const category of catalog) {
    add({
      category: category.id,
      field:
        category.id === 'tenantRelease'
          ? 'tenantRelease.productionPublication'
          : `${category.id}.runtimeCapabilities`,
      kind: 'unsupported',
      currentState: category.description,
      expectedState:
        category.support === 'missing'
          ? `A typed, validated ${category.name.toLowerCase()} contract and its required runtime capabilities.`
          : `The full ${category.name.toLowerCase()} capability required by the development baseline, with runtime and acceptance evidence.`,
      requirementId: category.requirementIds[0] ?? 'CFG-004',
      affectedJourney: 'Production activation and applicable customer acceptance journeys',
      severity: 'blocker',
      remediation:
        'Create an implementation requirement with the approved customer scope, owning contracts and acceptance tests; implement and verify the missing capability before production activation.',
      code: 'REQUIRES_ENGINEERING',
    });
  }
  gaps.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.field.localeCompare(b.field) ||
      a.kind.localeCompare(b.kind),
  );
  return reportSchema.parse({
    view: snapshot.view,
    version: snapshot.version,
    configurationHash: snapshot.hash,
    definitionValid,
    productionReady: false,
    validationScope: 'configuration-metadata-v0.1',
    gaps,
  });
}

function traverse(start: string[], graph: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const pending = [...start];
  while (pending.length) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return visited;
}
