// FacioMGA - Storage Service
// Handles file uploads to Azure Blob Storage (Production) or Local Filesystem (Dev)

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';

import { logger } from '../utils/logger.js';
import { ensureUploadsDirReady, resolveUploadsDir } from '../runtime/runtimePaths.js';
import { getTenantConfig } from '../tenant/tenantConfig.js';
export interface UploadedFile {
    filename: string;
    url: string;
    mimetype: string;
    size: number;
}

class StorageService {
    private provider: 'azure' | 'local';
    private containerName: string;
    private blobServiceClient: BlobServiceClient | null = null;
    private localUploadDir: string;

    constructor() {
        this.provider = (process.env.STORAGE_PROVIDER as 'azure' | 'local') || 'local';
        this.containerName = process.env.STORAGE_CONTAINER_NAME || 'faciomga-uploads';
        this.localUploadDir = resolveUploadsDir();

        if (this.provider === 'azure') {
            const connectionString = process.env.STORAGE_CONNECTION_STRING;
            const account = process.env.KERNEL_STORAGE_ACCOUNT;
            if (!connectionString && account && /^[a-z0-9]{3,24}$/.test(account)) {
                this.blobServiceClient = new BlobServiceClient(`https://${account}.blob.core.windows.net`, {
                    getToken: async () => {
                        const response = await fetch('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F', {
                            headers: { Metadata: 'true' }, signal: AbortSignal.timeout(5000),
                        });
                        if (!response.ok) throw new Error('Storage managed identity is unavailable');
                        const body: unknown = await response.json();
                        if (!body || typeof body !== 'object' || !('access_token' in body) || typeof body.access_token !== 'string'
                            || !('expires_on' in body) || !Number.isFinite(Number(body.expires_on))) throw new Error('Invalid storage identity response');
                        return { token: body.access_token, expiresOnTimestamp: Number(body.expires_on) * 1000 };
                    },
                });
            } else if (!connectionString) {
                if (this.isProd()) {
                    throw new Error('STORAGE_PROVIDER=azure requires STORAGE_CONNECTION_STRING in production.');
                }
                logger.warn('STORAGE_PROVIDER is azure but STORAGE_CONNECTION_STRING is missing. Falling back to local in non-production.');
                this.provider = 'local';
            } else {
                try {
                    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
                } catch (e) {
                    if (this.isProd()) {
                        throw new Error(`Invalid STORAGE_CONNECTION_STRING for Azure Blob Storage: ${(e as Error)?.message || 'unknown error'}`);
                    }
                    // Non-production can fall back to local mode for developer convenience.
                    logger.error({
                        message: (e as Error)?.message
                    }, 'Invalid STORAGE_CONNECTION_STRING for Azure Blob Storage. Falling back to local storage in non-production.');
                    this.provider = 'local';
                    this.blobServiceClient = null;
                }
            }
        }

        if (this.provider === 'local') {
            this.localUploadDir = ensureUploadsDirReady();
        }
    }

    private isProd(): boolean {
        return (process.env.NODE_ENV || 'development') === 'production';
    }

    private scopedKey(filename: string): string {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)) throw new Error('Invalid storage filename');
        return process.env.KERNEL_PLATFORM_MODE === 'true' ? `tenants/${getTenantConfig().id}/${filename}` : filename;
    }

    /**
     * Upload file to storage
     * @param buffer - File buffer
     * @param originalFilename - Original filename
     * @param mimetype - MIME type
     * @returns Uploaded file details
     */
    async uploadFile(
        buffer: Buffer,
        originalFilename: string,
        mimetype: string
    ): Promise<UploadedFile> {
        const ext = path.extname(originalFilename);
        const filename = `${randomUUID()}${ext}`;

        if (this.provider === 'azure' && this.blobServiceClient) {
            return this.uploadToAzure(buffer, filename, mimetype);
        } else {
            return this.uploadToLocal(buffer, filename, mimetype);
        }
    }

    /**
     * Upload to Azure Blob Storage
     */
    private async uploadToAzure(
        buffer: Buffer,
        filename: string,
        mimetype: string
    ): Promise<UploadedFile> {
        try {
            const containerClient = this.blobServiceClient!.getContainerClient(this.containerName);

            // Ensure container exists
            // Note: Our Azure storage account may disallow public access.
            // Keep the container private and serve downloads via `/api/documents/:filename`.
            await containerClient.createIfNotExists();

            const blockBlobClient = containerClient.getBlockBlobClient(this.scopedKey(filename));

            await blockBlobClient.uploadData(buffer, {
                blobHTTPHeaders: { blobContentType: mimetype },
            });

            return {
                filename,
                // Return API URL (same as local mode) so the app can always fetch securely,
                // regardless of Azure container public access settings.
                url: `/api/documents/${filename}`,
                mimetype,
                size: buffer.length,
            };
        } catch (error) {
            logger.error({ err: error }, 'Azure upload error:');
            throw new Error(`Failed to upload to Azure: ${(error as Error).message}`);
        }
    }

    /**
     * Upload to local filesystem
     */
    private async uploadToLocal(
        buffer: Buffer,
        filename: string,
        mimetype: string
    ): Promise<UploadedFile> {
        const filePath = path.join(this.localUploadDir, this.scopedKey(filename));
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

        await fs.promises.writeFile(filePath, buffer);

        // Return relative path so it adapts to the current domain/IP
        // const baseUrl = process.env.API_URL || 'http://localhost:3000';
        const url = `/api/documents/${filename}`;

        return {
            filename,
            url,
            mimetype,
            size: buffer.length,
        };
    }

    /**
     * Get file stream for download
     */
    async getFileStream(filename: string): Promise<NodeJS.ReadableStream | null> {
        if (this.provider === 'azure' && this.blobServiceClient) {
            const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
            const blobClient = containerClient.getBlockBlobClient(this.scopedKey(filename));
            if (await blobClient.exists()) {
                const downloadResponse = await blobClient.download();
                return downloadResponse.readableStreamBody || null;
            }
            return null;
        } else {
            const filePath = path.join(this.localUploadDir, this.scopedKey(filename));
            if (fs.existsSync(filePath)) {
                return fs.createReadStream(filePath);
            }
            return null;
        }
    }
}

export const storageService = new StorageService();
