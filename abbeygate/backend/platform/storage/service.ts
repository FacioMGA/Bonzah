// FacioMGA - Storage Service
// Handles file uploads to Azure Blob Storage (Production) or Local Filesystem (Dev)

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';

import { logger } from '../utils/logger.js';
import { ensureUploadsDirReady, resolveUploadsDir } from '../runtime/runtimePaths.js';
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
            if (!connectionString) {
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

            const blockBlobClient = containerClient.getBlockBlobClient(filename);

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
        const filePath = path.join(this.localUploadDir, filename);

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
            const blobClient = containerClient.getBlockBlobClient(filename);
            if (await blobClient.exists()) {
                const downloadResponse = await blobClient.download();
                return downloadResponse.readableStreamBody || null;
            }
            return null;
        } else {
            const filePath = path.join(this.localUploadDir, filename);
            if (fs.existsSync(filePath)) {
                return fs.createReadStream(filePath);
            }
            return null;
        }
    }
}

export const storageService = new StorageService();
