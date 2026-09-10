const path = require('path');

/**
 * Puppeteer configuration.
 *
 * Why: When we deploy node_modules prebuilt to Azure (via GitHub Actions),
 * the Puppeteer postinstall hook doesn't run on the server, so Chrome isn't downloaded.
 * By installing the browser during CI into a repo folder, and pointing Puppeteer at it,
 * runtime PDF generation can reliably find Chrome.
 */
module.exports = {
  // Keep this folder inside the deployed package (avoid hidden dirs that some zip/deploy tools may skip).
  cacheDirectory: path.join(__dirname, 'puppeteer-cache'),
};

