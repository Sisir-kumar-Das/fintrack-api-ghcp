const Transaction = require('./transaction.model');

/**
 * Persist a transaction document.
 *
 * @param {{ userId: string, description: string, amountCents: number, currency: string, idempotencyKey?: string }} transactionData
 * @returns {Promise<import('mongoose').Document>}
 */
async function create(transactionData) {
  return Transaction.create(transactionData);
}

/**
 * Retrieve transactions for a specific user.
 *
 * @param {string} userId
 * @param {{ limit: number, skip: number }} pagination
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function findByUserId(userId, { limit, skip }) {
  return Transaction.find({ userId, deletedAt: null })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

/**
 * Retrieve a transaction by its owner's idempotency key.
 *
 * @param {string} userId
 * @param {string} idempotencyKey
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function findByUserIdempotencyKey(userId, idempotencyKey) {
  return Transaction.findOne({ userId, idempotencyKey }).lean();
}

/**
 * Soft-delete all active transactions owned by a specific user.
 *
 * @param {string} userId
 * @param {Date} deletedAt
 * @returns {Promise<{ modifiedCount?: number }>}
 */
async function softDeleteAllByUserId(userId, deletedAt) {
  return Transaction.updateMany(
    { userId, deletedAt: null },
    { $set: { deletedAt } }
  );
}

module.exports = {
  create,
  findByUserId,
  findByUserIdempotencyKey,
  softDeleteAllByUserId,
};
