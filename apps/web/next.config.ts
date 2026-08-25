import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // No SENTRY_AUTH_TOKEN configured yet, so source-map upload is skipped
  // with a warning rather than failing the build. See
  // docs/architecture/error-tracking.md.
  silent: true,
  widenClientFileUpload: true,
});
