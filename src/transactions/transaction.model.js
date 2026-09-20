const mongoose = require('mongoose');
const { isSupportedCurrency } = require('../config/currencies');

const { Schema } = mongoose;

const transactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    amountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'amountCents must be an integer value in cents.',
      },
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: 'USD',
      validate: {
        validator: isSupportedCurrency,
        message: 'currency must be a valid ISO 4217 currency code.',
      },
    },
    idempotencyKey: {
      type: String,
      trim: true,
      immutable: true,
      minlength: 1,
      maxlength: 128,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

module.exports =
  mongoose.models.Transaction ||
  mongoose.model('Transaction', transactionSchema);