import { z } from 'zod';

export const LoginBodySchema = z.object({
  username: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(1),
}).refine((v) => Boolean(v.username || v.email), {
  message: 'username or email is required',
});

export const SignupBodySchema = z.object({
  username: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().optional(),
  role: z.string().trim().optional(),
  claimToken: z.string().trim().optional(),
}).refine((v) => Boolean(v.username || v.email), {
  message: 'username or email is required',
});

export const EmailOtpRequestBodySchema = z.object({
  email: z.string().trim().email(),
  flow: z.enum(['QUOTE_EMAIL', 'DASHBOARD_ACCESS']).optional(),
});

export const EmailOtpVerifyBodySchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(4).max(16),
  flow: z.enum(['QUOTE_EMAIL', 'DASHBOARD_ACCESS']).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export const PasswordResetRequestBodySchema = z.object({
  email: z.string().trim().email(),
});

export const PasswordResetConfirmBodySchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(4).max(16),
  newPassword: z.string().trim().min(8, 'Password must be at least 8 characters.'),
});

export const PasswordResetConfirmLinkBodySchema = z.object({
  // 32 raw bytes encoded base64url is 43 chars; allow a small buffer either way
  // so future token sizes still validate without a redeploy.
  token: z.string().trim().min(20).max(256),
  newPassword: z.string().trim().min(8, 'Password must be at least 8 characters.'),
});

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().trim().min(8, 'Password must be at least 8 characters.'),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'New password must be different from the current password.',
  path: ['newPassword'],
});
