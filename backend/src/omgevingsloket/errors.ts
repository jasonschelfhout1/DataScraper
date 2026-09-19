export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_found' | 'verification_required' | 'rate_limited' | 'temporary' | 'unexpected',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class DiscoveryRequiredError extends UpstreamError {
  constructor() {
    super('The Omgevingsloket API has not been configured from a verified discovery capture.', 'verification_required');
    this.name = 'DiscoveryRequiredError';
  }
}
