const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'headers.authorization',
      'cookie',
      'headers.cookie',
      'cardNumber',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
