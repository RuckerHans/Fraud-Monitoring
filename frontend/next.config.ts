import type { NextConfig } from 'next';

const backendApiUrl = (
  process.env.BACKEND_API_URL ?? 'http://127.0.0.1:6060'
).replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
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
