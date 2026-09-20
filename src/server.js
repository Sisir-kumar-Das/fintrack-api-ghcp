require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Connect to MongoDB and start the HTTP server. Exits the process if the
 * required database connection cannot be established, since the API cannot
 * safely serve requests without a working data layer.
 *
 * @returns {Promise<void>}
 */
async function start() {
  if (!MONGODB_URI) {
    logger.error(
      { operation: 'server.start' },
      'MONGODB_URI environment variable is not set.'
    );
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    logger.info({ operation: 'server.start' }, 'Connected to MongoDB.');

    app.listen(PORT, () => {
      logger.info(
        { operation: 'server.start', port: PORT },
        `FinTrack API listening on port ${PORT}.`
      );
    });
  } catch (error) {
    logger.error(
      { err: error, operation: 'server.start' },
      'Failed to start the server.'
    );
    process.exitCode = 1;
  }
}

start();
