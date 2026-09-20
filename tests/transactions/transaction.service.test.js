jest.mock('../../src/transactions/transaction.repository', () => ({
  create: jest.fn(),
  findByUserId: jest.fn(),
  findByUserIdempotencyKey: jest.fn(),
  softDeleteAllByUserId: jest.fn(),
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const transactionRepository = require('../../src/transactions/transaction.repository');
const logger = require('../../src/config/logger');
const {
  ValidationError,
  UnauthorizedError,
} = require('../../src/transactions/transaction.errors');
const {
  createTransaction,
  getTransactionsByUser,
  deleteAllTransactionsByUser,
} = require('../../src/transactions/transaction.service');

describe('transaction.service', () => {
  const authenticatedUserId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('creates a transaction owned by the authenticated user', async () => {
      const createdTransaction = {
        id: 'transaction-1',
        userId: authenticatedUserId,
        description: 'Dinner split',
        amountCents: 2599,
        currency: 'USD',
      };
      transactionRepository.create.mockResolvedValue(createdTransaction);

      await expect(
        createTransaction(authenticatedUserId, {
          userId: '507f191e810c19729de860ea',
          description: '  Dinner split  ',
          amountCents: 2599,
          currency: 'usd',
          idempotencyKey: ' create-transaction-1 ',
        })
      ).resolves.toEqual(createdTransaction);

      expect(transactionRepository.create).toHaveBeenCalledWith({
        userId: authenticatedUserId,
        description: 'Dinner split',
        amountCents: 2599,
        currency: 'USD',
        idempotencyKey: 'create-transaction-1',
      });
    });

    it('returns an existing transaction for an idempotent request', async () => {
      const existingTransaction = { id: 'transaction-1', userId: authenticatedUserId };
      transactionRepository.findByUserIdempotencyKey.mockResolvedValue(
        existingTransaction
      );

      await expect(
        createTransaction(authenticatedUserId, {
          description: 'Dinner split',
          amountCents: 2599,
          idempotencyKey: 'create-transaction-1',
        })
      ).resolves.toEqual(existingTransaction);

      expect(transactionRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a non-integer monetary value', async () => {
      await expect(
        createTransaction(authenticatedUserId, {
          description: 'Coffee',
          amountCents: 12.5,
          currency: 'USD',
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(transactionRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a non-ISO currency code', async () => {
      await expect(
        createTransaction(authenticatedUserId, {
          description: 'Coffee',
          amountCents: 450,
          currency: 'ZZZ',
        })
      ).rejects.toThrow('currency must be a valid ISO 4217 currency code.');
    });

    it('rejects an unauthenticated user identifier', async () => {
      await expect(
        createTransaction('invalid-user', {
          description: 'Coffee',
          amountCents: 450,
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('logs and propagates an unexpected repository failure', async () => {
      const databaseError = new Error('Database unavailable');
      transactionRepository.create.mockRejectedValue(databaseError);

      await expect(
        createTransaction(authenticatedUserId, {
          description: 'Coffee',
          amountCents: 450,
        })
      ).rejects.toThrow(databaseError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'transaction.create',
          userId: authenticatedUserId,
        }),
        'Failed to create transaction'
      );
    });

    it('returns the persisted transaction when a concurrent idempotent create conflicts', async () => {
      const existingTransaction = { id: 'transaction-1', userId: authenticatedUserId };
      transactionRepository.create.mockRejectedValue({ code: 11000 });
      transactionRepository.findByUserIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingTransaction);

      await expect(
        createTransaction(authenticatedUserId, {
          description: 'Dinner split',
          amountCents: 2599,
          idempotencyKey: 'create-transaction-1',
        })
      ).resolves.toEqual(existingTransaction);
    });
  });

  describe('getTransactionsByUser', () => {
    it('retrieves only active transactions scoped to the authenticated user', async () => {
      const transactions = [{ id: 'transaction-1', userId: authenticatedUserId }];
      transactionRepository.findByUserId.mockResolvedValue(transactions);

      await expect(
        getTransactionsByUser(authenticatedUserId, { limit: '10', skip: '5' })
      ).resolves.toEqual({
        transactions,
        pagination: { limit: 10, skip: 5 },
      });

      expect(transactionRepository.findByUserId).toHaveBeenCalledWith(
        authenticatedUserId,
        { limit: 10, skip: 5 }
      );
    });

    it('uses a bounded default page size', async () => {
      transactionRepository.findByUserId.mockResolvedValue([]);

      await getTransactionsByUser(authenticatedUserId);

      expect(transactionRepository.findByUserId).toHaveBeenCalledWith(
        authenticatedUserId,
        { limit: 25, skip: 0 }
      );
    });

    it('rejects unsafe pagination values', async () => {
      await expect(
        getTransactionsByUser(authenticatedUserId, { limit: 101 })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(transactionRepository.findByUserId).not.toHaveBeenCalled();
    });

    it('logs and propagates repository retrieval failures', async () => {
      const databaseError = new Error('Database unavailable');
      transactionRepository.findByUserId.mockRejectedValue(databaseError);

      await expect(
        getTransactionsByUser(authenticatedUserId)
      ).rejects.toThrow(databaseError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'transaction.retrieve',
          userId: authenticatedUserId,
        }),
        'Failed to retrieve transactions'
      );
    });
  });

  describe('deleteAllTransactionsByUser', () => {
    it('soft-deletes active transactions owned by the authenticated user', async () => {
      transactionRepository.softDeleteAllByUserId.mockResolvedValue({
        modifiedCount: 3,
      });

      await expect(
        deleteAllTransactionsByUser(authenticatedUserId)
      ).resolves.toEqual({ deletedCount: 3 });

      expect(transactionRepository.softDeleteAllByUserId).toHaveBeenCalledWith(
        authenticatedUserId,
        expect.any(Date)
      );
    });

    it('rejects an invalid authenticated user identifier', async () => {
      await expect(
        deleteAllTransactionsByUser('bad-user-id')
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(
        transactionRepository.softDeleteAllByUserId
      ).not.toHaveBeenCalled();
    });

    it('logs and propagates repository soft-delete failures', async () => {
      const databaseError = new Error('Database unavailable');
      transactionRepository.softDeleteAllByUserId.mockRejectedValue(databaseError);

      await expect(
        deleteAllTransactionsByUser(authenticatedUserId)
      ).rejects.toThrow(databaseError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'transaction.soft-delete-all',
          userId: authenticatedUserId,
        }),
        'Failed to soft-delete transactions'
      );
    });
  });
});
