import { describe, it, expect, beforeAll } from 'vitest';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

describe('R2 Cloudflare Storage', () => {
  let s3Client: S3Client;

  beforeAll(() => {
    const endpoint = 'https://676a9f81546e95a1300f0c5ace42894f.r2.cloudflarestorage.com';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = 'auto';

    console.log('[R2Test] Endpoint:', endpoint);
    console.log('[R2Test] AccessKeyId:', accessKeyId?.substring(0, 10) + '...');
    console.log('[R2Test] Region:', region);

    expect(accessKeyId).toBeDefined();
    expect(secretAccessKey).toBeDefined();

    s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  });

  it('should validate R2 credentials by checking bucket access', async () => {
    const bucket = process.env.STORAGE_BUCKET || 'boletosfraga';
    
    console.log('[R2Test] Checking bucket:', bucket);
    
    try {
      const command = new HeadBucketCommand({ Bucket: bucket });
      await s3Client.send(command);
      expect(true).toBe(true);
      console.log('✅ R2 Cloudflare credentials validated successfully');
    } catch (error: any) {
      console.error('❌ R2 Cloudflare credentials validation failed');
      console.error('Error Code:', error.Code);
      console.error('Error Message:', error.message);
      console.error('Full Error:', JSON.stringify(error, null, 2));
      throw error;
    }
  });

  it('should have correct environment variables set', () => {
    console.log('[R2Test] STORAGE_PROVIDER:', process.env.STORAGE_PROVIDER);
    console.log('[R2Test] STORAGE_BUCKET:', process.env.STORAGE_BUCKET);
    console.log('[R2Test] STORAGE_PUBLIC_BASE_URL:', process.env.STORAGE_PUBLIC_BASE_URL);
    console.log('[R2Test] AWS_REGION:', process.env.AWS_REGION);
    
    expect(process.env.STORAGE_PROVIDER).toBe('cloudflare');
    expect(process.env.STORAGE_BUCKET).toBe('boletosfraga');
    expect(process.env.STORAGE_PUBLIC_BASE_URL).toBeDefined();
    expect(process.env.AWS_REGION).toBe('auto');
  });

});
