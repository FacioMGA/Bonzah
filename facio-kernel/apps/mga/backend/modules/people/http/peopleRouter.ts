import { Router, type ErrorRequestHandler } from 'express';
import { assertWorkspaceStaff, workspaceStaffFilter, PeopleWorkspaceAccessError } from '../app/workspaceMembership.js';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { typedHandler } from '../../../platform/http/typedHandler.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';
import { storageService } from '../../../platform/storage/service.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import { STAFF_ABSENCE_CALENDAR_SELECT } from '../app/staffAbsenceCalendar.js';

const router = Router();

const payslipUpload = createRestrictedMemoryUpload({
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxFiles: 1,
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
  ],
  allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
});

const PersonnelBodySchema = z.object({
  staffNumber: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
  office: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).strict();

const AbsenceBodySchema = z.object({
  userId: z.string().trim().min(1),
  absenceType: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  endDate: z.string().trim().min(1),
  notes: z.string().trim().optional(),
}).strict();

const AbsenceQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
}).strict().refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { message: 'from must be on or before to' },
);

const PayslipBodySchema = z.object({
  userId: z.string().trim().min(1),
  periodLabel: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  storageKey: z.string().trim().optional(),
}).strict();

const DiaryBodySchema = z.object({
  ownerUserId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string().trim().optional(),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().optional(),
  visibility: z.enum(['PRIVATE', 'STAFF', 'MANAGEMENT']).optional(),
}).strict();

const MessageBodySchema = z.object({
  toUserIds: z.array(z.string().trim().min(1)).min(1),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
}).strict();

const IdParamsSchema = z.object({ id: z.string().trim().min(1) }).strict();
const DiaryQuerySchema = z.object({
  ownerUserId: z.string().trim().min(1).optional(),
}).strict();

const StaffDirectoryQuerySchema = z.object({
  search: z.string().trim().min(2).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
}).strict();

type StaffDirectoryPerson = {
  id: string;
  name: string;
  email: string;
};

function staffDisplayName(user: { name?: string | null; firstName?: string | null; lastName?: string | null; email: string }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return String(user.name || full || user.email).trim();
}

function userIdOrThrow(reqUser: Express.UserTokenPayload | undefined): string {
  const userId = String(reqUser?.id || '').trim();
  if (!userId) throw new Error('Authenticated user required');
  return userId;
}

function canViewManagementDiary(reqUser: Express.UserTokenPayload | undefined): boolean {
  const role = String(reqUser?.role || '').toUpperCase();
  return role.includes('ADMIN') || role.includes('MANAGER') || role.includes('MANAGEMENT');
}

async function upsertPersonnelFile(userId: string, body: z.infer<typeof PersonnelBodySchema>) {
  await assertWorkspaceStaff([userId]);
  const data: WithoutTenantScope<Prisma.PersonnelFileUncheckedCreateInput> = {
    userId,
    staffNumber: body.staffNumber || null,
    jobTitle: body.jobTitle || null,
    office: body.office || null,
    phone: body.phone || null,
    notes: body.notes || null,
  };
  const existing = await tenantScopedPrisma.personnelFile.findFirst({ where: { userId }, select: { id: true } });
  if (existing) {
    return tenantScopedPrisma.personnelFile.update({ where: { id: existing.id }, data });
  }
  return tenantScopedPrisma.personnelFile.create({ data: data as Prisma.PersonnelFileUncheckedCreateInput });
}

router.get('/me/personnel-file', typedHandler({}, async (req, res) => {
  const userId = userIdOrThrow(req.user);
  const file = await tenantScopedPrisma.personnelFile.findFirst({
    where: { userId },
    include: { payslips: { orderBy: { uploadedAt: 'desc' } } },
  });
  res.json({ success: true, data: file });
}));

router.put(
  '/me/personnel-file',
  typedHandler({ body: PersonnelBodySchema }, async (req, res) => {
    const { body } = req;
    const file = await upsertPersonnelFile(userIdOrThrow(req.user), body);
    res.json({ success: true, data: file });
  }),
);

router.get(
  '/staff/:id/personnel-file',
  requirePermission('settings', 'view'),
  typedHandler({ params: IdParamsSchema }, async (req, res) => {
    await assertWorkspaceStaff([req.params.id]);
    const file = await tenantScopedPrisma.personnelFile.findFirst({
      where: { userId: req.params.id },
      include: { payslips: { orderBy: { uploadedAt: 'desc' } } },
    });
    res.json({ success: true, data: file });
  }),
);

router.put(
  '/staff/:id/personnel-file',
  requirePermission('settings', 'edit'),
  typedHandler({ params: IdParamsSchema, body: PersonnelBodySchema }, async (req, res) => {
    const { body, params } = req;
    const file = await upsertPersonnelFile(params.id, body);
    res.json({ success: true, data: file });
  }),
);

