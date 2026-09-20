const logger = require('../config/logger');
const sharedExpenseRepository = require('./sharedExpense.repository');
const { isSupportedCurrency } = require('../config/currencies');
const { SPLIT_TYPES } = require('./sharedExpense.model');
const {
  ValidationError,
  UnauthorizedError,
} = require('./sharedExpense.errors');

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

/**
 * @typedef {Object} CreateSharedExpenseParticipantInput
 * @property {string} userId - The participating user.
 * @property {number} [shareCents] - Required for `custom` splits; ignored for `equal` splits.
 */

/**
 * @typedef {Object} CreateSharedExpenseInput
 * @property {string} description
 * @property {number} totalAmountCents
 * @property {string} [currency]
 * @property {'equal'|'custom'} splitType
 * @property {CreateSharedExpenseParticipantInput[]} participants
 */

/**
 * @typedef {Object} ExpenseDebt
 * @property {string} fromUserId - The user who owes money.
 * @property {string} toUserId - The user who is owed money (the expense's payer).
 * @property {number} amountCents - The amount owed, as an integer in cents.
 */

/**
 * @typedef {Object} NetBalance
 * @property {string} userId - The counterpart user id.
 * @property {number} netAmountCents - Positive: the counterpart owes the authenticated user.
 *   Negative: the authenticated user owes the counterpart. Never zero (zero balances are omitted).
 */

/**
 * Create a shared expense paid and owned by the authenticated user.
 *
 * For an `equal` split, each participant's share is computed as
 * `Math.floor(totalAmountCents / participantCount)`, with any leftover cents
 * distributed one-by-one to participants sorted by `userId` ascending, so the
 * shares always reconcile exactly to `totalAmountCents` regardless of how the
 * division rounds.
 *
 * For a `custom` split, each participant must supply their own `shareCents`,
 * which must sum exactly to `totalAmountCents` with no rounding tolerance.
 *
 * @param {string} authenticatedUserId
 * @param {CreateSharedExpenseInput} input
 * @returns {Promise<import('mongoose').Document>}
 * @throws {ValidationError|UnauthorizedError}
 */
async function createSharedExpense(authenticatedUserId, input) {
  validateAuthenticatedUserId(authenticatedUserId);

  if (!input || typeof input !== 'object') {
    throw new ValidationError('Shared expense input is required.');
  }

  const {
    description,
    totalAmountCents,
    currency = 'USD',
    splitType,
    participants,
  } = input;

  validateDescription(description);
  validateTotalAmountCents(totalAmountCents);
  validateCurrency(currency);
  validateSplitType(splitType);
  const normalizedParticipantInputs = validateParticipantInputs(participants);

  const resolvedParticipants =
    splitType === 'equal'
      ? computeEqualSplitShares(normalizedParticipantInputs, totalAmountCents)
      : computeCustomSplitShares(normalizedParticipantInputs, totalAmountCents);

  try {
    const sharedExpense = await sharedExpenseRepository.create({
      creatorId: authenticatedUserId,
      description: description.trim(),
      totalAmountCents,
      currency: currency.trim().toUpperCase(),
      splitType,
      participants: resolvedParticipants,
    });

    logger.info(
      {
        operation: 'sharedExpense.create',
        userId: authenticatedUserId,
        expenseId: sharedExpense.id,
        splitType,
        participantCount: resolvedParticipants.length,
      },
      'Shared expense created'
    );
    return sharedExpense;
  } catch (error) {
    logger.error(
      { err: error, operation: 'sharedExpense.create', userId: authenticatedUserId },
      'Failed to create shared expense'
    );
    throw error;
  }
}

/**
 * Derive the debts implied by a single shared expense: every participant
 * except the payer (`creatorId`) owes the payer their `shareCents`. This is a
 * pure function — it performs no database access and depends only on its
 * input, so it is independently unit-testable and safe to reuse for both
 * on-demand aggregation and, if needed later, previewing an expense before
 * it is persisted.
 *
 * Participants with a zero (or otherwise non-positive) share are omitted,
 * since they represent no actual debt.
 *
 * @param {{ creatorId: string|import('mongoose').Types.ObjectId, participants: Array<{ userId: string|import('mongoose').Types.ObjectId, shareCents: number }> }} expense
 * @returns {ExpenseDebt[]}
 * @throws {TypeError} If `expense` is missing required fields.
 */
