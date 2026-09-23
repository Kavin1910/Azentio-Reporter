import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@azentio/core', '@azentio/llm', '@azentio/pipeline'],
  // The floating dev-tools badge sits exactly where the assistant launcher lives.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Push-to-talk needs the microphone; nothing else is granted.
        { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(), payment=()' },
      ],
    }];
  },
  experimental: {
    // Sheet parsing happens server-side and can hold a few MB in memory.
    serverActions: { bodySizeLimit: '12mb' },
  },
};

export default config;