router.get('/staff-directory', typedHandler({ query: StaffDirectoryQuerySchema }, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 100)));
  const users = await prisma.user.findMany({
    where: {
      ...workspaceStaffFilter(),
      userType: 'INTERNAL',
      isActive: true,
      role: { in: ['ADMIN', 'UNDERWRITER'] },
      ...(search ? {
        OR: [
          { id: search },
          { name: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    select: { id: true, name: true, firstName: true, lastName: true, email: true },
    orderBy: { name: 'asc' },
    take: limit,
  });
  const data: StaffDirectoryPerson[] = users.map((user) => ({
    id: user.id,
    name: staffDisplayName(user),
    email: user.email,
  }));
  res.json({ success: true, data });
}));

router.get('/absences', typedHandler({ query: AbsenceQuerySchema }, async (req, res) => {
  const { from, to } = req.query;
  const offset = Math.max(0, Number(req.query.offset || 0));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 100)));
  const absences = await tenantScopedPrisma.staffAbsence.findMany({
    where: {
      status: { not: 'CANCELLED' },
      ...(from || to ? {
        startDate: to ? { lte: new Date(`${to}T23:59:59.999Z`) } : undefined,
        endDate: from ? { gte: new Date(`${from}T00:00:00.000Z`) } : undefined,
      } : {}),
    },
    orderBy: { startDate: 'asc' },
    skip: offset,
    take: limit,
    select: STAFF_ABSENCE_CALENDAR_SELECT,
  });
  res.json({ success: true, data: absences });
}));

router.post(
  '/absences',
  requirePermission('people', 'leave.edit'),
  typedHandler({ body: AbsenceBodySchema }, async (req, res) => {
    const { body } = req;
    await assertWorkspaceStaff([body.userId]);
    const data: WithoutTenantScope<Prisma.StaffAbsenceUncheckedCreateInput> = {
      userId: body.userId,
      absenceType: body.absenceType.toUpperCase(),
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      notes: body.notes || null,
      createdByUserId: req.user?.id || null,
    };
    const row = await tenantScopedPrisma.staffAbsence.create({ data: data as Prisma.StaffAbsenceUncheckedCreateInput });
    res.json({ success: true, data: row });
  }),
);

router.patch(
  '/absences/:id/cancel',
  requirePermission('people', 'leave.cancel'),
  typedHandler({ params: IdParamsSchema }, async (req, res) => {
    const existing = await tenantScopedPrisma.staffAbsence.findFirst({
      where: { id: req.params.id, status: { not: 'CANCELLED' } },
      select: { id: true, status: true, userId: true, absenceType: true, startDate: true, endDate: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'ABSENCE_NOT_FOUND', message: 'Active absence not found.' } });
      return;
    }
    const row = await tenantScopedPrisma.staffAbsence.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
      select: STAFF_ABSENCE_CALENDAR_SELECT,
    });
    await AuditLogger.log(
      existing.id,
      'STAFF_ABSENCE',
      'PEOPLE.LEAVE.CANCELLED',
      userIdOrThrow(req.user),
      'USER',
      {
        previousStatus: existing.status,
        status: 'CANCELLED',
        absentUserId: existing.userId,
        absenceType: existing.absenceType,
        startDate: existing.startDate.toISOString(),
        endDate: existing.endDate.toISOString(),
      },
      req.user?.name ? String(req.user.name) : (req.user?.email ? String(req.user.email) : undefined),
    );
    res.json({ success: true, data: row });
  }),
);

