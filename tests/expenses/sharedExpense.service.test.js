jest.mock('../../src/expenses/sharedExpense.repository', () => ({
  create: jest.fn(),
  findActiveByParticipantOrCreator: jest.fn(),
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const sharedExpenseRepository = require('../../src/expenses/sharedExpense.repository');
const logger = require('../../src/config/logger');
const {
  ValidationError,
  UnauthorizedError,
} = require('../../src/expenses/sharedExpense.errors');
const {
  createSharedExpense,
  calculateExpenseDebts,
  getNetBalancesForUser,
} = require('../../src/expenses/sharedExpense.service');

describe('sharedExpense.service', () => {
  const creatorId = '507f1f77bcf86cd799439011';
  const userBId = '507f191e810c19729de860ea';
  const userCId = '5f43b93b1c9d440000a1b2c3';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSharedExpense', () => {
    it('computes equal shares with deterministic remainder distribution by ascending userId', async () => {
      sharedExpenseRepository.create.mockImplementation(async (data) => ({
        id: 'expense-1',
        ...data,
      }));

      const result = await createSharedExpense(creatorId, {
        description: 'Groceries',
        totalAmountCents: 1000,
        splitType: 'equal',
        participants: [
          { userId: userCId },
          { userId: creatorId },
          { userId: userBId },
        ],
      });

      // userBId < creatorId < userCId lexicographically, so the leftover
      // cent (1000 / 3 = 333 remainder 1) goes to userBId.
      expect(result.participants).toEqual([
        { userId: userBId, shareCents: 334 },
        { userId: creatorId, shareCents: 333 },
        { userId: userCId, shareCents: 333 },
      ]);
      expect(sharedExpenseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorId,
          splitType: 'equal',
          totalAmountCents: 1000,
        })
      );
    });

    it('accepts a custom split whose shares sum exactly to the total', async () => {
      sharedExpenseRepository.create.mockImplementation(async (data) => ({
        id: 'expense-2',
        ...data,
      }));

      const result = await createSharedExpense(creatorId, {
        description: 'Concert tickets',
        totalAmountCents: 5000,
        splitType: 'custom',
        participants: [
          { userId: creatorId, shareCents: 3000 },
          { userId: userBId, shareCents: 2000 },
        ],
      });

      expect(result.participants).toEqual([
        { userId: creatorId, shareCents: 3000 },
        { userId: userBId, shareCents: 2000 },
      ]);
    });

    it('rejects a custom split whose shares do not sum exactly to the total', async () => {
      await expect(
        createSharedExpense(creatorId, {
          description: 'Bad split',
          totalAmountCents: 5000,
          splitType: 'custom',
          participants: [
            { userId: creatorId, shareCents: 3000 },
            { userId: userBId, shareCents: 1000 },
          ],
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(sharedExpenseRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an unsupported splitType', async () => {
      await expect(
        createSharedExpense(creatorId, {
          description: 'Dinner',
          totalAmountCents: 2000,
          splitType: 'percentage',
          participants: [{ userId: creatorId }, { userId: userBId }],
        })
      ).rejects.toThrow('splitType must be one of: equal, custom.');
    });

    it('rejects fewer than two participants', async () => {
      await expect(
        createSharedExpense(creatorId, {
          description: 'Solo expense',
          totalAmountCents: 2000,
          splitType: 'equal',
          participants: [{ userId: creatorId }],
        })
      ).rejects.toThrow('A shared expense requires at least two participants.');
    });

    it('rejects duplicate participant userIds', async () => {
      await expect(
        createSharedExpense(creatorId, {
          description: 'Dinner',
          totalAmountCents: 2000,
          splitType: 'equal',
          participants: [{ userId: creatorId }, { userId: creatorId }],
        })
      ).rejects.toThrow('participants must not contain duplicate userId values.');
    });

    it('rejects an unauthenticated user identifier', async () => {
      await expect(
        createSharedExpense('not-an-object-id', {
          description: 'Dinner',
          totalAmountCents: 2000,
          splitType: 'equal',
          participants: [{ userId: creatorId }, { userId: userBId }],
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(sharedExpenseRepository.create).not.toHaveBeenCalled();
    });

    it('logs and propagates an unexpected repository failure', async () => {
      const databaseError = new Error('Database unavailable');
      sharedExpenseRepository.create.mockRejectedValue(databaseError);

      await expect(
        createSharedExpense(creatorId, {
          description: 'Dinner',
          totalAmountCents: 2000,
          splitType: 'equal',
          participants: [{ userId: creatorId }, { userId: userBId }],
        })
      ).rejects.toThrow(databaseError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'sharedExpense.create',
          userId: creatorId,
        }),
        'Failed to create shared expense'
      );
    });
  });

  describe('calculateExpenseDebts', () => {
    it('returns a debt from every non-payer participant to the payer', () => {
      const expense = {
        creatorId,
        totalAmountCents: 3000,
        participants: [
          { userId: creatorId, shareCents: 1000 },
          { userId: userBId, shareCents: 1000 },
          { userId: userCId, shareCents: 1000 },
        ],
      };

      expect(calculateExpenseDebts(expense)).toEqual([
        { fromUserId: userBId, toUserId: creatorId, amountCents: 1000 },
        { fromUserId: userCId, toUserId: creatorId, amountCents: 1000 },
      ]);
    });

    it('omits participants with a zero share', () => {
      const expense = {
        creatorId,
        totalAmountCents: 1000,
        participants: [
          { userId: creatorId, shareCents: 1000 },
          { userId: userBId, shareCents: 0 },
        ],
      };

      expect(calculateExpenseDebts(expense)).toEqual([]);
    });

    it('throws a TypeError when the expense is missing', () => {
      expect(() => calculateExpenseDebts(undefined)).toThrow(TypeError);
    });
  });

  describe('getNetBalancesForUser', () => {
    it('nets bidirectional debts between the authenticated user and each counterpart', async () => {
      sharedExpenseRepository.findActiveByParticipantOrCreator.mockResolvedValue([
        {
          creatorId,
          totalAmountCents: 3000,
          participants: [
            { userId: creatorId, shareCents: 1000 },
            { userId: userBId, shareCents: 1000 },
            { userId: userCId, shareCents: 1000 },
          ],
        },
        {
          creatorId: userBId,
          totalAmountCents: 4000,
          participants: [
            { userId: userBId, shareCents: 1000 },
            { userId: creatorId, shareCents: 3000 },
          ],
        },
      ]);

      const balances = await getNetBalancesForUser(creatorId);

      // B owes the authenticated user 1000 (expense 1) but the authenticated
      // user owes B 3000 (expense 2) => net -2000 (user owes B).
      // C owes the authenticated user 1000 (expense 1), no offsetting debt.
      expect(balances).toEqual([
        { userId: userBId, netAmountCents: -2000 },
        { userId: userCId, netAmountCents: 1000 },
      ]);
      expect(
        sharedExpenseRepository.findActiveByParticipantOrCreator
      ).toHaveBeenCalledWith(creatorId);
    });

    it('omits counterparts whose debts fully cancel out', async () => {
      sharedExpenseRepository.findActiveByParticipantOrCreator.mockResolvedValue([
        {
          creatorId,
          totalAmountCents: 2000,
          participants: [
            { userId: creatorId, shareCents: 1000 },
            { userId: userBId, shareCents: 1000 },
          ],
        },
        {
          creatorId: userBId,
          totalAmountCents: 2000,
          participants: [
            { userId: userBId, shareCents: 1000 },
            { userId: creatorId, shareCents: 1000 },
          ],
        },
      ]);

      await expect(getNetBalancesForUser(creatorId)).resolves.toEqual([]);
    });

    it('rejects an unauthenticated user identifier without querying the repository', async () => {
      await expect(getNetBalancesForUser('not-an-object-id')).rejects.toBeInstanceOf(
        UnauthorizedError
      );

      expect(
        sharedExpenseRepository.findActiveByParticipantOrCreator
      ).not.toHaveBeenCalled();
    });

    it('logs and propagates repository failures', async () => {
      const databaseError = new Error('Database unavailable');
      sharedExpenseRepository.findActiveByParticipantOrCreator.mockRejectedValue(
        databaseError
      );

      await expect(getNetBalancesForUser(creatorId)).rejects.toThrow(databaseError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'sharedExpense.net-balances',
          userId: creatorId,
        }),
        'Failed to calculate net balances'
      );
    });
  });
});
