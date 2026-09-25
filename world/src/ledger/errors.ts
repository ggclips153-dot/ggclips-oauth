export type LedgerErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID' | 'CONFLICT' | 'NOT_FOUND';

const STATUS: Record<LedgerErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID: 400,
  CONFLICT: 409,
  NOT_FOUND: 404,
};

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  readonly status: number;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
  }
}

export const forbid = (msg: string): never => {
  throw new LedgerError('FORBIDDEN', msg);
};
export const invalid = (msg: string): never => {
  throw new LedgerError('INVALID', msg);
};
export const conflict = (msg: string): never => {
  throw new LedgerError('CONFLICT', msg);
};
export const notFound = (msg: string): never => {
  throw new LedgerError('NOT_FOUND', msg);
};
