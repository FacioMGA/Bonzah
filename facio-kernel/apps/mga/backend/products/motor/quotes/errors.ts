export class PublicApiError extends Error {
  public readonly httpStatus: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(args: { httpStatus: number; code: string; message: string; details?: unknown }) {
    super(args.message);
    this.httpStatus = args.httpStatus;
    this.code = args.code;
    this.details = args.details;
  }
}

