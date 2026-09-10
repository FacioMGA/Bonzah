import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import {
  emailCoverageReport,
  listEmailPreviewInventory,
  previewEmail,
  sendPreviewTestEmail,
} from '../app/emailPreviewService.js';

const router = Router();

// GET /api/email-preview/inventory — every email trigger/template + governance
router.get('/inventory', async (_req, res) => {
  try {
    const data = await listEmailPreviewInventory();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error({ err: error }, 'email-preview.inventory.failed');
    return res.status(500).json({ success: false, error: { message: 'Failed to load email inventory' } });
  }
});

// GET /api/email-preview/preview?templateKey=..&trigger=..&jurisdiction=..
router.get('/preview', async (req, res) => {
  try {
    const data = await previewEmail({
      trigger: req.query.trigger ? String(req.query.trigger) : undefined,
      templateKey: req.query.templateKey ? String(req.query.templateKey) : undefined,
      jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
    });
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to render preview';
    return res.status(400).json({ success: false, error: { message } });
  }
});

// GET /api/email-preview/coverage — coverage report across active system emails
router.get('/coverage', async (_req, res) => {
  try {
    const data = await emailCoverageReport();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error({ err: error }, 'email-preview.coverage.failed');
    return res.status(500).json({ success: false, error: { message: 'Failed to build coverage report' } });
  }
});

// POST /api/email-preview/test-send — audited synthetic send to an allowlisted mailbox
const TestSendSchema = z.object({
  trigger: z.string().optional(),
  templateKey: z.string().optional(),
  jurisdiction: z.string().optional(),
  toEmail: z.string().email(),
});

router.post('/test-send', async (req, res) => {
  try {
    const input = TestSendSchema.parse(req.body);
    const result = await sendPreviewTestEmail(input);
    if (result.blocked) {
      return res.status(422).json({ success: false, error: { message: result.reason || 'Blocked' } });
    }
    if (!result.sent) {
      return res.status(422).json({ success: false, error: { message: result.reason || 'Not sent' } });
    }
    return res.json({ success: true, data: { messageId: result.messageId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid input' } });
    }
    logger.error({ err: error }, 'email-preview.test_send.failed');
    return res.status(500).json({ success: false, error: { message: 'Failed to send test email' } });
  }
});

export default router;
