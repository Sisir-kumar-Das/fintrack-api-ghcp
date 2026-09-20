class TransactionError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code
   */
  constructor(message, statusCode, code) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

class ValidationError extends TransactionError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class UnauthorizedError extends TransactionError {
  /**
   * @param {string} message
   */
  constructor(message = 'Authentication is required.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class NotFoundError extends TransactionError {
  /**
   * @param {string} message
   */
  constructor(message = 'Resource not found.') {
    super(message, 404, 'NOT_FOUND');
  }
}

module.exports = {
  TransactionError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
};
