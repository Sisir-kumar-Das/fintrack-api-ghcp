const transactionService = require('./transaction.service');
const {
  TransactionError,
  UnauthorizedError,
} = require('./transaction.errors');

/**
 * Create a transaction for the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function createTransaction(req, res, next) {
  try {
    const transaction = await transactionService.createTransaction(
      getAuthenticatedUserId(req),
      req.body
    );
    res.status(201).json({ data: transaction });
  } catch (error) {
    handleError(error, res, next);
  }
}

/**
 * Retrieve transactions for the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getTransactionsByUser(req, res, next) {
  try {
    const result = await transactionService.getTransactionsByUser(
      getAuthenticatedUserId(req),
      req.query
    );
    res.status(200).json({ data: result.transactions, pagination: result.pagination });
  } catch (error) {
    handleError(error, res, next);
  }
}

/**
 * Soft-delete all transactions for the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function deleteAllTransactionsByUser(req, res, next) {
  try {
    const result = await transactionService.deleteAllTransactionsByUser(
      getAuthenticatedUserId(req)
    );
    res.status(200).json({ data: result });
  } catch (error) {
    handleError(error, res, next);
  }
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function getAuthenticatedUserId(req) {
  if (!req.user || typeof req.user.id !== 'string') {
    throw new UnauthorizedError();
  }

  return req.user.id;
}

/**
 * @param {unknown} error
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function handleError(error, res, next) {
  if (error instanceof TransactionError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  next(error);
}

module.exports = {
  createTransaction,
  getTransactionsByUser,
  deleteAllTransactionsByUser,
};
