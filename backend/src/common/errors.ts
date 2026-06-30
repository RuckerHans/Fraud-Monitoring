export class BranchUnreachableError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BranchUnreachableError';
  }
}
export class UpstreamUnavailableError extends Error {}
