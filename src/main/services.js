'use strict';

const path = require('path');
const { Logger } = require('./modules/logger');
const { SettingsStore } = require('./modules/settings');
const { CredentialManager } = require('./modules/credential-manager');
const { RecipientStore } = require('./modules/recipient-store');
const { HistoryStore } = require('./modules/history-store');
const { SuppressionStore } = require('./modules/suppression-store');
const { CampaignManager } = require('./modules/campaign-manager');
const { ExtractionService } = require('./modules/extraction-service');

/**
 * Composition root: creates every service once, given the Electron-provided
 * data directory and safeStorage. Keeping this separate from main.js makes the
 * wiring easy to read and to reuse in tests.
 */
function createServices({ dataDir, safeStorage, logToConsole = false }) {
  const logger = new Logger(path.join(dataDir, 'logs', 'super-mailer.log'), { console: logToConsole });
  const settings = new SettingsStore(path.join(dataDir, 'settings.json'));
  const suppression = new SuppressionStore(path.join(dataDir, 'suppressed.json'));
  const history = new HistoryStore(path.join(dataDir, 'campaign-history.json'));
  const credentials = new CredentialManager({
    safeStorage,
    filePath: path.join(dataDir, 'credentials.bin.json')
  });
  const recipients = new RecipientStore({
    persistPath: path.join(dataDir, 'recipients.json'),
    isSuppressed: (email) => suppression.has(email)
  });
  const campaigns = new CampaignManager({ settings, credentials, suppression, history, logger });
  const extraction = new ExtractionService();

  const interrupted = campaigns.recoverInterrupted();
  if (interrupted) logger.warn('Marked interrupted campaigns from previous session', { count: interrupted });
  logger.info('Services initialized', { dataDir: 'userData', recipients: recipients.stats().total });

  return { logger, settings, suppression, history, credentials, recipients, campaigns, extraction };
}

module.exports = { createServices };
