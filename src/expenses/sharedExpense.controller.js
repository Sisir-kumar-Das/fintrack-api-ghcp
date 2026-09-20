const sharedExpenseService = require('./sharedExpense.service');
const {
  SharedExpenseError,
  UnauthorizedError,
} = require('./sharedExpense.errors');

/**
 * Create a shared expense paid and owned by the authenticated user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function createSharedExpense(req, res, next) {
  try {
    const sharedExpense = await sharedExpenseService.createSharedExpense(
      getAuthenticatedUserId(req),
      req.body
    );
    res.status(201).json({ data: sharedExpense });
  } catch (error) {
    handleError(error, res, next);
  }
}

/**
 * Retrieve the authenticated user's net balances across all active shared expenses.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function getNetBalances(req, res, next) {
  try {
    const netBalances = await sharedExpenseService.getNetBalancesForUser(
      getAuthenticatedUserId(req)
    );
    res.status(200).json({ data: netBalances });
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
  if (error instanceof SharedExpenseError) {
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
  createSharedExpense,
  getNetBalances,
};
