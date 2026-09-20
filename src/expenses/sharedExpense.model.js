const mongoose = require('mongoose');
const { isSupportedCurrency } = require('../config/currencies');

const { Schema } = mongoose;

/**
 * Supported ways a shared expense's total can be divided among participants.
 * - `equal`: the total is divided as evenly as possible across participants.
 * - `custom`: each participant supplies their own share, which must sum
 *   exactly to `totalAmountCents`.
 */
const SPLIT_TYPES = ['equal', 'custom'];

/**
 * @typedef {Object} Participant
 * @property {import('mongoose').Types.ObjectId} userId - The participating user.
 * @property {number} shareCents - This participant's share of the total, as an integer in cents.
 * @property {boolean} settled - Whether this participant has repaid their share.
 */

/**
 * @typedef {Object} SharedExpenseAttrs
 * @property {import('mongoose').Types.ObjectId} creatorId - The user who created and paid for the expense.
 * @property {string} description - A short, human-readable description of the expense.
 * @property {number} totalAmountCents - The total expense amount, as an integer in cents.
 * @property {string} currency - The ISO 4217 currency code for the expense.
 * @property {'equal'|'custom'} splitType - How the total is divided among participants.
 * @property {Participant[]} participants - The participants and their resolved shares.
 * @property {Date|null} deletedAt - Soft-delete marker; `null` while the expense is active.
 */

const participantSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shareCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'shareCents must be an integer value in cents.',
      },
    },
    settled: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

const sharedExpenseSchema = new Schema(
  {
    creatorId: {
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
    totalAmountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'totalAmountCents must be an integer value in cents.',
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
    splitType: {
      type: String,
      required: true,
      enum: SPLIT_TYPES,
    },
    participants: {
      type: [participantSchema],
      required: true,
      validate: [
        {
          validator: (participants) =>
            Array.isArray(participants) && participants.length >= 2,
          message: 'A shared expense requires at least two participants.',
        },
        {
          validator: (participants) => {
            const userIds = participants.map((participant) =>
              participant.userId.toString()
            );
            return new Set(userIds).size === userIds.length;
          },
          message: 'participants must not contain duplicate userId values.',
        },
      ],
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

// Cross-field validation: participant shares must sum exactly to the total.
// This is enforced here (in addition to the service layer) so the invariant
// holds even for writes that bypass the service, e.g. scripts or migrations.
// `this.invalidate(...)` is used instead of throwing a plain Error so this
// failure surfaces as a standard Mongoose ValidationError, consistent with
// the other schema-level validators below.
// Mongoose 9 uses promise-based middleware only (no `next` callback).
sharedExpenseSchema.pre('validate', async function validateShareSum() {
  if (!Array.isArray(this.participants) || this.participants.length === 0) {
    return;
  }

  const shareSumCents = this.participants.reduce(
    (sum, participant) => sum + participant.shareCents,
    0
  );

  if (shareSumCents !== this.totalAmountCents) {
    this.invalidate(
      'participants',
      `participants shareCents must sum exactly to totalAmountCents (expected ${this.totalAmountCents}, received ${shareSumCents}).`
    );
  }
});

sharedExpenseSchema.index({ creatorId: 1, createdAt: -1 });
sharedExpenseSchema.index({ 'participants.userId': 1, createdAt: -1 });

module.exports = {
  SPLIT_TYPES,
  SharedExpense:
    mongoose.models.SharedExpense ||
    mongoose.model('SharedExpense', sharedExpenseSchema),
};