router.get('/who-is-in', typedHandler({}, async (_req, res) => {
  const now = new Date();
  const absences = await tenantScopedPrisma.staffAbsence.findMany({
    where: { status: 'APPROVED', startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { startDate: 'asc' },
  });
  res.json({ success: true, data: { absent: absences } });
}));

router.post(
  '/payslips',
  requirePermission('settings', 'edit'),
  typedHandler({ body: PayslipBodySchema }, async (req, res) => {
    const { body } = req;
    await assertWorkspaceStaff([body.userId]);
    const file = await tenantScopedPrisma.personnelFile.findFirst({ where: { userId: body.userId } });
    if (!file) {
      res.status(404).json({ success: false, error: { code: 'PERSONNEL_FILE_NOT_FOUND', message: 'Create the personnel file first.' } });
      return;
    }
    const data: WithoutTenantScope<Prisma.StaffPayslipUncheckedCreateInput> = {
      personnelFileId: file.id,
      periodLabel: body.periodLabel,
      fileName: body.fileName,
      storageKey: body.storageKey || null,
      uploadedByUserId: req.user?.id || null,
    };
    const payslip = await tenantScopedPrisma.staffPayslip.create({ data: data as Prisma.StaffPayslipUncheckedCreateInput });
    res.json({ success: true, data: payslip });
  }),
);

router.post(
  '/payslips/upload',
  requirePermission('settings', 'edit'),
  payslipUpload.single('file'),
  typedHandler({ body: z.object({ userId: z.string().trim().min(1), periodLabel: z.string().trim().min(1) }).strict() }, async (req, res) => {
    const { body } = req;
    const uploadFile = req.file;
    if (!uploadFile) {
      res.status(400).json({ success: false, error: { code: 'PAYSLIP_FILE_REQUIRED', message: 'Upload a payslip file.' } });
      return;
    }
    await assertWorkspaceStaff([body.userId]);
    const personnelFile = await tenantScopedPrisma.personnelFile.findFirst({ where: { userId: body.userId } });
    if (!personnelFile) {
      res.status(404).json({ success: false, error: { code: 'PERSONNEL_FILE_NOT_FOUND', message: 'Create the personnel file first.' } });
      return;
    }
    const stored = await storageService.uploadFile(uploadFile.buffer, uploadFile.originalname, uploadFile.mimetype);
    const data: WithoutTenantScope<Prisma.StaffPayslipUncheckedCreateInput> = {
      personnelFileId: personnelFile.id,
      periodLabel: body.periodLabel,
      fileName: uploadFile.originalname,
      storageKey: stored.filename,
      uploadedByUserId: req.user?.id || null,
    };
    const payslip = await tenantScopedPrisma.staffPayslip.create({ data: data as Prisma.StaffPayslipUncheckedCreateInput });
    res.json({ success: true, data: payslip });
  }),
);

router.post(
  '/diary',
  typedHandler({ body: DiaryBodySchema }, async (req, res) => {
    const { body } = req;
    const actorId = userIdOrThrow(req.user);
    await assertWorkspaceStaff([body.ownerUserId]);
    const data: WithoutTenantScope<Prisma.StaffDiaryEntryUncheckedCreateInput> = {
      ownerUserId: body.ownerUserId,
      title: body.title,
      body: body.body || null,
      startAt: new Date(body.startAt),
      endAt: body.endAt ? new Date(body.endAt) : null,
      visibility: body.visibility || 'STAFF',
      createdByUserId: actorId,
    };
    const entry = await tenantScopedPrisma.staffDiaryEntry.create({ data: data as Prisma.StaffDiaryEntryUncheckedCreateInput });
    res.json({ success: true, data: entry });
  }),
);

router.get('/diary', typedHandler({ query: DiaryQuerySchema }, async (req, res) => {
  const userId = userIdOrThrow(req.user);
  const ownerUserId = req.query.ownerUserId;
  if (ownerUserId) await assertWorkspaceStaff([ownerUserId]);
  const sharedVisibility = canViewManagementDiary(req.user) ? ['STAFF', 'MANAGEMENT'] : ['STAFF'];
  const entries = await tenantScopedPrisma.staffDiaryEntry.findMany({
    where: {
      ...(ownerUserId ? { ownerUserId } : {}),
      OR: [
        { ownerUserId: userId },
        { visibility: { in: sharedVisibility } },
      ],
    },
    orderBy: { startAt: 'asc' },
    take: 200,
  });
  const ownerIds = [...new Set(entries.map((entry) => entry.ownerUserId))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { ...workspaceStaffFilter(), id: { in: ownerIds } },
        select: { id: true, name: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const ownerById = new Map(owners.map((owner) => [owner.id, staffDisplayName(owner)]));
  res.json({
    success: true,
    data: entries.map((entry) => ({
      ...entry,
      ownerName: ownerById.get(entry.ownerUserId) || entry.ownerUserId,
    })),
  });
}));

router.post(
  '/messages',
  typedHandler({ body: MessageBodySchema }, async (req, res) => {
    const { body } = req;
    await assertWorkspaceStaff(body.toUserIds);
    const data: WithoutTenantScope<Prisma.StaffMessageUncheckedCreateInput> = {
      fromUserId: userIdOrThrow(req.user),
      toUserIds: body.toUserIds,
      subject: body.subject,
      body: body.body,
    };
    const message = await tenantScopedPrisma.staffMessage.create({ data: data as Prisma.StaffMessageUncheckedCreateInput });
    res.json({ success: true, data: message });
  }),
);

router.get('/messages', typedHandler({}, async (req, res) => {
  const userId = userIdOrThrow(req.user);
  const messages = await tenantScopedPrisma.staffMessage.findMany({
    where: { OR: [{ fromUserId: userId }, { toUserIds: { has: userId } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: messages });
}));

router.get('/messages/archive', typedHandler({}, async (req, res) => {
  const userId = userIdOrThrow(req.user);
  const messages = await tenantScopedPrisma.staffMessage.findMany({
    where: { archivedByUserIds: { has: userId } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: messages });
}));

const membershipError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (error instanceof PeopleWorkspaceAccessError) { res.status(403).json({ success: false, error: { code: error.code, message: error.message } }); return; }
  next(error);
};
router.use(membershipError);
export default router;
