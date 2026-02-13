import PayinGenerationRecord from "../models/payinRequests.model.js";
import axios from "axios";
import User from "../models/user.model.js";
import payinModel from "../models/payin.model.js";
import { Mutex } from 'async-mutex';
import EwalletTransaction from "../models/ewallet.model.js";
import userMetaModel from "../models/userMeta.model.js";
import mongoose from "mongoose";
import crypto from "crypto";
import qs from 'qs';

const PAYU_KEY = 'yCoqIU';
const PAYU_SALT = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzUfM25c2bd55Lh010CPoG47YNBlvGeqxVnUNLiPJDx3k+0xwmtfsXv478ec+eR4AytqvaSEQvEIfeXb0mIT2ENY+ijdjjmWrr6L1XMhjPNQiYDRrm5btf5wNOsd+EOfHQyjZLNq9fmM3eDqDymsq8HWaKspmEeFckHLQr/sjocgpQ0RtS60kYTPwMioLNaZeoRiVvVpuFWLv7ih+Gvkny4/sVdYluXkjdk0QsU7fiHucf9pOlc4uDGK+SEFNBudwuUE6afWHjKEeB5/kz0dTddqT25IpVX1G3jr3WLjYFaFT/8KHygCZvl1DILtxlujsch+eNDAO5TlnI0q1p3uEVAgMBAAECggEAR2pRTyFJd+u1RsY9ggNbNCg3JkvMfCj5/mTR2sDRH05PisY/9WjPdd9L/mAy4AoA0/GtUpMqWIYgXl59yLQ/UCqWqDoO0WIV05tO4O2qNMedwxShDKkcrS6PQiWT65C6LhmCcwT15kAwaQnxbn1YVX/uCTnk6v2UUuT9mnHvqKarlC/Iv5uiRcRRl1i9+tHt692MenQ86d+P/rOaG7uCDIEgJrcQqxPtJeBXbNCumZgFQwvFndq57Xo9N9wS6Qulo3Z5/SWlF1RQrIoutYs5DOlspp8bHy8zORA7/7o5ivdrRPx3x3U+yM0i+1xB+CfwocnpsScTe2YJAonB5rjXhwKBgQDPKho4KIt7+780x1I0aq9oIllp6jRx6P4Vg2x5/bU61BpJ+xGBz8Tle4CXSGiwL4Tf///OLCdWBrrK5wl/bDF9SvpZ/TVG5UeT0S3p3uUxVZkQcveXi5R8mCHUXuRzSQAQUCQvpHVgXL1b+Y7ap3xcdBHxYZN3r3twQjkvgP9xPwKBgQDdl4FwIC9C61cPQuHfbeeYbeAOj75sgHq0dAKWaaDVfKao/4Ya0BczgtFfwHmWuoGEuUBwgjmIAWTxhVNpmFBiJzFlUdXaD7hIOQ2OFNfH2Cu3hT9GwPY0mTb8U90MY5qWURVAHyiQWntUGB7oUi4mM7e+49Gtl7Wwf/x3pvbEqwKBgCsVuIpBdHD+tI+HfMNGBOEFc88hVHL0YBOdV6wvZcesYSNNwiBbU7nea6oK9yrdVyc3GL6KVEwB7ktQrZsAp3JFa7fXf4MVIEPP11qybrxJ7yGKp4+vCdy3zyFZ8u0/G3JJGJ2H+Jln8EH2rw0ulCCuSyUGhCL6LhP00evdSkMFAoGBAIDcHPJ2VOWGc881JqLGh9pVcukk4Ci6oiCUIfkUHepoHYbDaVnoTsWuulEDXfGwLadgD0AeCpSzst7cmIAcigo6Hnh8GW9Amvqs6twH9N+LLwj+3KgpiENYIeikYDRXK8tkBYaPWAhyBawGhtq1B49BngXM998KDSdBljCCkJgXAoGAcoUmi95+7WSP2acvsu5GcxTGJrW9hvNykZZMrqUI2HVDzfZKzNxGtNomweTBRZU+YPkx/NUVmjYNEPYJZLY16SoKX+6QBKRl+qmuPOBoEa0JP3bODrL+nLw20zpTyCOdIvyM7u+mkFczIfKVsvyAHbPRNCRGMjfuiTj75rEooGU=";

function sha512(data) {
    return crypto.createHash("sha512").update(data, "utf8").digest("hex");
}

