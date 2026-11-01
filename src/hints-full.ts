import { errorCodes } from './error-codes.ts';
import type { InjecuteErrorCode } from './errors.ts';

/** @internal The hint for an error code. */
export const hintOf = (code: InjecuteErrorCode): string | undefined =>
  errorCodes[code].hint;
