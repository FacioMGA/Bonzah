import type {
  MotorMarketConnector,
  MotorMarketConnectorRequest,
  MotorMarketConnectorResult,
} from '../domain/types.js';

export class SpecPendingMotorMarketConnector implements MotorMarketConnector {
  async submit(request: MotorMarketConnectorRequest): Promise<MotorMarketConnectorResult> {
    return {
      status: 'BLOCKED_WAITING_FOR_EXTERNAL_SPEC',
      responsePayload: {
        provider: request.provider,
        channel: request.channel,
        reason: 'Official APS/insurer technical documentation and credentials are required before live transmission.',
      },
      errorCode: 'EXTERNAL_SPEC_REQUIRED',
      errorMessage: 'External connector is disabled until official Segurnet/FIVA onboarding specs are confirmed.',
    };
  }
}
