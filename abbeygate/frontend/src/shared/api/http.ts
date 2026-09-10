import { api } from './internal/httpTransport';

export const http = api;

export type HttpClient = typeof http;
