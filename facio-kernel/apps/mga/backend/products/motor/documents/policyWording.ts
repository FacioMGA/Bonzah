import path from 'path';
import { fileURLToPath } from 'url';

const MOTOR_STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');

export interface MotorPolicyWording {
  filename: string;
  staticPdfPath: string;
  reference: string;
  assetVersion: string;
}

export interface MotorIpidAsset {
  filename: string;
  staticPdfPath: string;
  assetVersion: string;
}

const MOTOR_POLICY_WORDINGS: Readonly<Record<string, MotorPolicyWording>> = {
  CY: {
    filename: 'Abbeygate_Motor_Cyprus_Policy_Wording_AB-S-1-2026.pdf',
    staticPdfPath: path.join(MOTOR_STATIC_DIR, 'Abbeygate_Motor_Cyprus_Policy_Wording_AB-S-1-2026.pdf'),
    reference: 'AB/S/1/2026',
    assetVersion: 'abbeygate-motor-policy-wording:CY:AB-S-1-2026:2026-08-19',
  },
  PT: {
    filename: 'Abbeygate_Motor_Portugal_Policy_Wording_AB-S-1-2026.pdf',
    staticPdfPath: path.join(MOTOR_STATIC_DIR, 'Abbeygate_Motor_Portugal_Policy_Wording_AB-S-1-2026.pdf'),
    reference: 'AB/S/1/2026',
    assetVersion: 'abbeygate-motor-policy-wording:PT:AB-S-1-2026:2026-08-19',
  },
  ES: {
    filename: 'Abbeygate_Motor_Spain_Policy_Wording_AB-S-1-2026.pdf',
    staticPdfPath: path.join(MOTOR_STATIC_DIR, 'Abbeygate_Motor_Spain_Policy_Wording_AB-S-1-2026.pdf'),
    reference: 'AB/S/1/2026',
    assetVersion: 'abbeygate-motor-policy-wording:ES:AB-S-1-2026:2026-08-19',
  },
};

const MOTOR_IPIDS: Readonly<Record<string, MotorIpidAsset>> = {
  PT: {
    filename: 'Abbeygate_Motor_Portugal_IPID_LIC_Santam_August2026.pdf',
    staticPdfPath: path.join(MOTOR_STATIC_DIR, 'Abbeygate_Motor_Portugal_IPID_LIC_Santam_August2026.pdf'),
    assetVersion: 'abbeygate-motor-ipid:PT:SNT5436:2026-08:4a0653daeb2d808b',
  },
  CY: {
    filename: 'Abbeygate_Motor_Cyprus_IPID_LIC_Santam_UMR_B176026EEA6152.pdf',
    staticPdfPath: path.join(MOTOR_STATIC_DIR, 'Abbeygate_Motor_Cyprus_IPID_LIC_Santam_UMR_B176026EEA6152.pdf'),
    assetVersion: 'abbeygate-motor-ipid:CY:SNT5436:B176026EEA6152:2026-08-19',
  },
};

export class MotorPolicyWordingNotConfiguredError extends Error {
  readonly code = 'MOTOR_POLICY_WORDING_NOT_CONFIGURED' as const;
  readonly countryCode: string;

  constructor(countryCode: string) {
    super(
      `MOTOR_POLICY_WORDING_NOT_CONFIGURED: no Motor policy wording is configured for territory '${countryCode || 'UNKNOWN'}'. ` +
        'Add the approved wording under backend/products/motor/documents/static and register it in MOTOR_POLICY_WORDINGS. ' +
        "The issued pack will not fall back to another territory's wording.",
    );
    this.name = 'MotorPolicyWordingNotConfiguredError';
    this.countryCode = countryCode;
  }
}

export function resolveMotorPolicyWording(countryCode: string): MotorPolicyWording {
  const wording = MOTOR_POLICY_WORDINGS[String(countryCode || '').trim().toUpperCase()];
  if (!wording) throw new MotorPolicyWordingNotConfiguredError(countryCode);
  return wording;
}

export class MotorIpidNotConfiguredError extends Error {
  readonly code = 'MOTOR_IPID_NOT_CONFIGURED' as const;
  readonly countryCode: string;

  constructor(countryCode: string) {
    super(
      `MOTOR_IPID_NOT_CONFIGURED: no Motor IPID is configured for territory '${countryCode || 'UNKNOWN'}'. ` +
        'Add the approved IPID under backend/products/motor/documents/static and register it in MOTOR_IPIDS. ' +
        "The pre-purchase disclosure will not fall back to another territory's IPID.",
    );
    this.name = 'MotorIpidNotConfiguredError';
    this.countryCode = countryCode;
  }
}

export function resolveMotorIpid(countryCode: string): MotorIpidAsset {
  const ipid = MOTOR_IPIDS[String(countryCode || '').trim().toUpperCase()] ?? null;
  if (!ipid) throw new MotorIpidNotConfiguredError(countryCode);
  return ipid;
}
