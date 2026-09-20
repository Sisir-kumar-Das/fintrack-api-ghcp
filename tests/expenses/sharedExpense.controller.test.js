jest.mock('../../src/expenses/sharedExpense.service', () => ({
  createSharedExpense: jest.fn(),
  getNetBalancesForUser: jest.fn(),
}));

const sharedExpenseService = require('../../src/expenses/sharedExpense.service');
const sharedExpenseController = require('../../src/expenses/sharedExpense.controller');
const {
  ValidationError,
  NotFoundError,
} = require('../../src/expenses/sharedExpense.errors');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('sharedExpense.controller', () => {
  const authenticatedUserId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSharedExpense', () => {
    it('uses req.user.id instead of a creatorId in the request body', async () => {
      const req = {
        user: { id: authenticatedUserId },
        body: {
          creatorId: '507f191e810c19729de860ea',
          description: 'Dinner',
          totalAmountCents: 3000,
          splitType: 'equal',
          participants: [
            { userId: authenticatedUserId },
            { userId: '507f191e810c19729de860ea' },
          ],
        },
      };
      const res = createResponse();
      const next = jest.fn();
      sharedExpenseService.createSharedExpense.mockResolvedValue({
        id: 'expense-1',
      });

      await sharedExpenseController.createSharedExpense(req, res, next);

      expect(sharedExpenseService.createSharedExpense).toHaveBeenCalledWith(
        authenticatedUserId,
        req.body
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 'expense-1' } });
      expect(next).not.toHaveBeenCalled();
    });

    it('maps a validation error to a safe 400 response', async () => {
      const req = { user: { id: authenticatedUserId }, body: {} };
      const res = createResponse();
      const next = jest.fn();
      sharedExpenseService.createSharedExpense.mockRejectedValue(
        new ValidationError('description is required.')
      );

      await sharedExpenseController.createSharedExpense(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'VALIDATION_ERROR', message: 'description is required.' },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 without calling the service when req.user.id is absent', async () => {
      const req = { user: undefined, body: {} };
      const res = createResponse();
      const next = jest.fn();

      await sharedExpenseController.createSharedExpense(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
      });
      expect(sharedExpenseService.createSharedExpense).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected errors to standard error middleware', async () => {
      const req = { user: { id: authenticatedUserId }, body: {} };
      const res = createResponse();
      const next = jest.fn();
      const databaseError = new Error('Database unavailable');
      sharedExpenseService.createSharedExpense.mockRejectedValue(databaseError);

      await sharedExpenseController.createSharedExpense(req, res, next);

      expect(next).toHaveBeenCalledWith(databaseError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('getNetBalances', () => {
    it('returns net balances scoped to the authenticated user', async () => {
      const req = { user: { id: authenticatedUserId } };
      const res = createResponse();
      const next = jest.fn();
      const netBalances = [{ userId: 'counterpart-1', netAmountCents: -2000 }];
      sharedExpenseService.getNetBalancesForUser.mockResolvedValue(netBalances);

      await sharedExpenseController.getNetBalances(req, res, next);

      expect(sharedExpenseService.getNetBalancesForUser).toHaveBeenCalledWith(
        authenticatedUserId
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: netBalances });
      expect(next).not.toHaveBeenCalled();
    });

    it('maps a not-found error to a safe 404 response', async () => {
      const req = { user: { id: authenticatedUserId } };
      const res = createResponse();
      const next = jest.fn();
      sharedExpenseService.getNetBalancesForUser.mockRejectedValue(
        new NotFoundError()
      );

      await sharedExpenseController.getNetBalances(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'NOT_FOUND', message: 'Resource not found.' },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 without calling the service when req.user is absent', async () => {
      const req = { user: undefined };
      const res = createResponse();
      const next = jest.fn();

      await sharedExpenseController.getNetBalances(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(sharedExpenseService.getNetBalancesForUser).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected errors to standard error middleware', async () => {
      const req = { user: { id: authenticatedUserId } };
      const res = createResponse();
      const next = jest.fn();
      const databaseError = new Error('Database unavailable');
      sharedExpenseService.getNetBalancesForUser.mockRejectedValue(databaseError);

      await sharedExpenseController.getNetBalances(req, res, next);

      expect(next).toHaveBeenCalledWith(databaseError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
