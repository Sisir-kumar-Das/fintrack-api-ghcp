const { SharedExpense } = require('./sharedExpense.model');

/**
 * Persist a shared expense document.
 *
 * @param {{ creatorId: string, description: string, totalAmountCents: number, currency: string, splitType: 'equal'|'custom', participants: Array<{ userId: string, shareCents: number }> }} sharedExpenseData
 * @returns {Promise<import('mongoose').Document>}
 */
async function create(sharedExpenseData) {
  return SharedExpense.create(sharedExpenseData);
}

/**
 * Retrieve every active (non-deleted) shared expense where the given user is
 * either the creator or a participant. Used to derive the user's balances.
 *
 * @param {string} userId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function findActiveByParticipantOrCreator(userId) {
  return SharedExpense.find({
    deletedAt: null,
    $or: [{ creatorId: userId }, { 'participants.userId': userId }],
  }).lean();
}

module.exports = {
  create,
  findActiveByParticipantOrCreator,
};
