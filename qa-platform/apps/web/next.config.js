const path = require('path');

const API_ORIGIN = process.env.API_BASE_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@qa/shared'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  env: {
    // The browser talks only to the web origin; /api/* is proxied to the API
    // below. This removes all CORS + cross-origin-cookie concerns.
    NEXT_PUBLIC_API_BASE_URL: '/api',
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
};
module.exports = nextConfig;
