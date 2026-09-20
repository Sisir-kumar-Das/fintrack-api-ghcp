const express = require('express');
const logger = require('./config/logger');
const transactionRoutes = require('./transactions/transaction.routes');
const sharedExpenseRoutes = require('./expenses/sharedExpense.routes');

const app = express();

app.use(express.json());

/**
 * Minimal authentication stub for local development and testing only.
 *
 * Reads a user id from the `x-user-id` request header and sets
 * `req.user = { id: ... }`, mirroring the shape the controllers expect from
 * the project's real authentication middleware. This must be replaced with
 * genuine authentication (e.g. verified session/JWT) before any non-local
 * environment relies on `req.user`, since the header is fully
 * attacker-controlled and provides no actual identity verification.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function stubAuthenticate(req, res, next) {
  const userId = req.get('x-user-id');

  if (typeof userId === 'string' && userId.trim().length > 0) {
    req.user = { id: userId.trim() };
  }

  next();
}

app.use(stubAuthenticate);

app.use('/api/transactions', transactionRoutes);
app.use('/api/expenses', sharedExpenseRoutes);

/**
 * Final error-handling middleware. Logs the error with structured context
 * and returns a generic response that never leaks internal details such as
 * stack traces, database error messages, or other implementation specifics.
 * Domain-specific errors (ValidationError, UnauthorizedError, NotFoundError,
 * etc.) are expected to be handled and responded to by each module's own
 * controller before reaching this point; anything that arrives here is
 * treated as an unexpected failure.
 *
 * @param {unknown} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(
    { err, operation: 'app.unhandled-error', method: req.method, path: req.path },
    'Unhandled error'
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}

app.use(errorHandler);

module.exports = app;
