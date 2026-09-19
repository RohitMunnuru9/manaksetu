/** @type {import('next').NextConfig} */

// The analysis API is served under the dashboard's own origin. That means one
// public address instead of two, no CORS at all (same origin), and no need to
// bake a tunnel URL into the build -- the browser just calls /api/v1/… and
// Next forwards it to the service on localhost.
//
// It also removes a demonstration hazard: with two tunnels, the dashboard URL
// could be live while the API URL had silently rotated, which looks like the
// application is broken.
const API_ORIGIN = process.env.MANAKSETU_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  // A production build writes into the same directory the dev server is
  // reading from, which corrupts it and leaves the running site serving 500s.
  // Setting MANAKSETU_DIST_DIR sends a verification build somewhere else, so a
  // build can be checked without taking a live demonstration down.
  distDir: process.env.MANAKSETU_DIST_DIR ?? ".next",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
    ];
  },
};

export default nextConfig;
