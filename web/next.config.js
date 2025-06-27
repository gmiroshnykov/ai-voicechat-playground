/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_WEBRTC_URL: process.env.NEXT_PUBLIC_WEBRTC_URL,
  },
};

module.exports = nextConfig;