function makeInitiateHash({ key, txnid, amount, productinfo, firstname, email, salt }) {
    const hashStr = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}` +
        `|||||||||||${salt}`;
    return sha512(hashStr);
}

function getDeviceInfo(req) {
    const ip =
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "";
    const ua = req.headers["user-agent"] || "";
    return { s2s_client_ip: ip, s2s_device_info: ua };
}

function generateUpiIntent(paramsString) {
    const params = new URLSearchParams(paramsString);
    if (params.has("pn")) {
        params.set("pn", encodeURIComponent(params.get("pn")));
    }
    if (params.has("tn")) {
        params.set("tn", encodeURIComponent(params.get("tn")));
    }
    return `upi://pay?${params.toString()}`;
}

export const generatePayment = async (req, res, next) => {
    try {
        const { txnId, amount, name, email, mobileNumber } = req.body;
        const user = req.user;

        if (amount < 100) {
            return res.status(400).json({
                status: "Failed",
                status_code: 400,
                message: "Amount should be more than 100"
            });
        }

        if (!user?.payInApi?.isActive) {
            return res.status(400).json({
                status: "Failed",
                status_code: 400,
                message: "Payment gateway is not active"
            });
        }

        const { payInCharges } = user.package;

        if (user.payInApi?.name == "ServerMaintenance") {
            let serverResp = {
                status: "Failed",
                status_code: 400,
                message: "server under maintenance !"
            }
            return res.status(400).json(serverResp)
        }

        let paymentRecord = await PayinGenerationRecord.create({
            user_id: user._id,
            gateWayId: user.payInApi?.name,
            txnId,
            amount,
            chargeAmount: payInCharges.limit < amount ? payInCharges.higher.chargeType == 'percentage' ? payInCharges.higher.chargeValue * amount / 100 : payInCharges.higher.chargeValue : payInCharges.lowerOrEqual.chargeType == 'percentage' ? payInCharges.lowerOrEqual.chargeValue * amount / 100 : payInCharges.lowerOrEqual.chargeValue,
            name,
            email,
            mobileNumber
        });

        switch (user?.payInApi?.name) {
            case "TestPay":
                try {
                    let bank = await axios.post(user?.payInApi?.baseUrl, { txnId, amount, name, email, mobileNumber })

                    if (bank?.data?.status_code != 200) {
                        paymentRecord.status = "Failed";
                        paymentRecord.failureReason = bank?.data?.status_msg || "Payment gateway error";
                        await paymentRecord.save();
                        return res.status(400).json({ status: "Failed", status_code: 400, message: 'Banking Server Down' })
                    } else {
                        paymentRecord.qrData = bank?.data?.qr_image;
                        paymentRecord.qrIntent = bank?.data?.Intent;
                        paymentRecord.refId = bank?.data?.refId;
                        await paymentRecord.save();
                        return res.status(200).json({
                            status: "Success",
                            status_code: 200,
                            message: "intent generate successfully",
                            qr_intent: bank?.data?.Intent,
                            qr_image: bank?.data?.qr_image,
                            transaction_id: txnId
                        })
                    }
                } catch (error) {
                    if (error.code == 11000) {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: "trx Id duplicate Find !" })
                    } else {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: error.message || "Internel Server Error !" })
                    }
                }
                break;
            case "Payin001":
                try {

                    const hash = makeInitiateHash({
                        key: PAYU_KEY,
                        txnid: txnId,
                        amount: Number(amount).toFixed(2),
                        productinfo: "storefront",
                        firstname: name,
                        email,
                        salt: PAYU_SALT
                    });

                    const { s2s_client_ip, s2s_device_info } = getDeviceInfo(req);

                    const payload = {
                        key: PAYU_KEY,
                        txnid: txnId,
                        amount: Number(amount).toFixed(2),
                        productinfo: "storefront",
                        firstname: name,
                        email,
                        phone: mobileNumber,
                        pg: "UPI",
                        bankcode: "INTENT",
                        txn_s2s_flow: 4,
                        s2s_client_ip,
                        s2s_device_info,
                        upiAppName: 'genericintent',
                        hash,
                        surl: `https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu`,
                        furl: `https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu`,
                        curl: `https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu`,
                    };

                    const bank = await axios.post(`https://test.payu.in/_payment`, qs.stringify(payload), {
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        timeout: 60000
                    });

                    if (bank.status != 200) {
                        paymentRecord.status = "Failed";
                        paymentRecord.failureReason = bank?.data?.metaData?.message || "Payment gateway error";
                        await paymentRecord.save();
                        return res.status(400).json({ status: "Failed", status_code: 400, message: 'Banking Server Down' })
                    } else {
                        const intent = bank?.data?.result?.intentURIData
                        const formatIntent = generateUpiIntent(intent)
                        paymentRecord.qrData = null;
                        paymentRecord.qrIntent = formatIntent;
                        paymentRecord.refId = bank?.data?.result?.paymentId;
                        await paymentRecord.save();
                        return res.status(200).json({
                            status: "Success",
                            status_code: 200,
                            message: "intent generate successfully",
                            qr_intent: formatIntent,
                            qr_image: "",
                            transaction_id: txnId
                        })
                    }
                } catch (error) {
                    if (error.code == 11000) {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: "trx Id duplicate Find !" })
                    } else {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: error.message || "Internel Server Error !" })
                    }
                }
                break;
            case "payinfintech":
                try {
                    const payload = {
                        "amount": amount,
                        "email": email,
                        "name": name,
                        "mobile": mobileNumber,
                        "orderId": txnId
                    }

                    const bank = await axios.post(user?.payInApi?.baseUrl, payload, {
                        headers: { "Authorization": `Bearer ${user?.payInApi?.apiKey}` }
                    });

                    if (bank.status != 200) {
                        paymentRecord.status = "Failed";
                        paymentRecord.failureReason = bank?.data?.message || "Payment gateway error";
                        await paymentRecord.save();
                        return res.status(400).json({ status: "Failed", status_code: 400, message: 'Banking Server Down' })
                    } else {
                        if (bank.data?.status && (bank.data?.Status_code == 106)) {
                            const intent = bank?.data?.data?.url
                            paymentRecord.qrData = null;
                            paymentRecord.qrIntent = intent;
                            paymentRecord.refId = bank?.data?.data?.id;
                            await paymentRecord.save();
                            return res.status(200).json({
                                status: "Success",
                                status_code: 200,
                                message: "intent generate successfully",
                                qr_intent: intent,
                                qr_image: "",
                                transaction_id: txnId
                            })
                        } else {
                            paymentRecord.status = "Failed";
                            paymentRecord.failureReason = bank?.data?.message || "Payment gateway error";
                            await paymentRecord.save();
                            return res.status(400).json({ status: "Failed", status_code: 400, message: bank?.data?.message || 'Banking Server Down' })
                        }
                    }
                } catch (error) {
                    if (error.code == 11000) {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: "trx Id duplicate Find !" })
                    } else {
                        return res.status(500).json({ status: "Failed", status_code: 500, message: error.message || "Internel Server Error !" })
                    }
                }
                break;
            case "ServerMaintenance":
                let serverResp = {
                    status: "Failed",
                    status_code: 400,
                    message: "server under maintenance !"
                }
                return res.status(400).json(serverResp)
            default:
                return res.status(400).json({
                    status: "Failed",
                    status_code: 400,
                    message: "service is not active please contact to service provider"
                });
        }
    } catch (error) {
        console.log(error.message)
        return next(error);
    }
};

