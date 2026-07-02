import type { NextConfig } from 'next';

const backendApiUrl = (
  process.env.BACKEND_API_URL ?? 'http://127.0.0.1:6060'
).replace(/\/+$/, '');
const configuredProxyTimeout = Number(
  process.env.BACKEND_PROXY_TIMEOUT_MS ?? 1_860_000,
);
const backendProxyTimeout =
  Number.isFinite(configuredProxyTimeout) && configuredProxyTimeout > 0
    ? configuredProxyTimeout
    : 1_860_000;

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Must exceed the backend's 10-minute connection timeout plus its
    // 20-minute MSSQL request timeout.
    proxyTimeout: backendProxyTimeout,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendApiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
