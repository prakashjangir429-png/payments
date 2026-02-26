import express from "express";
import { celebrate } from "celebrate";
import Joi from 'joi';
import { checkPaymentStatus, generatePayOut, updatePayoutStatus } from "../controllers/payout.controller.js";
import { verifyToken } from "../middleware/apiToken.js";
import { protect, restrictTo } from "../middleware/auth.js";

// email: Joi.string().email(),

const createOutSchema = {
    body: Joi.object({
        trxId: Joi.number()
            .integer()
            .min(100000000000000)
            .max(999999999999999999)
            .required(),
        amount: Joi.number().required().min(10).max(5000),
        mobileNumber: Joi.string().pattern(/^[0-9]+$/).required(),
        bankName: Joi.string().required(),
        accountHolderName: Joi.string().required(),
        accountNumber: Joi.string().required(),
        ifscCode: Joi.string().required(),
        purpose: Joi.string().optional()
    }),
    headers: Joi.object({
        'authorization': Joi.string().required()
    }).unknown(true)
};
const router = express.Router();

router.post(
    "/initiate",
    celebrate(createOutSchema), verifyToken,
    generatePayOut
);


router.get(
    "/status/:txnId",
    celebrate({
        params: Joi.object({
            txnId: Joi.string().required()
        }),
        headers: Joi.object({
            'authorization': Joi.string().required()
        }).unknown(true)
    }), verifyToken, checkPaymentStatus
);

router.put(
    "/update_status/:trxId", updatePayoutStatus
);

export default router;