export const checkPaymentStatus = async (req, res, next) => {
    try {
        const { txnId } = req.params;

        if (!txnId) {
            return res.status(400).json({
                status: 'Failed',
                status_code: 400,
                message: "Transaction ID are required"
            });
        }

        const result = await PayinGenerationRecord.aggregate([
            {
                $match: {
                    txnId: txnId
                }
            },
            {
                $project: {
                    _id: 0,
                    status: 1,
                    amount: 1,
                    chargeAmount: 1,
                    totalAmount: { $add: ["$amount", "$chargeAmount"] },
                    txnId: 1,
                    utr: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    userDetails: {
                        name: "$name",
                        email: "$email",
                        mobile: "$mobileNumber"
                    }
                }
            },
            {
                $limit: 1
            }
        ]);
        if (result.length === 0) {
            return res.status(404).json({
                status: 'Failed',
                status_code: 404,
                message: "Transaction not found"
            });
        }
        const response = {
            status: 'Success',
            status_code: 200,
            message: "Transaction Detail fetch successfully",
            data: result[0]
        };
        return res.status(200).json(response);

    } catch (error) {
        return next(error)
    }
};


const userLocks = new Map();

function getUserMutex(userId) {
    if (!userLocks.has(userId)) {
        userLocks.set(userId, new Mutex());
    }
    return userLocks.get(userId);
}

