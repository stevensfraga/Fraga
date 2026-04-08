import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import axios from 'axios';
import { uploadPdfViaWorker, checkWorkerHealth } from './worker-storage';

// Mock axios
vi.mock('axios');
const mockedAxios = axios as any;

describe('Worker Storage', () => {
  beforeAll(() => {
    process.env.WORKER_UPLOAD_URL = 'https://boletos-upload-proxy.contato-676.workers.dev';
  });

  describe('checkWorkerHealth', () => {
    it('should return true when worker is healthy', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: 'ok', ts: Date.now() },
      });

      const result = await checkWorkerHealth();
      expect(result).toBe(true);
    });

    it('should return false when worker is down', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await checkWorkerHealth();
      expect(result).toBe(false);
    });
  });

  describe('uploadPdfViaWorker', () => {
    it('should upload PDF successfully', async () => {
      const pdfBuffer = Buffer.from('fake pdf content');
      const receivableId = '123';

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          key: 'boletos/123.pdf',
          publicUrl: 'https://pub-xxx.r2.dev/boletos/123.pdf',
        },
      });

      const result = await uploadPdfViaWorker(receivableId, pdfBuffer);

      expect(result.success).toBe(true);
      expect(result.key).toBe('boletos/123.pdf');
      expect(result.publicUrl).toContain('boletos/123.pdf');
      expect(result.duration).toBeDefined();
    });

    it('should handle upload errors', async () => {
      const pdfBuffer = Buffer.from('fake pdf content');
      const receivableId = '456';

      mockedAxios.post.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const result = await uploadPdfViaWorker(receivableId, pdfBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
      expect(result.duration).toBeDefined();
    });

    it('should handle worker error responses', async () => {
      const pdfBuffer = Buffer.from('fake pdf content');
      const receivableId = '789';

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: false,
          error: 'Missing file or key',
        },
      });

      const result = await uploadPdfViaWorker(receivableId, pdfBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing file or key');
    });
  });
});
