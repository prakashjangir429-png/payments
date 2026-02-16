import express from "express";
import { celebrate } from "celebrate";
import Joi from 'joi';
import { generatePayment, checkPaymentStatus, payinCallback, payuCallback, payinfintechCallback } from "../controllers/payIn.controller.js";
import { verifyToken } from "../middleware/apiToken.js";

const createPayInSchema = {
    body: Joi.object({
        txnId: Joi.string().min(10).max(16).required(),
        amount: Joi.number().required(),
        email: Joi.string().email().required(),
        mobileNumber: Joi.string().pattern(/^[0-9]+$/).required(),
        name: Joi.string().required()
    }),
    headers: Joi.object({
        'authorization': Joi.string().required()
    }).unknown(true)
};
const router = express.Router();

router.post(
    "/create",
    celebrate(createPayInSchema), verifyToken,
    generatePayment
);

// {
//     "status": true,
//     "message": "Success",
//     "Status_code": 106,
//     "data": {
//         "name": "madan lal",
//         "email": "madantrading68@gmail.com",
//         "total": 100,
//         "url": "upi://pay?pa=kdas2024@nsdlpbma&pn=KDAS%20TECHNOLOGIES%20OPC%20PRIVATE%20LIMITED&mc=7372&tr=534210308251124013&tn=SchedulerTest&am=100&cu=INR&mode=05&orgid=181046&purpose=00&catagory=01&tid=NPT00000000000000534210308251124013&sign=MEUCIDWpvDxg+Sn055cC/JmvTiMhZTgugvYUhFhoaIGU6hTtAiEAl7UFuOUitQVJa5gF4ZmuB5Aadynm27gI8+hkqXbjPFA=",
//         "id": 11642,
//         "getwayType": "intent"
//     }
// }


let jai = {
    "status": true,
    "message": "your request has been initiated successfully",
    "data": {
        "txnId": "PFO1527831140336875", "amount": "10.00", "status": "INITIATE", "bankName": "State Bank of India", "accountNumber": "38447128670", "ifscCode": "SBIN0032299", "mode": "IMPS", "orderid": 12345678912345
    },
    "Status_code": 107
}


// {
//   "Amount": 10,
//   "AccountNumber": 38447128670,
//   "Bank": "State Bank of India",
//   "IFSC": "SBIN0032299",
//   "Mode": "IMPS",
//   "OrderId": 12345678912345,
//   "Mobile": 9876543210,
//   "BenificalName":"madan lal"
// }

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

router.get(
    "/balance",
    celebrate({
        headers: Joi.object({
            'authorization': Joi.string().required()
        }).unknown(true)
    }), verifyToken, ((req, res) => {
        res.json({
            status: 'Success',
            status_code: 200,
            message: "User balance fetched successfully",
            data: {
                userName: req.user.userName,
                mainWalletBalance: req.user.upiWalletBalance,
                eWalletBalance: req.user.eWalletBalance,
                clientId: req.user.clientId
            }
        })
    })
);


router.post(
    "/callback", payinCallback
);

router.post(
    "/payinfintech", payinfintechCallback
);

router.post(
    "/payu", payuCallback
);

export default router;
