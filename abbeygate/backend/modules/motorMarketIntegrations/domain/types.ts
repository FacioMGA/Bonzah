export const MOTOR_MARKET_PROVIDER_SEGURNET = 'SEGURNET' as const;
export const MOTOR_MARKET_PROVIDER_FIVA = 'FIVA' as const;

export const MOTOR_MARKET_CHANNELS = ['SEGURNET_FNM', 'E_SEGURNET', 'IDS_CIDS', 'FIVA'] as const;
export type MotorMarketProvider = typeof MOTOR_MARKET_PROVIDER_SEGURNET | typeof MOTOR_MARKET_PROVIDER_FIVA;
export type MotorMarketChannel = typeof MOTOR_MARKET_CHANNELS[number];

export const MOTOR_MARKET_STATUSES = [
  'DRAFT',
  'QUEUED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'RETRYABLE_FAILURE',
  'TERMINAL_FAILURE',
  'BLOCKED_WAITING_FOR_EXTERNAL_SPEC',
] as const;
export type MotorMarketSubmissionStatus = typeof MOTOR_MARKET_STATUSES[number];

export type MotorMarketJson = string | number | boolean | null | MotorMarketJson[] | { [key: string]: MotorMarketJson };
export type MotorMarketSubmissionPayload = MotorMarketJson;

export type MotorMarketConnectorRequest = {
  submissionId: string;
  provider: MotorMarketProvider;
  channel: MotorMarketChannel;
  idempotencyKey: string;
  payload: MotorMarketSubmissionPayload;
};

export type MotorMarketConnectorResult = {
  status: MotorMarketSubmissionStatus;
  externalReference?: string | null;
  responsePayload?: MotorMarketJson | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export interface MotorMarketConnector {
  submit(request: MotorMarketConnectorRequest): Promise<MotorMarketConnectorResult>;
}

export function providerForChannel(channel: MotorMarketChannel): MotorMarketProvider {
  return channel === 'FIVA' ? MOTOR_MARKET_PROVIDER_FIVA : MOTOR_MARKET_PROVIDER_SEGURNET;
}
