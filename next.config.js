/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/ollama/:path*',
        destination: 'http://localhost:11434/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig; 