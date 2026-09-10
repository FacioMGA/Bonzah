import { Job } from 'bullmq';

export type JobHandler = (job: Job) => Promise<unknown>;

// Registry of extracted job handlers
const handlers: Record<string, JobHandler> = {};

export function registerHandler(jobName: string, handler: JobHandler) {
    handlers[jobName] = handler;
}

export function getHandler(jobName: string): JobHandler | undefined {
    return handlers[jobName];
}
