import mongoose from "mongoose";
import userModel from "../models/user.model.js";
import payOutModel from "../models/payoutApis.model.js";
import axios from "axios";
import payOutModelGenerate from "../models/payoutRecord.model.js";
import MainWalletTransaction from "../models/mainWallet.model.js";
import { Mutex } from 'async-mutex';

// In-memory mutex store for single instance
const userLocks = new Map();

function getUserMutex(userId) {
    if (!userLocks.has(userId)) {
        userLocks.set(userId, new Mutex());
    }
    return userLocks.get(userId);
}

setInterval(() => {
    const now = Date.now();
    for (const [userId, mutex] of userLocks.entries()) {
        if (mutex._queue && mutex._queue.length === 0 && !mutex._locked) {
            userLocks.delete(userId);
        }
    }
}, 1000 * 60 * 5); // Clean every 5 minutes

export const generatePayOut = async (req, res, next) => {
    const userId = req.user._id.toString();
    const mutex = getUserMutex(userId);

    const release = await mutex.acquire();

    try {
        const {
            mobileNumber,
            accountHolderName,
            accountNumber,
            ifscCode,
            trxId,
            amount,
            bankName,
            purpose
        } = req.body;

        let user = req.user;

        // Validation checks
        if (!trxId || !amount || amount <= 10) {
            throw new Error("Invalid transaction details// Amount must be greater than 10");
        }

        if (!user?.payOutApi?.isActive) {
            return res.status(400).json({
                status: "Failed",
                status_code: 400,
                message: "Payment gateway is not active"
            });
        }

        if (user.payOutApi?.name == "ServerMaintenance") {
            return res.status(400).json({
                status: "Failed",
                status_code: 400,
                message: "server under maintenance !"
            });
        }
        const { payOutCharges } = user.package;

        switch (user?.payOutApi?.name) {
            case "payinfintech":
                let chargeAmount = payOutCharges.limit < amount ?
                    payOutCharges.higher.chargeType == 'percentage' ?
                        payOutCharges.higher.chargeValue * amount / 100 :
                        payOutCharges.higher.chargeValue :
                    payOutCharges.lowerOrEqual.chargeType == 'percentage' ?
                        payOutCharges.lowerOrEqual.chargeValue * amount / 100 :
                        payOutCharges.lowerOrEqual.chargeValue;

                const finalAmountToDeduct = amount + chargeAmount;

                const updatedUser = await userModel.findOneAndUpdate(
                    {
                        _id: user._id,
                        $expr: {
                            $gte: [
                                { $subtract: ["$upiWalletBalance", "$minWalletBalance"] },
                                finalAmountToDeduct
                            ]
                        }
                    },
                    {
                        $inc: { upiWalletBalance: -finalAmountToDeduct }
                    },
                    {
                        new: true,
                        runValidators: true
                    }
                );

                if (!updatedUser) {
                    const currentUser = await userModel.findById(user._id);
                    const usableBalance = currentUser.upiWalletBalance - currentUser.minWalletBalance;
                    throw new Error(`Insufficient balance. Available: ${usableBalance}, Required: ${finalAmountToDeduct}`);
                }

                // Create payment record
                const paymentRecord = await payOutModelGenerate.create({
                    user_id: user._id,
                    gateWayId: user.payOutApi?.name,
                    accountHolderName,
                    accountNumber,
                    ifscCode,
                    bankName,
                    trxId,
                    amount,
                    gatewayCharge: chargeAmount,
                    mobileNumber,
                    status: "Pending"
                });

                try {
                    let payload = {
                        "Amount": amount,
                        "AccountNumber": accountNumber,
                        "Bank": bankName,
                        "IFSC": ifscCode,
                        "Mode": "IMPS",
                        "OrderId": trxId,
                        "Mobile": mobileNumber,
                        "BenificalName": accountHolderName
                    }

                    let bank = {
                        "status": true,
                        "message": "your request has been initiated successfully",
                        "data": {
                            "txnId": "PFO1527831140336875", "amount": "10.00", "status": "INITIATE", "bankName": "State Bank of India", "accountNumber": "38447128670", "ifscCode": "SBIN0032299", "mode": "IMPS", "orderid": 12345678912345
                        },
                        "Status_code": 107
                    }
                    // await axios.post(user?.payOutApi?.baseUrl, payload, {
                    //     headers: { "Authorization": `Bearer ${user?.payOutApi?.apiKey}` }
                    // });

                    if (!bank?.data?.status) {
                        paymentRecord.status = "Pending";
                        paymentRecord.failureReason = bank?.data?.message || "Payment gateway error";
                        await paymentRecord.save();

                        return res.status(200).json({
                            status: "Pending",
                            status_code: 200,
                            amount,
                            accountNumber,
                            message: "your request has been initiated successfully",
                            transaction_id: trxId,
                        });

                    } else {
                        if (bank?.data?.status && bank.data?.Status_code == 107) {
                            await paymentRecord.save();
                            return res.status(200).json({
                                status: "Pending",
                                status_code: 200,
                                amount,
                                accountNumber,
                                message: "your request has been initiated successfully",
                                transaction_id: trxId,
                            });
                        }
                    }
                } catch (error) {

                    if (error.code == 11000) {
                        return res.status(500).json({
                            status: "Failed",
                            status_code: 500,
                            message: "trx Id duplicate Find !"
                        });
                    } else {
                        return res.status(500).json({
                            status: "Failed",
                            status_code: 500,
                            message: error.message || "Internal Server Error !"
                        });
                    }
                }
                break;

            case "ServerMaintenance":

                return res.status(400).json({
                    status: "Failed",
                    status_code: 400,
                    message: "server under maintenance !"
                });

            default:

                return res.status(400).json({
                    status: "Failed",
                    status_code: 400,
                    message: "service is not active please contact to service provider"
                });
        }
    } catch (error) {
        next(error);
    } finally {
        release();
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
                    trxId: txnId
                }
            },
            {
                $project: {
                    _id: 0,
                    status: 1,
                    amount: 1,
                    gatewayCharge: 1,
                    netAmount: { $subtract: ["$amount", "$gatewayCharge"] },
                    trxId: 1,
                    accountNumber: 1,
                    accountHolderName:1,
                    ifscCode:1,
                    utr: 1
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