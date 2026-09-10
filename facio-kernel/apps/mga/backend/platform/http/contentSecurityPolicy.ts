/** Shared production/development CSP options used by the HTTP server and transport regression tests. */
export function applicationContentSecurityPolicy(production: boolean) {
  return {
    reportOnly: !production,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      scriptSrc: [
        "'self'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://*.oppwa.com',
        'https://edge.marker.io',
        'https://*.marker.io',
      ],
      scriptSrcElem: [
        "'self'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://*.oppwa.com',
        'https://edge.marker.io',
        'https://*.marker.io',
      ],
      workerSrc: [
        "'self'",
        'blob:',
        'https://*.oppwa.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://*.oppwa.com',
      ],
      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://*.oppwa.com',
      ],
      imgSrc: [
        // Workspace logo fields accept HTTPS URLs; images remain inert and scripts/connect stay restricted.
        'https:',
        "'self'",
        'data:',
        'blob:',
        'https://maps.gstatic.com',
        'https://maps.googleapis.com',
        'https://*.oppwa.com',
        'https://*.marker.io',
      ],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://*.oppwa.com'],
      connectSrc: [
        "'self'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        'https://*.oppwa.com',
        'https://edge.marker.io',
        'https://*.marker.io',
        'https://*.ingest.us.sentry.io',
      ],
      frameSrc: [
        "'self'",
        'https://*.oppwa.com',
        'https://*.marker.io',
        // CardCorp/OPPWA 3DS challenge and method iframes can use issuer ACS
        // origins outside *.oppwa.com. Keep scripts/connect narrowed above.
        'https:',
      ],
      formAction: [
        "'self'",
        'https://*.oppwa.com',
        'https:',
      ],
    },
  };
}