export const payinCallback = async (req, res, next) => {
    try {
        const { txnId, utr, status, refId, message } = req.body;

        const paymentRecord = await PayinGenerationRecord.findOneAndUpdate(
            { txnId, status: 'Pending' },
            {
                $set: {
                    status: status === 'success' ? 'Success' : 'Failed',
                    ...(status === 'success' && { utr, refId }),
                    ...(status === 'failed' && { failureReason: message || 'Payment failed' }),
                },
            },
            { new: true }
        );

        if (!paymentRecord) {
            return res.status(404).json({
                status: 'Failed',
                status_code: 404,
                message: 'Transaction not found or already processed',
            });
        }

        const userId = paymentRecord.user_id.toString();
        const userMutex = getUserMutex(userId);

        await userMutex.runExclusive(async () => {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const netAmount = paymentRecord.amount - paymentRecord.chargeAmount;

                    let userMeta = await userMetaModel.findOne({ userId: paymentRecord.user_id }).session(session);


                    if (status === 'success') {
                        const user = await User.findOneAndUpdate(
                            { _id: paymentRecord.user_id },
                            { $inc: { eWalletBalance: netAmount } },
                            { new: true, session }
                        );

                        const payinSuccess = {
                            user_id: paymentRecord.user_id,
                            txnId: paymentRecord.txnId,
                            utr: paymentRecord.utr,
                            referenceID: paymentRecord.refId,
                            amount: paymentRecord.amount,
                            chargeAmount: paymentRecord.chargeAmount,
                            vpaId: 'abc@upi',
                            payerName: paymentRecord.name,
                            status: 'Success',
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                        };

                        const walletTransaction = {
                            userId: paymentRecord.user_id,
                            amount: paymentRecord.amount,
                            beforeAmount: user.eWalletBalance - netAmount,
                            charges: paymentRecord.chargeAmount,
                            type: 'credit',
                            afterAmount: user.eWalletBalance,
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                            status: 'success',
                        };

                        await Promise.all([
                            payinModel.create([payinSuccess], { session }),
                            EwalletTransaction.create([walletTransaction], { session })
                        ]);

                        axios.post("http://localhost:3000/user-callback", {
                            event: 'payin_success',
                            txnId: paymentRecord.txnId,
                            status: 'Success',
                            status_code: 200,
                            amount: paymentRecord.amount,
                            gatwayCharge: paymentRecord.chargeAmount,
                            utr: paymentRecord.utr,
                            vpaId: 'abc@upi',
                            txnCompleteDate: new Date(),
                            txnStartDate: paymentRecord.createdAt,
                            message: 'Payment Received successfully',
                        });

                    } else if (status === 'failed') {
                        axios.post("http://localhost:3000/user-callback", {
                            event: 'payin_failed',
                            txnId: paymentRecord.txnId,
                            status: 'Failed',
                            status_code: 200,
                            amount: paymentRecord.amount,
                            utr: null,
                            vpaId: null,
                            txnStartDate: paymentRecord.createdAt,
                            message: 'Payment failed',
                        });
                        console.log("Payment failed for txnId:", txnId);
                    }
                })
            } finally {
                session.endSession();
            }
        });

        return res.status(200).json({
            status: 'Success',
            status_code: 200,
            message: 'Payment status updated successfully',
        });
    } catch (error) {
        return next(error);
    }
};

