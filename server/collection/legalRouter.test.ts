/**
 * Testes unitários para o módulo LEGAL (CRUD + Export)
 * 
 * Mock sequence for buildCandidateData:
 *   1) clientRows (SELECT ... FROM clients c JOIN receivables r ...)
 *   2) attemptRows (SELECT ... FROM whatsappAudit ... GROUP BY clientId)
 *   3) lastSentRows (SELECT wa.clientId, wa.templateUsed ...)
 * 
 * Mock sequence for cases/create per clientId:
 *   1) SELECT existing cases
 *   2) INSERT INTO legal_cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// vi.mock is hoisted - cannot reference outer variables in factory
vi.mock('mysql2/promise', () => {
  const mockExecute = vi.fn();
  const mockEnd = vi.fn();
  return {
    default: {
      createConnection: vi.fn().mockResolvedValue({
        execute: mockExecute,
        end: mockEnd,
      }),
    },
    __mockExecute: mockExecute,
    __mockEnd: mockEnd,
  };
});

vi.stubEnv('FRAGA_ADMIN_KEY', 'test-admin-key-123');
vi.stubEnv('DATABASE_URL', 'mysql://test:test@localhost/test');

import express from 'express';
import request from 'supertest';
import legalRouter from './legalRouter';

// Access the mock functions after import
async function getMockExecute() {
  const mod = await import('mysql2/promise') as any;
  return mod.__mockExecute as ReturnType<typeof vi.fn>;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/legal', legalRouter);
  return app;
}

// ─── Sample data ────────────────────────────────────────────────────────────

const sampleClients = [
  {
    clientId: 100,
    name: 'EMPRESA TESTE',
    document: '12345678000199',
    email: 'teste@empresa.com',
    whatsapp: '+5527999999999',
    totalDebt: '5000.00',
    titlesCount: 5,
    maxDaysOverdue: 120,
    oldestDueDate: new Date('2025-10-01'),
  },
];

const sampleAttempts = [
  {
    clientId: 100,
    sentAttempts: 3,
    lastSentAt: new Date('2026-01-15T10:00:00Z'),
  },
];

const sampleLastSent = [
  {
    clientId: 100,
    templateUsed: 'bloco11_D1_soft',
    messageId: 'MSG123',
    correlationId: '#FRAGA:100:1001:123456',
  },
];

const AK = 'test-admin-key-123';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Legal Router', () => {
  let mockExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExecute = await getMockExecute();
  });

  // ─── Auth protection ─────────────────────────────────────────────────

  describe('Auth protection', () => {
    it('should return 403 without admin key', async () => {
      const app = createApp();
      const res = await request(app).get('/api/legal/candidates');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 with wrong admin key', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates')
        .set('x-admin-key', 'wrong-key');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 for cases without admin key', async () => {
      const app = createApp();
      const res = await request(app).get('/api/legal/cases');
      expect(res.status).toBe(403);
    });

    it('should return 403 for create without admin key', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/create')
        .send({ clientIds: [1] });
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /candidates ─────────────────────────────────────────────────

  describe('GET /api/legal/candidates', () => {
    it('should return candidates with blockSummary and correct structure', async () => {
      mockExecute
        .mockResolvedValueOnce([sampleClients])      // 1) clientRows
        .mockResolvedValueOnce([sampleAttempts])      // 2) attemptRows
        .mockResolvedValueOnce([sampleLastSent]);     // 3) lastSentRows

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=90&minDebt=500&minDispatch=2&lastSentOlderThanDays=15')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filters).toBeDefined();
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.totalCandidates).toBe(1);
      expect(res.body.blockSummary).toBeDefined();
      expect(res.body.blockSummary.totalWithDebt).toBe(1);
      expect(res.body.blockSummary.reasons).toBeDefined();
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].clientId).toBe(100);
      expect(res.body.candidates[0].name).toBe('EMPRESA TESTE');
      expect(res.body.candidates[0].reasonFlags).toBeInstanceOf(Array);
    });

    it('should classify as LEGAL_RECOMMENDED when all criteria met', async () => {
      mockExecute
        .mockResolvedValueOnce([sampleClients])      // 1) clientRows
        .mockResolvedValueOnce([sampleAttempts])      // 2) attemptRows (lastSentAt = Jan 15 = ~41 days ago)
        .mockResolvedValueOnce([sampleLastSent]);     // 3) lastSentRows

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=90&minDebt=500&minDispatch=2&lastSentOlderThanDays=15')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.candidates[0].legalStage).toBe('LEGAL_RECOMMENDED');
    });

    it('should classify as PRE_LEGAL when last sent is too recent', async () => {
      const recentAttempts = [{
        clientId: 100,
        sentAttempts: 3,
        lastSentAt: new Date(), // today
      }];

      mockExecute
        .mockResolvedValueOnce([sampleClients])
        .mockResolvedValueOnce([recentAttempts])
        .mockResolvedValueOnce([sampleLastSent]);

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=90&minDebt=500&minDispatch=2&lastSentOlderThanDays=15')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      // With recent send, candidate has RECENT_MESSAGE block → still included as PRE_LEGAL
      expect(res.body.candidates[0].legalStage).toBe('PRE_LEGAL');
    });

    it('should return empty when no clients match', async () => {
      mockExecute.mockResolvedValueOnce([[]]); // no clients

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=90&minDebt=500&minDispatch=2')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(0);
      expect(res.body.summary.totalCandidates).toBe(0);
      expect(res.body.blockSummary.totalWithDebt).toBe(0);
    });

    it('should use new default filters (60d/2disp/500) when none provided', async () => {
      mockExecute.mockResolvedValueOnce([[]]); // no clients

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.filters.minDaysOverdue).toBe(60);
      expect(res.body.filters.minTotalDebt).toBe(500);
      expect(res.body.filters.minSentAttempts).toBe(2);
      expect(res.body.filters.lastSentOlderThanDays).toBe(15);
    });

    it('should accept minDays/minDispatch/minDebt aliases', async () => {
      mockExecute.mockResolvedValueOnce([[]]); // no clients

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=45&minDispatch=1&minDebt=200')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.filters.minDaysOverdue).toBe(45);
      expect(res.body.filters.minSentAttempts).toBe(1);
      expect(res.body.filters.minTotalDebt).toBe(200);
    });

    it('should include debug data when debug=1', async () => {
      // Client with LOW_DISPATCH block (only 1 attempt, needs 2)
      const blockedClient = [{
        clientId: 200,
        name: 'BLOQUEADO TESTE',
        document: '99999999000199',
        email: 'bloq@test.com',
        whatsapp: '+5527888888888',
        totalDebt: '8000.00',
        titlesCount: 3,
        maxDaysOverdue: 100,
        oldestDueDate: new Date('2025-09-01'),
      }];

      const lowAttempts = [{
        clientId: 200,
        sentAttempts: 1,
        lastSentAt: new Date('2026-01-10T10:00:00Z'),
      }];

      const lastSent = [{
        clientId: 200,
        templateUsed: 'bloco11_D1_soft',
        messageId: 'MSG999',
        correlationId: '#FRAGA:200:2001:999',
      }];

      mockExecute
        .mockResolvedValueOnce([blockedClient])
        .mockResolvedValueOnce([lowAttempts])
        .mockResolvedValueOnce([lastSent]);

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?debug=1&minDispatch=2')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.debug).toBeDefined();
      expect(res.body.debug.topBlockedClients).toBeInstanceOf(Array);
      expect(res.body.debug.explanation).toBeDefined();
      expect(res.body.debug.explanation.NO_DISPATCH).toBeDefined();
      expect(res.body.debug.explanation.LOW_DISPATCH).toBeDefined();
      expect(res.body.debug.explanation.RECENT_MESSAGE).toBeDefined();
    });

    it('should NOT include debug data when debug is not set', async () => {
      mockExecute.mockResolvedValueOnce([[]]); // no clients

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.debug).toBeUndefined();
    });

    it('should include blockSummary with reason counts', async () => {
      // Two clients: one passes, one blocked by LOW_DISPATCH
      const twoClients = [
        { ...sampleClients[0] },
        {
          clientId: 201,
          name: 'EMPRESA BLOQUEADA',
          document: '11111111000111',
          email: 'bloq@test.com',
          whatsapp: '+5527777777777',
          totalDebt: '3000.00',
          titlesCount: 2,
          maxDaysOverdue: 95,
          oldestDueDate: new Date('2025-11-01'),
        },
      ];

      // Client 100 has 3 attempts, client 201 has 0
      const attempts = [
        { clientId: 100, sentAttempts: 3, lastSentAt: new Date('2026-01-15T10:00:00Z') },
      ];

      mockExecute
        .mockResolvedValueOnce([twoClients])
        .mockResolvedValueOnce([attempts])
        .mockResolvedValueOnce([sampleLastSent]);

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/candidates?minDays=60&minDispatch=2&minDebt=500')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.blockSummary.totalWithDebt).toBe(2);
      expect(res.body.blockSummary.reasons.NO_DISPATCH).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── POST /cases/create ──────────────────────────────────────────────

  describe('POST /api/legal/cases/create', () => {
    it('should create cases for given clientIds', async () => {
      // 1) Check existing cases → none
      mockExecute.mockResolvedValueOnce([[]]);
      // 2) INSERT case → insertId=42
      mockExecute.mockResolvedValueOnce([{ insertId: 42 }]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/create')
        .set('x-admin-key', AK)
        .send({ clientIds: [100] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalCreated).toBe(1);
      expect(res.body.created).toContain(42);
    });

    it('should return 400 when clientIds is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/create')
        .set('x-admin-key', AK)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should skip clients with existing open cases', async () => {
      // 1) Check existing cases → found one active
      mockExecute.mockResolvedValueOnce([[{ id: 5, clientId: 100, status: 'draft' }]]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/create')
        .set('x-admin-key', AK)
        .send({ clientIds: [100] });

      expect(res.status).toBe(200);
      expect(res.body.totalCreated).toBe(0);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0].clientId).toBe(100);
    });
  });

  // ─── POST /cases/approve ─────────────────────────────────────────────

  describe('POST /api/legal/cases/approve', () => {
    it('should approve draft cases', async () => {
      // 1) Fetch case → draft
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'draft' }]]);
      // 2) UPDATE case
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/approve')
        .set('x-admin-key', AK)
        .send({ caseIds: [1], approvedBy: 'Stevens' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalApproved).toBe(1);
      expect(res.body.approved).toContain(1);
    });

    it('should return 400 when caseIds is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/approve')
        .set('x-admin-key', AK)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 400 when approvedBy is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/approve')
        .set('x-admin-key', AK)
        .send({ caseIds: [1] });

      expect(res.status).toBe(400);
    });

    it('should skip non-draft cases', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'approved' }]]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/approve')
        .set('x-admin-key', AK)
        .send({ caseIds: [1], approvedBy: 'Stevens' });

      expect(res.status).toBe(200);
      expect(res.body.totalApproved).toBe(0);
      expect(res.body.skipped).toHaveLength(1);
    });
  });

  // ─── POST /cases/mark-sent ───────────────────────────────────────────

  describe('POST /api/legal/cases/mark-sent', () => {
    it('should mark approved cases as sent_to_legal', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'approved' }]]);
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/mark-sent')
        .set('x-admin-key', AK)
        .send({ caseIds: [1] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalMarked).toBe(1);
      expect(res.body.marked).toContain(1);
    });

    it('should skip non-approved cases', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'draft' }]]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/mark-sent')
        .set('x-admin-key', AK)
        .send({ caseIds: [1] });

      expect(res.status).toBe(200);
      expect(res.body.totalMarked).toBe(0);
      expect(res.body.skipped).toHaveLength(1);
    });
  });

  // ─── POST /cases/close ───────────────────────────────────────────────

  describe('POST /api/legal/cases/close', () => {
    it('should close non-closed cases', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'sent_to_legal' }]]);
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE status

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/close')
        .set('x-admin-key', AK)
        .send({ caseIds: [1], notes: 'Pagou' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalClosed).toBe(1);
      expect(res.body.closed).toContain(1);
    });

    it('should skip already closed cases', async () => {
      mockExecute.mockResolvedValueOnce([[{ id: 1, status: 'closed' }]]);

      const app = createApp();
      const res = await request(app)
        .post('/api/legal/cases/close')
        .set('x-admin-key', AK)
        .send({ caseIds: [1] });

      expect(res.status).toBe(200);
      expect(res.body.totalClosed).toBe(0);
      expect(res.body.skipped).toHaveLength(1);
    });
  });

  // ─── GET /cases ──────────────────────────────────────────────────────

  describe('GET /api/legal/cases', () => {
    it('should return list of cases', async () => {
      const sampleCases = [{
        id: 1,
        clientId: 100,
        status: 'draft',
        approvedBy: null,
        approvedAt: null,
        sentToLegalAt: null,
        closedAt: null,
        notes: 'test',
        createdAt: new Date('2026-02-25'),
        updatedAt: new Date('2026-02-25'),
        clientName: 'EMPRESA TESTE',
        document: '12345678000199',
        whatsapp: '+5527999999999',
      }];

      mockExecute.mockResolvedValueOnce([sampleCases]);

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/cases')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cases).toHaveLength(1);
      expect(res.body.cases[0].clientName).toBe('EMPRESA TESTE');
    });

    it('should filter by status', async () => {
      mockExecute.mockResolvedValueOnce([[]]);

      const app = createApp();
      const res = await request(app)
        .get('/api/legal/cases?status=approved')
        .set('x-admin-key', AK);

      expect(res.status).toBe(200);
      expect(res.body.cases).toHaveLength(0);
    });
  });

  // ─── Cron independence ───────────────────────────────────────────────

  describe('Cron independence', () => {
    it('should not import or reference cronScheduler', () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const routerSource = readFileSync(path.join(__dirname, 'legalRouter.ts'), 'utf-8');
      expect(routerSource).not.toContain('cronScheduler');
      expect(routerSource).not.toContain('batchSender');
      expect(routerSource).not.toContain('ALLOW_REAL_SEND');
      expect(routerSource).not.toContain('ALLOW_CRON_ENABLE');
    });

    it('should only modify legal_cases table, not core tables', () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const routerSource = readFileSync(path.join(__dirname, 'legalRouter.ts'), 'utf-8');
      // Should NOT modify receivables, clients, collectionMessages
      expect(routerSource).not.toMatch(/UPDATE\s+receivables/i);
      expect(routerSource).not.toMatch(/UPDATE\s+clients/i);
      expect(routerSource).not.toMatch(/DELETE\s+FROM\s+receivables/i);
      expect(routerSource).not.toMatch(/INSERT\s+INTO\s+receivables/i);
      expect(routerSource).not.toMatch(/INSERT\s+INTO\s+collectionMessages/i);
    });
  });
});
