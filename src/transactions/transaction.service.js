const logger = require('../config/logger');
const transactionRepository = require('./transaction.repository');
const { isSupportedCurrency } = require('../config/currencies');
const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
} = require('./transaction.errors');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

/**
 * @typedef {Object} CreateTransactionInput
 * @property {string} description
 * @property {number} amountCents
 * @property {string} [currency]
 * @property {string} [idempotencyKey]
 */

/**
 * Create a transaction for the authenticated user.
 *
 * @param {string} authenticatedUserId
 * @param {CreateTransactionInput} input
 * @returns {Promise<import('mongoose').Document>}
 * @throws {ValidationError|UnauthorizedError}
 */
async function createTransaction(authenticatedUserId, input) {
  validateAuthenticatedUserId(authenticatedUserId);

  if (!input || typeof input !== 'object') {
    throw new ValidationError('Transaction input is required.');
  }

  const { description, amountCents, currency = 'USD', idempotencyKey } = input;

  validateDescription(description);
  validateAmountCents(amountCents);
  validateCurrency(currency);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  if (normalizedIdempotencyKey) {
    const existingTransaction =
      await transactionRepository.findByUserIdempotencyKey(
        authenticatedUserId,
        normalizedIdempotencyKey
      );

    if (existingTransaction) {
      logger.info(
        { operation: 'transaction.create.idempotent', userId: authenticatedUserId },
        'Returning existing transaction for idempotent request'
      );
      return existingTransaction;
    }
  }

  try {
    const transaction = await transactionRepository.create({
      userId: authenticatedUserId,
      description: description.trim(),
      amountCents,
      currency: currency.trim().toUpperCase(),
      ...(normalizedIdempotencyKey
        ? { idempotencyKey: normalizedIdempotencyKey }
        : {}),
    });

    logger.info(
      { operation: 'transaction.create', userId: authenticatedUserId, transactionId: transaction.id },
      'Transaction created'
    );
    return transaction;
  } catch (error) {
    if (error && error.code === 11000 && normalizedIdempotencyKey) {
      const existingTransaction =
        await transactionRepository.findByUserIdempotencyKey(
          authenticatedUserId,
          normalizedIdempotencyKey
        );

      if (existingTransaction) {
        return existingTransaction;
      }

      throw new NotFoundError('The idempotent transaction could not be retrieved.');
    }

    logger.error(
      { err: error, operation: 'transaction.create', userId: authenticatedUserId },
      'Failed to create transaction'
    );
    throw error;
  }
}

/**
 * Get active transactions for the authenticated user, newest first.
 *
 * @param {string} authenticatedUserId
 * @param {{ limit?: number|string, skip?: number|string }} [pagination]
 * @returns {Promise<{ transactions: Array<Record<string, unknown>>, pagination: { limit: number, skip: number } }>}
 * @throws {ValidationError|UnauthorizedError}
 */
async function getTransactionsByUser(authenticatedUserId, pagination = {}) {
  validateAuthenticatedUserId(authenticatedUserId);
  const normalizedPagination = normalizePagination(pagination);

  try {
    const transactions = await transactionRepository.findByUserId(
      authenticatedUserId,
      normalizedPagination
    );

    logger.info(
      {
        operation: 'transaction.retrieve',
        userId: authenticatedUserId,
        limit: normalizedPagination.limit,
        skip: normalizedPagination.skip,
        count: transactions.length,
      },
      'Transactions retrieved'
    );
    return { transactions, pagination: normalizedPagination };
  } catch (error) {
    logger.error(
      { err: error, operation: 'transaction.retrieve', userId: authenticatedUserId },
      'Failed to retrieve transactions'
    );
    throw error;
  }
}

/**
 * Soft-delete every active transaction for the authenticated user.
 *
 * @param {string} authenticatedUserId
 * @returns {Promise<{ deletedCount: number }>}
 * @throws {UnauthorizedError}
 */
async function deleteAllTransactionsByUser(authenticatedUserId) {
  validateAuthenticatedUserId(authenticatedUserId);
  const deletedAt = new Date();

  try {
    const result = await transactionRepository.softDeleteAllByUserId(
      authenticatedUserId,
      deletedAt
    );
    const deletedCount = result.modifiedCount || 0;

    logger.info(
      {
        operation: 'transaction.soft-delete-all',
        userId: authenticatedUserId,
        deletedAt: deletedAt.toISOString(),
        count: deletedCount,
      },
      'Transactions soft-deleted'
    );
    return { deletedCount };
  } catch (error) {
    logger.error(
      { err: error, operation: 'transaction.soft-delete-all', userId: authenticatedUserId },
      'Failed to soft-delete transactions'
    );
    throw error;
  }
}

/**
 * @param {string} authenticatedUserId
 * @returns {void}
 */
function validateAuthenticatedUserId(authenticatedUserId) {
  if (
    typeof authenticatedUserId !== 'string' ||
    !OBJECT_ID_PATTERN.test(authenticatedUserId)
  ) {
    throw new UnauthorizedError();
  }
}

/**
 * @param {string} description
 * @returns {void}
 */
function validateDescription(description) {
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new ValidationError('description is required.');
  }
}

/**
 * @param {number} amountCents
 * @returns {void}
 */
function validateAmountCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new ValidationError(
      'amountCents must be a non-negative integer representing cents.'
    );
  }
}

/**
 * @param {string} currency
 * @returns {void}
 */
function validateCurrency(currency) {
  if (!isSupportedCurrency(currency)) {
    throw new ValidationError('currency must be a valid ISO 4217 currency code.');
  }
}

/**
 * @param {string|undefined} idempotencyKey
 * @returns {string|undefined}
 */
function normalizeIdempotencyKey(idempotencyKey) {
  if (
    idempotencyKey === undefined
  ) {
    return undefined;
  }

  if (typeof idempotencyKey !== 'string') {
    throw new ValidationError(
      'idempotencyKey must be a non-empty string up to 128 characters.'
    );
  }

  const normalizedIdempotencyKey = idempotencyKey.trim();
  if (
    normalizedIdempotencyKey.length === 0 ||
    normalizedIdempotencyKey.length > 128
  ) {
    throw new ValidationError('idempotencyKey must be a non-empty string up to 128 characters.');
  }

  return normalizedIdempotencyKey;
}

/**
 * @param {{ limit?: number|string, skip?: number|string }} pagination
 * @returns {{ limit: number, skip: number }}
 */
function normalizePagination({ limit = DEFAULT_PAGE_SIZE, skip = 0 }) {
  const parsedLimit = Number(limit);
  const parsedSkip = Number(skip);

  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_PAGE_SIZE ||
    !Number.isSafeInteger(parsedSkip) ||
    parsedSkip < 0
  ) {
    throw new ValidationError(
      `limit must be an integer from 1 to ${MAX_PAGE_SIZE} and skip must be a non-negative integer.`
    );
  }

  return { limit: parsedLimit, skip: parsedSkip };
}

module.exports = {
  createTransaction,
  getTransactionsByUser,
  deleteAllTransactionsByUser,
};