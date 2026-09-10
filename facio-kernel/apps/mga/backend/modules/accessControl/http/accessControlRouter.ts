import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import {
  createAccessAssignment,
  deleteAccessAssignment,
  getAccessRoleById,
  getAccessUserById,
  listAccessPermissions,
  listAccessRoles,
  listAccessUsers,
  queryAccessUserAuditFeed,
} from '../app/accessControlService.js';
import {
  inviteUser,
  suspendUser,
  reactivateUser,
  revokeUserSessions,
  updateUserProfile,
  adminResetUserPassword,
} from '../app/userLifecycleService.js';
import { createRole, updateRole, duplicateRole, archiveRole } from '../app/roleService.js';
import { requirePermission } from './permissionMiddleware.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';

/** Safely extract actor name from the Express user (index sig returns unknown). */
function actorName(user: Express.UserTokenPayload): string | undefined {
  const n = user['name'];
  return typeof n === 'string' && n.length > 0 ? n : undefined;
}

export function buildAccessControlRouter(): Router {
  const router = Router();

  // ──────────────────────────────────────────────────────────────────────────
  // USERS
  // ──────────────────────────────────────────────────────────────────────────

  router.get('/users', requirePermission('users', 'view'), async (req, res) => {
    try {
      const { search, status, role, userType, mfaEnabled, cursor, limit } = req.query as Record<string, string | undefined>;
      const result = await listAccessUsers({
        search: search || undefined,
        status: status as never,
        role: role || undefined,
        userType: userType || undefined,
        mfaEnabled: mfaEnabled === 'true' ? true : mfaEnabled === 'false' ? false : undefined,
        cursor: cursor || undefined,
        limit: limit ? parseInt(limit, 10) : 50,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error({ err }, 'accessControl.listUsers.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch users' } });
    }
  });

  router.get('/users/:id', requirePermission('users', 'view'), async (req, res) => {
    try {
      const user = await getAccessUserById(req.params.id);
      if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return res.json({ success: true, user });
    } catch (err) {
      logger.error({ err }, 'accessControl.getUser.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user' } });
    }
  });

  router.post('/users/invite', requirePermission('users', 'invite'), async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        role: z.enum(['ADMIN', 'UNDERWRITER', 'CUSTOMER']).optional(),
        userType: z.enum(['INTERNAL', 'BROKER', 'CUSTOMER', 'PARTNER']).optional(),
        assignmentRoleIds: z.array(z.string().uuid()).optional(),
        note: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const actor = req.user!;
      const publicAppBaseUrl = resolvePublicAppBaseUrlFromRequest(req);
      const user = await inviteUser({
        ...data,
        invitedById: actor.id,
        invitedByName: actorName(actor),
        publicAppBaseUrl,
      });
      return res.status(201).json({ success: true, user });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      const code = (err as { code?: string }).code;
      if (code === 'EMAIL_CONFLICT') return res.status(409).json({ success: false, error: { code, message: 'A user with this email already exists.' } });
      if (code === 'EMAIL_SEND_FAILED') return res.status(502).json({ success: false, error: { code, message: 'Could not send the invitation email. Please verify the recipient address and try again.' } });
      logger.error({ err }, 'accessControl.inviteUser.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to invite user' } });
    }
  });

  router.patch('/users/:id', requirePermission('users', 'edit'), async (req, res) => {
    try {
      const schema = z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        role: z.enum(['ADMIN', 'UNDERWRITER', 'CUSTOMER']).optional(),
        userType: z.enum(['INTERNAL', 'BROKER', 'CUSTOMER', 'PARTNER']).optional(),
      });
      const data = schema.parse(req.body);
      const actor = req.user!;
      const user = await updateUserProfile(req.params.id, data, actor.id, actorName(actor));
      return res.json({ success: true, user });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.updateUser.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' } });
    }
  });

  router.patch('/users/:id/status', requirePermission('users', 'suspend'), async (req, res) => {
    try {
      const schema = z.object({
        isActive: z.boolean(),
        reason: z.string().optional(),
      });
      const { isActive, reason } = schema.parse(req.body);
      const actor = req.user!;
      if (actor.id === req.params.id) {
        return res.status(400).json({ success: false, error: { code: 'SELF_ACTION', message: 'Cannot change your own account status.' } });
      }
      const user = isActive
        ? await reactivateUser(req.params.id, actor.id, actorName(actor))
        : await suspendUser(req.params.id, actor.id, actorName(actor), reason);
      return res.json({ success: true, user });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.updateStatus.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update user status' } });
    }
  });

  router.post('/users/:id/revoke-sessions', requirePermission('users', 'revoke_sessions'), async (req, res) => {
    try {
      const actor = req.user!;
      await revokeUserSessions(req.params.id, actor.id, actorName(actor));
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'accessControl.revokeSessions.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke sessions' } });
    }
  });

  router.post('/users/:id/reset-password', requirePermission('users', 'reset_password'), async (req, res) => {
    try {
      const actor = req.user!;
      const publicAppBaseUrl = resolvePublicAppBaseUrlFromRequest(req);
      await adminResetUserPassword(req.params.id, actor.id, actorName(actor), { publicAppBaseUrl });
      return res.json({ success: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'USER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: { code, message: 'User not found' } });
      }
      if (code === 'OTP_NOT_CONFIGURED') {
        logger.error({ err }, 'accessControl.resetPassword.otpNotConfigured');
        return res.status(503).json({ success: false, error: { code, message: 'Password reset is not configured on this server.' } });
      }
      if (code === 'EMAIL_SEND_FAILED') {
        logger.warn({ err }, 'accessControl.resetPassword.emailSendFailed');
        return res.status(502).json({ success: false, error: { code, message: 'Reset link generated but the email failed to send. Please try again.' } });
      }
      logger.error({ err }, 'accessControl.resetPassword.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reset password' } });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ROLE ASSIGNMENTS
  // ──────────────────────────────────────────────────────────────────────────

  router.post('/users/:id/assignments', requirePermission('roles', 'assign'), async (req, res) => {
    try {
      const schema = z.object({
        roleId: z.string().uuid(),
        scopeType: z.enum(['GLOBAL', 'PRODUCT', 'BINDER', 'OWN_RECORDS']).optional(),
        scopeValue: z.string().optional(),
        expiresAt: z.string().datetime().optional(),
      });
      const data = schema.parse(req.body);
      const actor = req.user!;
      const assignment = await createAccessAssignment({
        userId: req.params.id,
        roleId: data.roleId,
        scopeType: data.scopeType,
        scopeValue: data.scopeValue,
        assignedById: actor.id,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      });
      return res.status(201).json({ success: true, assignment });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.createAssignment.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create assignment' } });
    }
  });

  router.delete('/users/:id/assignments/:assignmentId', requirePermission('roles', 'assign'), async (req, res) => {
    try {
      await deleteAccessAssignment(req.params.assignmentId);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'accessControl.deleteAssignment.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to remove assignment' } });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ROLES
  // ──────────────────────────────────────────────────────────────────────────

  router.get('/roles', requirePermission('roles', 'view'), async (_req, res) => {
    try {
      const roles = await listAccessRoles();
      return res.json({ success: true, roles });
    } catch (err) {
      logger.error({ err }, 'accessControl.listRoles.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch roles' } });
    }
  });

  router.get('/roles/:id', requirePermission('roles', 'view'), async (req, res) => {
    try {
      const role = await getAccessRoleById(req.params.id);
      if (!role) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } });
      return res.json({ success: true, role });
    } catch (err) {
      logger.error({ err }, 'accessControl.getRole.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch role' } });
    }
  });

  router.post('/roles', requirePermission('roles', 'create'), async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(80),
        description: z.string().optional(),
        permissionIds: z.array(z.string().uuid()).optional(),
      });
      const data = schema.parse(req.body);
      const actor = req.user!;
      const role = await createRole({ ...data, actorId: actor.id, actorName: actorName(actor) });
      return res.status(201).json({ success: true, role });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.createRole.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create role' } });
    }
  });

  router.patch('/roles/:id', requirePermission('roles', 'edit'), async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(80).optional(),
        description: z.string().optional(),
        permissionIds: z.array(z.string().uuid()).optional(),
      });
      const data = schema.parse(req.body);
      const actor = req.user!;
      const role = await updateRole(req.params.id, { ...data, actorId: actor.id, actorName: actorName(actor) });
      return res.json({ success: true, role });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.updateRole.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update role' } });
    }
  });

  router.post('/roles/:id/duplicate', requirePermission('roles', 'create'), async (req, res) => {
    try {
      const schema = z.object({ name: z.string().min(2).max(80) });
      const { name } = schema.parse(req.body);
      const actor = req.user!;
      const role = await duplicateRole(req.params.id, name, actor.id, actorName(actor));
      return res.status(201).json({ success: true, role });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message } });
      logger.error({ err }, 'accessControl.duplicateRole.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to duplicate role' } });
    }
  });

  router.delete('/roles/:id', requirePermission('roles', 'archive'), async (req, res) => {
    try {
      const actor = req.user!;
      await archiveRole(req.params.id, actor.id, actorName(actor));
      return res.json({ success: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SYSTEM_ROLE_IMMUTABLE') return res.status(400).json({ success: false, error: { code, message: 'System roles cannot be archived.' } });
      logger.error({ err }, 'accessControl.archiveRole.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to archive role' } });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PERMISSIONS
  // ──────────────────────────────────────────────────────────────────────────

  router.get('/permissions', requirePermission('roles', 'view'), async (_req, res) => {
    try {
      const permissions = await listAccessPermissions();
      return res.json({ success: true, permissions });
    } catch (err) {
      logger.error({ err }, 'accessControl.listPermissions.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch permissions' } });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIT FEED
  // ──────────────────────────────────────────────────────────────────────────

  router.get('/audit', requirePermission('audit', 'view'), async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const result = await queryAccessUserAuditFeed({
        targetUserId: q.userId || undefined,
        actorId: q.actorId || undefined,
        actionNamePrefix: q.action || undefined,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        cursor: q.cursor || undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error({ err }, 'accessControl.audit.error');
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit feed' } });
    }
  });

  return router;
}