export const payinfintechCallback = async (req, res, next) => {
    try {
        const { orderId: txnId, utr, status, paymentMethod: message } = req.body;


        const paymentRecord = await PayinGenerationRecord.findOneAndUpdate(
            { txnId, status: 'Pending' },
            {
                $set: {
                    status: status === 'success' ? 'Success' : 'Failed',
                    ...(status === 'success' && { utr }),
                    ...(status === 'failed' && { failureReason: message || 'Payment failed' }),
                },
            },
            { new: true }
        );

        if (!paymentRecord) {
            return res.status(200).json({
                status: 'Failed',
                status_code: 404,
                message: 'Transaction not found or already processed',
            });
        }

        const userId = paymentRecord.user_id.toString();
        const userMutex = getUserMutex(userId);

        await userMutex.runExclusive(async () => {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const netAmount = paymentRecord.amount - paymentRecord.chargeAmount;

                    let userMeta = await userMetaModel.findOne({ userId: paymentRecord.user_id }).session(session);


                    if (status == 'success') {
                        const user = await User.findOneAndUpdate(
                            { _id: paymentRecord.user_id },
                            { $inc: { eWalletBalance: netAmount } },
                            { new: true, session }
                        );

                        const payinSuccess = {
                            user_id: paymentRecord.user_id,
                            txnId: paymentRecord.txnId,
                            utr: paymentRecord.utr,
                            referenceID: paymentRecord?.refId || '',
                            amount: paymentRecord.amount,
                            chargeAmount: paymentRecord.chargeAmount,
                            vpaId: 'abc@upi',
                            payerName: paymentRecord.name,
                            status: 'Success',
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                        };

                        const walletTransaction = {
                            userId: paymentRecord.user_id,
                            amount: paymentRecord.amount,
                            beforeAmount: user.eWalletBalance - netAmount,
                            charges: paymentRecord.chargeAmount,
                            type: 'credit',
                            afterAmount: user.eWalletBalance,
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                            status: 'success',
                        };

                        await Promise.all([
                            payinModel.create([payinSuccess], { session }),
                            EwalletTransaction.create([walletTransaction], { session })
                        ]);

                        if (userMeta?.payInCallbackUrl) {
                            axios.post(userMeta.payInCallbackUrl, {
                                event: 'payin_success',
                                txnId: paymentRecord.txnId,
                                status: 'Success',
                                status_code: 200,
                                amount: paymentRecord.amount,
                                gatwayCharge: paymentRecord.chargeAmount,
                                utr: paymentRecord.utr,
                                vpaId: 'abc@upi',
                                txnCompleteDate: new Date(),
                                txnStartDate: paymentRecord.createdAt,
                                message: 'Payment Received successfully',
                            })
                        };

                    } else if (status != 'success') {
                        if (userMeta?.payInCallbackUrl) {
                            axios.post(userMeta.payInCallbackUrl, {
                                event: 'payin_failed',
                                txnId: paymentRecord.txnId,
                                status: 'Failed',
                                status_code: 200,
                                amount: paymentRecord.amount,
                                utr: null,
                                vpaId: null,
                                txnStartDate: paymentRecord.createdAt,
                                message: 'Payment failed',
                            })
                        };
                    }
                })
            } finally {
                session.endSession();
            }
        });

        return res.status(200).json({
            status: 'Success',
            status_code: 200,
            message: 'Payment status updated successfully',
        });
    } catch (error) {
        return next(error);
    }
};

function verifyResponseHash(payload) {
    const {
        status = "",
        email = "",
        firstname = "",
        productinfo = "",
        amount = "",
        txnid = "",
        hash: incomingHash = ""
    } = payload;

    const str = `${PAYU_SALT}|${status}` + `|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${PAYU_KEY}`;
    const calc = sha512(str);
    return { ok: calc === incomingHash };
}

