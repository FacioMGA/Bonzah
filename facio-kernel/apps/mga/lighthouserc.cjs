/** @type {import('@lhci/cli').LHCIConfig} */
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run preview -- --port=4173 --strictPort',
      startServerReadyPattern: 'Local:',
      url: [
        'http://localhost:4173/get-auto-quote',
        'http://localhost:4173/client',
      ],
      numberOfRuns: 1,
      settings: {
        // Keep stable scores and reduce flakiness.
        preset: 'desktop',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      // Start with warnings; tighten to errors as we baseline.
      assertions: {
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.85 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './lhci_reports',
    },
  },
};