function calculateExpenseDebts(expense) {
  if (!expense || typeof expense !== 'object') {
    throw new TypeError('expense is required.');
  }

  if (!Array.isArray(expense.participants)) {
    throw new TypeError('expense.participants must be an array.');
  }

  const payerUserId = normalizeUserId(expense.creatorId);

  const debts = [];
  for (const participant of expense.participants) {
    const participantUserId = normalizeUserId(participant.userId);

    if (participantUserId === payerUserId) {
      continue; // The payer never owes themselves.
    }

    if (!Number.isInteger(participant.shareCents) || participant.shareCents <= 0) {
      continue; // No debt exists for a zero (or invalid) share.
    }

    debts.push({
      fromUserId: participantUserId,
      toUserId: payerUserId,
      amountCents: participant.shareCents,
    });
  }

  return debts;
}

/**
 * Compute the authenticated user's net balance against every counterpart
 * they share an active expense with. This aggregates on demand: it fetches
 * every active shared expense involving the user, derives per-expense debts
 * with {@link calculateExpenseDebts}, and nets bidirectional debts between
 * the user and each counterpart into a single signed balance.
 *
 * Authorization is enforced by design, not by parameter checking: this
 * function accepts only the authenticated user's own id and always scopes
 * the underlying query to that id. There is no separate "target user id"
 * parameter, so callers cannot request another user's balances.
 *
 * @param {string} authenticatedUserId
 * @returns {Promise<NetBalance[]>}
 * @throws {UnauthorizedError}
 */
async function getNetBalancesForUser(authenticatedUserId) {
  validateAuthenticatedUserId(authenticatedUserId);

  try {
    const expenses = await sharedExpenseRepository.findActiveByParticipantOrCreator(
      authenticatedUserId
    );

    const netAmountCentsByCounterpart = new Map();

    for (const expense of expenses) {
      const debts = calculateExpenseDebts(expense);

      for (const debt of debts) {
        if (debt.fromUserId === authenticatedUserId) {
          // The authenticated user owes debt.toUserId.
          accumulateNetAmount(
            netAmountCentsByCounterpart,
            debt.toUserId,
            -debt.amountCents
          );
        } else if (debt.toUserId === authenticatedUserId) {
          // debt.fromUserId owes the authenticated user.
          accumulateNetAmount(
            netAmountCentsByCounterpart,
            debt.fromUserId,
            debt.amountCents
          );
        }
        // Otherwise the debt is between two other participants and does not
        // involve the authenticated user; ignore it.
      }
    }

    const netBalances = Array.from(netAmountCentsByCounterpart.entries())
      .filter(([, netAmountCents]) => netAmountCents !== 0)
      .map(([userId, netAmountCents]) => ({ userId, netAmountCents }))
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

    logger.info(
      {
        operation: 'sharedExpense.net-balances',
        userId: authenticatedUserId,
        expenseCount: expenses.length,
        counterpartCount: netBalances.length,
      },
      'Net balances calculated'
    );
    return netBalances;
  } catch (error) {
    logger.error(
      { err: error, operation: 'sharedExpense.net-balances', userId: authenticatedUserId },
      'Failed to calculate net balances'
    );
    throw error;
  }
}

/**
 * @param {Map<string, number>} netAmountCentsByCounterpart
 * @param {string} counterpartUserId
 * @param {number} deltaCents
 * @returns {void}
 */