export const payuCallback = async (req, res, next) => {
    try {

        const { ok } = verifyResponseHash(req.body);

        if (!ok) {
            return res.status(400).json({
                status: 'Failed',
                status_code: 400,
                message: 'Invalid hash',
            });
        }
        const { txnid: txnId, bank_ref_num: utr, status, mihpayid: refId, error_Message: message, field3: vpaId } = req.body;
        //         {
        //   mihpayid: '24752418023',
        //   mode: 'UPI',
        //   status: 'success',
        //   key: 'HFFrlt',
        //   txnid: 'TX54564555557',
        //   amount: '1.00',
        //   addedon: '2025-08-17 14:14:57',
        //   productinfo: 'storefront',
        //   firstname: 'John Doe',
        //   lastname: '',
        //   address1: '',
        //   address2: '',
        //   city: '',
        //   state: '',
        //   country: '',
        //   zipcode: '',
        //   email: 'john@example.com',
        //   phone: '9876543210',
        //   udf1: '',
        //   udf2: '',
        //   udf3: '',
        //   udf4: '',
        //   udf5: '',
        //   udf6: '',
        //   udf7: '',
        //   udf8: '',
        //   udf9: '',
        //   udf10: '',
        //   card_token: '',
        //   card_no: '',
        //   field0: '',
        //   field1: 'success@upi',
        //   field2: '399722',
        //   field3: '8302845976@ybl',
        //   field4: '',
        //   field5: 'PPPL2475241802317082514145768a19689',
        //   field6: 'RAMESH KUMAR JANGID || UBIN0933147',
        //   field7: 'APPROVED OR COMPLETED SUCCESSFULLY|00',
        //   field8: 'genericintent',
        //   field9: 'Success|Completed Using Callback',
        //   payment_source: 'payuPureS2S',
        //   PG_TYPE: 'UPI-PG',
        //   error: 'E000',
        //   error_Message: 'No Error',
        //   net_amount_debit: '1',
        //   discount: '0.00',
        //   offer_key: '',
        //   offer_availed: '',
        //   unmappedstatus: 'captured',
        //   hash: 'dac51d232596971a196220cc8af8207cc43b67142921a3568d066cac97a0c73a426866689730fb624e7a3c169d13df4c03d2040ae4fa7fc0039b8849b37b52a0',
        //   bank_ref_no: '321823078407',
        //   bank_ref_num: '321823078407',
        //   bankcode: 'INTENT',
        //   surl: 'https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu',
        //   curl: 'https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu',
        //   furl: 'https://qv928bd1-3000.inc1.devtunnels.ms/api/v1/payment/payu',
        //   meCode: '{"pgMerchantId":"INDB000010179136","merchantVpa":"SPIRALSTYLEFASHIONPRIV-13227647.payu@indus"}'
        // }

        // const { txnId, utr, status, refId, message } = req.body;
        // {
        //   mihpayid: '403993715534567478',
        //   mode: 'UPI',
        //   status: 'success',
        //   unmappedstatus: 'captured',
        //   key: 'yCoqIU',
        //   txnid: 'TX45647025557',
        //   amount: '1.00',
        //   discount: '0.00',
        //   net_amount_debit: '1',
        //   addedon: '2025-08-17 13:19:13',
        //   productinfo: 'storefront',
        //   firstname: 'John Doe',
        //   lastname: '',
        //   address1: '',
        //   address2: '',
        //   city: '',
        //   state: '',
        //   country: '',
        //   zipcode: '',
        //   email: 'john@example.com',
        //   phone: '9876543210',
        //   udf1: '',
        //   udf2: '',
        //   udf3: '',
        //   udf4: '',
        //   udf5: '',
        //   udf6: '',
        //   udf7: '',
        //   udf8: '',
        //   udf9: '',
        //   udf10: '',
        //   hash: '761659975d1aeff43a39fcbf65553a72dc80ea4ce057bc429600f43ac29a53440890389b99ed74d961d6986033a49e2bc0f59b46ea8e3e9fa5cef59d1fff1dc1',
        //   field1: 'success@upi',
        //   field2: 'TX45647025557',
        //   field3: '',
        //   field4: 'John Doe',
        //   field5: 'AXIBHsy65IIqkDAdfBaRKEkoxREdnsEV7Cq',
        //   field5: 'AXIBHsy65IIqkDAdfBaRKEkoxREdnsEV7Cq',
        //   field6: '',
        //   field7: 'Transaction completed successfully',
        //   field8: 'new',
        //   field9: 'Transaction completed successfully',
        //   payment_source: 'payuPureS2S',
        //   pa_name: 'PayU',
        //   PG_TYPE: 'UPI-PG',
        //   bank_ref_num: 'TX45647025557',
        //   bankcode: 'UPI',
        //   error: 'E000',
        //   error_Message: 'No Error'
        // }


        //         {
        //   mihpayid: '403993715534567544', 
        //   mode: 'UPI',
        //   status: 'failure',
        //   unmappedstatus: 'userCancelled',
        //   key: 'yCoqIU',
        //   txnid: 'TX456425555557',        
        //   amount: '1.00',
        //   discount: '0.00',
        //   net_amount_debit: '0.00',       
        //   addedon: '2025-08-17 13:50:18', 
        //   productinfo: 'storefront',      
        //   firstname: 'John Doe',
        //   lastname: '',
        //   address1: '',
        //   address2: '',
        //   city: '',
        //   state: '',
        //   country: '',
        //   zipcode: '',
        //   email: 'john@example.com',      
        //   phone: '9876543210',
        //   udf1: '',
        //   udf2: '',
        //   udf3: '',
        //   udf4: '',
        //   udf5: '',
        //   udf6: '',
        //   udf7: '',
        //   udf8: '',
        //   udf9: '',
        //   udf10: '',
        //   hash: '62ee08abf72b3bb73e0d11b92b2e678b72c6647bedcdad9fbfe49d5d50b35fba2121c097160d30e96f7fe73e1323d1e3d04812dd407819f31d14ea6096f1b0dd',
        //   field1: 'success@upi',
        //   field2: '0',
        //   field3: '',
        //   field4: 'John Doe',
        //   field5: 'AXI8FgcBpAiMls8qtPhBEExdlU80fOf227B',
        //   field6: '',
        //   field7: 'Transaction Failed at bank end',
        //   field8: 'new',
        //   field9: 'Transaction Failed at bank end',
        //   payment_source: 'payuPureS2S',
        //   pa_name: 'PayU',
        //   PG_TYPE: 'UPI-PG',
        //   bank_ref_num: '',
        //   bankcode: 'UPI',
        //   error: 'E000',
        //   error_Message: 'Bank was unable to authenticate.'
        // }
        const paymentRecord = await PayinGenerationRecord.findOneAndUpdate(
            { txnId, status: 'Pending' },
            {
                $set: {
                    status: status === 'success' ? 'Success' : 'Failed',
                    ...(status === 'success' && { utr }),
                    ...(status === 'failed' && { failureReason: message || 'Payment failed' }),
                },
            },
            { new: true }
        );

        if (!paymentRecord) {
            return res.status(200).json({
                status: 'Failed',
                status_code: 404,
                message: 'Transaction not found or already processed',
            });
        }

        const userId = paymentRecord.user_id.toString();
        const userMutex = getUserMutex(userId);

        await userMutex.runExclusive(async () => {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const netAmount = paymentRecord.amount - paymentRecord.chargeAmount;

                    let userMeta = await userMetaModel.findOne({ userId: paymentRecord.user_id }).session(session);

                    if (status === 'success') {
                        const user = await User.findOneAndUpdate(
                            { _id: paymentRecord.user_id },
                            { $inc: { eWalletBalance: netAmount } },
                            { new: true, session }
                        );

                        const payinSuccess = {
                            user_id: paymentRecord.user_id,
                            txnId: paymentRecord.txnId,
                            utr: paymentRecord.utr,
                            referenceID: paymentRecord.refId,
                            amount: paymentRecord.amount,
                            chargeAmount: paymentRecord.chargeAmount,
                            vpaId: vpaId,
                            payerName: paymentRecord.name,
                            status: 'Success',
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                        };

                        const walletTransaction = {
                            userId: paymentRecord.user_id,
                            amount: paymentRecord.amount,
                            beforeAmount: user.eWalletBalance - netAmount,
                            charges: paymentRecord.chargeAmount,
                            type: 'credit',
                            afterAmount: user.eWalletBalance,
                            description: `PayIn successful for txnId ${paymentRecord.txnId}`,
                            status: 'success',
                        };

                        const [a1, a2] = await Promise.all([
                            payinModel.create([payinSuccess], { session }),
                            EwalletTransaction.create([walletTransaction], { session })
                        ]);

                        if (userMeta?.payInCallbackUrl) {
                            axios.post(userMeta.payInCallbackUrl, {
                                event: 'payin_success',
                                txnId: paymentRecord.txnId,
                                status: 'Success',
                                status_code: 200,
                                amount: paymentRecord.amount,
                                gatwayCharge: paymentRecord.chargeAmount,
                                utr: paymentRecord.utr,
                                vpaId: 'abc@upi',
                                txnCompleteDate: new Date(),
                                txnStartDate: paymentRecord.createdAt,
                                message: 'Payment Received successfully',
                            })
                        };

                    } else if (status === 'failed') {
                        if (userMeta?.payInCallbackUrl) {
                            axios.post(userMeta.payInCallbackUrl, {
                                event: 'payin_failed',
                                txnId: paymentRecord.txnId,
                                status: 'Failed',
                                status_code: 200,
                                amount: paymentRecord.amount,
                                utr: null,
                                vpaId: null,
                                txnStartDate: paymentRecord.createdAt,
                                message: 'Payment failed',
                            })
                        };
                        console.log("Payment failed for txnId:", txnId);
                    }
                })
            } finally {
                session.endSession();
            }
        });

        return res.status(200).json({
            status: 'Success',
            status_code: 200,
            message: 'Payment status updated successfully',
        });
    } catch (error) {
        return next(error);
    }
};
