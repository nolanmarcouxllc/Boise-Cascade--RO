/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enables src/instrumentation.ts — boots the consolidation scheduler.
    instrumentationHook: true,
  },
};

export default nextConfig;