function accumulateNetAmount(netAmountCentsByCounterpart, counterpartUserId, deltaCents) {
  netAmountCentsByCounterpart.set(
    counterpartUserId,
    (netAmountCentsByCounterpart.get(counterpartUserId) || 0) + deltaCents
  );
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {string}
 */
function normalizeUserId(userId) {
  if (userId === null || userId === undefined) {
    throw new TypeError('A userId is required.');
  }
  return typeof userId === 'string' ? userId : userId.toString();
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
 * @param {number} totalAmountCents
 * @returns {void}
 */
function validateTotalAmountCents(totalAmountCents) {
  if (!Number.isInteger(totalAmountCents) || totalAmountCents < 0) {
    throw new ValidationError(
      'totalAmountCents must be a non-negative integer representing cents.'
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
 * @param {string} splitType
 * @returns {void}
 */
function validateSplitType(splitType) {
  if (!SPLIT_TYPES.includes(splitType)) {
    throw new ValidationError(`splitType must be one of: ${SPLIT_TYPES.join(', ')}.`);
  }
}

/**
 * Validate the raw participant inputs shared by both split types: at least
 * two participants, each with a valid, unique `userId`. Split-type-specific
 * share validation happens in {@link computeEqualSplitShares} and
 * {@link computeCustomSplitShares}.
 *
 * @param {CreateSharedExpenseParticipantInput[]} participants
 * @returns {CreateSharedExpenseParticipantInput[]}
 */
function validateParticipantInputs(participants) {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new ValidationError('A shared expense requires at least two participants.');
  }

  const normalizedParticipants = participants.map((participant, index) => {
    if (!participant || typeof participant !== 'object') {
      throw new ValidationError(`participants[${index}] must be an object.`);
    }

    const { userId, shareCents } = participant;
    if (typeof userId !== 'string' || !OBJECT_ID_PATTERN.test(userId)) {
      throw new ValidationError(`participants[${index}].userId must be a valid user id.`);
    }

    return shareCents === undefined ? { userId } : { userId, shareCents };
  });

  const uniqueUserIds = new Set(
    normalizedParticipants.map((participant) => participant.userId)
  );
  if (uniqueUserIds.size !== normalizedParticipants.length) {
    throw new ValidationError('participants must not contain duplicate userId values.');
  }

  return normalizedParticipants;
}

/**
 * @param {CreateSharedExpenseParticipantInput[]} participantInputs
 * @param {number} totalAmountCents
 * @returns {Array<{ userId: string, shareCents: number }>}
 */
function computeEqualSplitShares(participantInputs, totalAmountCents) {
  const sortedUserIds = participantInputs
    .map((participant) => participant.userId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const participantCount = sortedUserIds.length;
  const baseShareCents = Math.floor(totalAmountCents / participantCount);
  const remainderCents = totalAmountCents - baseShareCents * participantCount;

  return sortedUserIds.map((userId, index) => ({
    userId,
    // Distribute the leftover cents one-by-one to the first `remainderCents`
    // participants in ascending userId order. This is deterministic
    // regardless of the order participants were supplied in, and guarantees
    // the shares always sum exactly to totalAmountCents.
    shareCents: baseShareCents + (index < remainderCents ? 1 : 0),
  }));
}

/**
 * @param {CreateSharedExpenseParticipantInput[]} participantInputs
 * @param {number} totalAmountCents
 * @returns {Array<{ userId: string, shareCents: number }>}
 * @throws {ValidationError} If any share is not a non-negative integer, or
 *   the shares do not sum exactly to `totalAmountCents`.
 */
function computeCustomSplitShares(participantInputs, totalAmountCents) {
  const resolvedParticipants = participantInputs.map((participant, index) => {
    if (!Number.isInteger(participant.shareCents) || participant.shareCents < 0) {
      throw new ValidationError(
        `participants[${index}].shareCents must be a non-negative integer representing cents.`
      );
    }
    return { userId: participant.userId, shareCents: participant.shareCents };
  });

  const shareSumCents = resolvedParticipants.reduce(
    (sum, participant) => sum + participant.shareCents,
    0
  );

  if (shareSumCents !== totalAmountCents) {
    throw new ValidationError(
      `Custom participant shares must sum exactly to totalAmountCents (expected ${totalAmountCents}, received ${shareSumCents}).`
    );
  }

  return resolvedParticipants;
}

module.exports = {
  createSharedExpense,
  calculateExpenseDebts,
  getNetBalancesForUser,
};
