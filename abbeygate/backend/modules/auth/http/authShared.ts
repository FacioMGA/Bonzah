import { sendEmailVerificationOtpEmail, logger } from '../app/authDeps.js';

/**
 * ABY-71 — best-effort OTP email dispatch.
 *
 * Treat the `userOtp` row as the source of truth: if it exists, the
 * verification path will work as soon as the customer holds a code
 * (delivered via SendGrid, or via the dev-code escape hatch on
 * non-prod). Any throw / falsy result from
 * `sendEmailVerificationOtpEmail` is logged with full structured
 * context (`comms.otp.dispatch_*`) so ops can investigate, but we
 * NEVER roll back the OTP row and we NEVER surface the failure as a
 * 500 to the customer. The legacy hard-fail behaviour both broke the
 * "Resend code" UI and destroyed codes already in flight to SendGrid.
 *
 * Returns `true` iff the dispatch reported success. Callers use the
 * return value purely to surface `sent: <bool>` (and, on non-prod, to
 * fall back to surfacing `devCode` for QA).
 */
export async function dispatchOtpEmailBestEffort(args: {
  email: string;
  code: string;
  expiresMinutes: number;
  otpId: string;
}): Promise<boolean> {
  const { email, code, expiresMinutes, otpId } = args;
  let succeeded = true;
  let skipReason: string | undefined;
  try {
    const sent = await sendEmailVerificationOtpEmail({ toEmail: email, code, expiresMinutes });
    if (!sent) {
      succeeded = false;
      skipReason = 'dispatch_returned_skipped';
    }
  } catch (dispatchErr) {
    succeeded = false;
    skipReason = (dispatchErr as Error)?.message || 'dispatch_threw';
    logger.error(
      { event: 'comms.otp.dispatch_failed', email, otpId, err: dispatchErr },
      'comms.otp.dispatch_failed',
    );
  }
  if (!succeeded) {
    logger.warn(
      { event: 'comms.otp.dispatch_skipped', email, otpId, reason: skipReason },
      'comms.otp.dispatch_skipped',
    );
  }
  return succeeded;
}
