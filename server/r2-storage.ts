import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.R2_ENDPOINT || 'https://3b2c8f1a5e7c9d2b1f4a6e8c0d3b5f7a.r2.cloudflarestorage.com';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'auto';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 credentials: AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY');
    }

    console.log('[R2Client] Initializing with endpoint=' + endpoint);

    s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

export interface UploadPdfResult {
  success: boolean;
  key: string;
  publicUrl: string;
  error?: string;
}

/**
 * Upload PDF to R2 storage
 * @param receivableId - ID do receivable
 * @param pdfBuffer - Buffer contendo o PDF
 * @returns URL pública do PDF
 */
export async function uploadPdfToR2(receivableId: string | number, pdfBuffer: Buffer): Promise<UploadPdfResult> {
  try {
    const client = getS3Client();
    const bucket = process.env.STORAGE_BUCKET || 'boletosfraga';
    const baseUrl = process.env.STORAGE_PUBLIC_BASE_URL || 'https://pub-803cde8c7a1942b0a35dd9678898243.r2.dev';

    // Path: boletos/{receivableId}.pdf
    const key = `boletos/${receivableId}.pdf`;

    console.log('[R2Upload] START receivableId=' + receivableId + ' bucket=' + bucket + ' key=' + key + ' size=' + pdfBuffer.length + ' baseUrl=' + baseUrl);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    });

    const result = await client.send(command);

    const publicUrl = `${baseUrl}/${key}`;

    console.log('[R2Upload] SUCCESS receivableId=' + receivableId + ' url=' + publicUrl + ' result=' + JSON.stringify(result));

    return {
      success: true,
      key,
      publicUrl,
    };
  } catch (error: any) {
    console.error('[R2Upload] ERROR receivableId=' + receivableId + ' bucket=' + (process.env.STORAGE_BUCKET || 'boletosfraga') + ' error=' + error.message + ' stack=' + error.stack);
    return {
      success: false,
      key: '',
      publicUrl: '',
      error: error.message,
    };
  }
}

/**
 * Check if PDF exists and is publicly accessible
 * @param receivableId - ID do receivable
 * @returns true if accessible, false otherwise
 */
export async function isPdfAccessible(receivableId: string | number): Promise<boolean> {
  try {
    const client = getS3Client();
    const bucket = process.env.STORAGE_BUCKET || 'boletosfraga';
    const key = `boletos/${receivableId}.pdf`;

    console.log('[R2Check] START receivableId=' + receivableId + ' key=' + key);

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);

    console.log('[R2Check] SUCCESS receivableId=' + receivableId + ' accessible=true');
    return true;
  } catch (error: any) {
    console.log('[R2Check] NOT_FOUND receivableId=' + receivableId + ' error=' + error.message);
    return false;
  }
}

/**
 * Get public URL for a PDF
 * @param receivableId - ID do receivable
 * @returns Public URL if exists, null otherwise
 */
export function getPdfPublicUrl(receivableId: string | number): string | null {
  const baseUrl = process.env.STORAGE_PUBLIC_BASE_URL || 'https://pub-803cde8c7a1942b0a35dd9678898243.r2.dev';
  const key = `boletos/${receivableId}.pdf`;
  return `${baseUrl}/${key}`;
}
