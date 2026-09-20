const express = require('express');
const transactionController = require('./transaction.controller');

const router = express.Router();

router.post('/', transactionController.createTransaction);
router.get('/', transactionController.getTransactionsByUser);
router.delete('/', transactionController.deleteAllTransactionsByUser);

module.exports = router;
