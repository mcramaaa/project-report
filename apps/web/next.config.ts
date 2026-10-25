import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Share the repository root .env with the API; variables already set win.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Browser talks only to this origin; /api is proxied so the session cookie stays first-party (D-031).
  // Note: evaluated at build time for `next build`.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
