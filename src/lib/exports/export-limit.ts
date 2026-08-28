export const MAX_EXPORT_BYTES = 8 * 1_024 * 1_024;

export class ExportTooLargeError extends Error {
  readonly code = 'EXPORT_TOO_LARGE';
  readonly status = 413;

  constructor() {
    super('This export is larger than the supported 8 MiB limit.');
    this.name = 'ExportTooLargeError';
  }
}

export class ExportTimeoutError extends Error {
  readonly code = 'EXPORT_TIMEOUT';
  readonly status = 503;

  constructor() {
    super('This export took too long to prepare. Try again shortly.');
    this.name = 'ExportTimeoutError';
  }
}
