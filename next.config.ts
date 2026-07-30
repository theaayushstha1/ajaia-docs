import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js — keeps the Cloud Run image small.
  output: 'standalone',
};

export default nextConfig;
