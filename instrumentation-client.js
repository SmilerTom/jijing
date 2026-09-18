// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProd = process.env.NODE_ENV === 'production';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: false,
    integrations: [Sentry.browserTracingIntegration({ instrumentNavigation: false })],

    ignoreErrors: [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'TypeError: Failed to fetch',
      'TypeError: NetworkError when attempting to fetch resource.'
    ],

    denyUrls: [/google-analytics\.com/i, /www\.google-analytics\.com/i, /googletagmanager\.com/i],

    beforeSend(event, hint) {
      const error = hint.originalException;
      const errorMessage = error?.message || '';
      const isFetchError = errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError');

      if (isFetchError) {
        const isGA =
          event.request?.url?.includes('google-analytics.com') || event.request?.url?.includes('googletagmanager.com');

        const hasGAInBreadcrumbs = event.breadcrumbs?.some(
          (b) =>
            b.category === 'fetch' &&
            (b.data?.url?.includes('google-analytics.com') || b.data?.url?.includes('googletagmanager.com')) &&
            b.data?.status_code === 0
        );

        if (isGA || hasGAInBreadcrumbs) {
          return null;
        }
      }
      if (error && error.message && error.message.includes('window.__firefox__.reader')) {
        return null;
      }
      return event;
    },

    tracesSampleRate: isProd ? 0.1 : 1,
    enableLogs: false,
    sendDefaultPii: true
  });
}

export const onRouterTransitionStart = SENTRY_DSN ? Sentry.captureRouterTransitionStart : () => {};
