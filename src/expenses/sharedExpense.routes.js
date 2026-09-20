const express = require('express');
const sharedExpenseController = require('./sharedExpense.controller');

const router = express.Router();

router.post('/', sharedExpenseController.createSharedExpense);
router.get('/balances', sharedExpenseController.getNetBalances);

module.exports = router;
