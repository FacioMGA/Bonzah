// FacioMGA — Auth router (composer).
//
// The endpoint handlers live in `./authRouter/` (split in PR 2.3d of
// the errors-and-warnings cleanup):
//
//   helpers.ts                 - shared rate-limit state, JWT/OTP helpers
//   loginRoute.ts              - POST /login
//   emailOtpRoutes.ts          - POST /email-otp/{request,verify}
//   passwordResetRoutes.ts     - POST /password-reset/{request,confirm,confirm-link}
//   signupRoute.ts             - POST /signup
//
// The default-export `Router` mounts every sub-router so existing
// consumers (the public routes mount in `apps/api/router.ts`) import
// from this file unchanged.

import { Router } from 'express';
import { loginRouter } from './authRouter/loginRoute.js';
import { emailOtpRouter } from './authRouter/emailOtpRoutes.js';
import { passwordResetRouter } from './authRouter/passwordResetRoutes.js';
import { signupRouter } from './authRouter/signupRoute.js';
import { changePasswordRouter } from './authRouter/changePasswordRoute.js';

const router = Router();

router.use(loginRouter);
router.use(emailOtpRouter);
router.use(passwordResetRouter);
router.use(signupRouter);
router.use(changePasswordRouter);

export default router;
