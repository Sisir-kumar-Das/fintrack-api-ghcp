jest.mock('../../src/transactions/transaction.service', () => ({
  createTransaction: jest.fn(),
  getTransactionsByUser: jest.fn(),
  deleteAllTransactionsByUser: jest.fn(),
}));

const transactionService = require('../../src/transactions/transaction.service');
const transactionController = require('../../src/transactions/transaction.controller');
const {
  ValidationError,
  NotFoundError,
} = require('../../src/transactions/transaction.errors');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('transaction.controller', () => {
  const authenticatedUserId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses req.user.id instead of a user ID in the request body', async () => {
    const req = {
      user: { id: authenticatedUserId },
      body: {
        userId: '507f191e810c19729de860ea',
        description: 'Lunch',
        amountCents: 1200,
      },
    };
    const res = createResponse();
    const next = jest.fn();
    transactionService.createTransaction.mockResolvedValue({ id: 'transaction-1' });

    await transactionController.createTransaction(req, res, next);

    expect(transactionService.createTransaction).toHaveBeenCalledWith(
      authenticatedUserId,
      req.body
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('maps transaction validation errors to a safe 400 response', async () => {
    const req = { user: { id: authenticatedUserId }, query: {} };
    const res = createResponse();
    const next = jest.fn();
    transactionService.getTransactionsByUser.mockRejectedValue(
      new ValidationError('Invalid limit')
    );

    await transactionController.getTransactionsByUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid limit' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns transactions and pagination for the authenticated user', async () => {
    const req = {
      user: { id: authenticatedUserId },
      query: { limit: '10', skip: '0' },
    };
    const res = createResponse();
    const next = jest.fn();
    transactionService.getTransactionsByUser.mockResolvedValue({
      transactions: [{ id: 'transaction-1' }],
      pagination: { limit: 10, skip: 0 },
    });

    await transactionController.getTransactionsByUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: 'transaction-1' }],
      pagination: { limit: 10, skip: 0 },
    });
  });

  it('returns the soft-delete count for the authenticated user', async () => {
    const req = { user: { id: authenticatedUserId } };
    const res = createResponse();
    const next = jest.fn();
    transactionService.deleteAllTransactionsByUser.mockResolvedValue({
      deletedCount: 2,
    });

    await transactionController.deleteAllTransactionsByUser(req, res, next);

    expect(transactionService.deleteAllTransactionsByUser).toHaveBeenCalledWith(
      authenticatedUserId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { deletedCount: 2 } });
  });

  it('maps a not-found error to a safe 404 response', async () => {
    const req = { user: { id: authenticatedUserId } };
    const res = createResponse();
    const next = jest.fn();
    transactionService.deleteAllTransactionsByUser.mockRejectedValue(
      new NotFoundError()
    );

    await transactionController.deleteAllTransactionsByUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes unexpected errors to standard error middleware', async () => {
    const req = { user: { id: authenticatedUserId }, query: {} };
    const res = createResponse();
    const next = jest.fn();
    const databaseError = new Error('Database unavailable');
    transactionService.getTransactionsByUser.mockRejectedValue(databaseError);

    await transactionController.getTransactionsByUser(req, res, next);

    expect(next).toHaveBeenCalledWith(databaseError);
  });

  it('returns 401 without calling the service when req.user.id is absent', async () => {
    const req = { user: undefined, body: {} };
    const res = createResponse();
    const next = jest.fn();

    await transactionController.createTransaction(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(transactionService.createTransaction).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
