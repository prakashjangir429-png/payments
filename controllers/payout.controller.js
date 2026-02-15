import mongoose from "mongoose";
import userModel from "../models/user.model.js";
import payOutModel from "../models/payout.model.js";
import axios from "axios";
import payOutModelGenerate from "../models/payoutRecord.model.js";
import { Mutex } from 'async-mutex';
import payoutApisModel from "../models/payoutApis.model.js";
import userMetaModel from "../models/userMeta.model.js";
import MainWalletTransaction from "../models/mainWallet.model.js";

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

                    // let bank = {
                    //     data: {
                    //         "status": true,
                    //         "message": "your request has been initiated successfully",
                    //         "data": {
                    //             "txnId": "PFO1527831140336875", "amount": "10.00", "status": "INITIATE", "bankName": "State Bank of India", "accountNumber": "38447128670", "ifscCode": "SBIN0032299", "mode": "IMPS", "orderid": 12345678912345
                    //         },
                    //         "Status_code": 107
                    //     }
                    // }
                    let bank = await axios.post(user?.payOutApi?.baseUrl, payload, {
                        headers: { "Authorization": `Bearer ${user?.payOutApi?.apiKey}` }
                    });

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
                        paymentRecord.status = "Pending";
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
                    accountHolderName: 1,
                    ifscCode: 1,
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

export const updatePayoutStatus = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { trxId } = req.params;

        // Validate required fields
        if (!trxId) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "trxId is required" });
        }

        const isPending = await payOutModelGenerate.findOne({ trxId, status: "Pending" }).session(session);

        if (!isPending) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "Failed", data: "Payout already updated" });
        }

        const payoutApi = await payoutApisModel.findOne({ name: isPending.gateWayId }).session(session);

        if (!payoutApi) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "Failed", data: "Payout API not found" });
        }

        let statusCheck;

        if (payoutApi.name == "payinfintech") {
            const payload = {
                "orderid": trxId
            }
            const statusResponse = await axios.post(`https://api.payinfintech.com/webhook/payout/checkstatus`, payload);
            if (!statusResponse?.data || !statusResponse.data.status) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Failed", data: "Invalid response from payout API" });
            } else {
                statusCheck = {
                    status: statusResponse.data.data.status,
                    message: statusResponse.data.message,
                    status_code: statusResponse.data.status_code,
                    amount: statusResponse.data.data.amount,
                    utr: statusResponse.data.data.utr,
                    optxId: statusResponse.data.data.txnId
                }
            }

        } else {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "Failed", data: "Payout API not supported for status check" });
        }

        // { "status": true, "message": "success", "data": { "amount": 50, "utr": "604311096285", "orderId": "1234567891234", "txnId": "PFO9812556695645278", "status": "success" }, "status_code": 101 }


        const payOutGen = await payOutModelGenerate.findOneAndUpdate(
            { trxId: trxId },
            { $set: { status: (statusCheck.status === "success" || statusCheck.status_code === 101) ? "Success" : "Failed", utr: statusCheck.utr, failureReason: statusCheck.status != "success" ? statusCheck.message : null } },
            { new: true, session }
        );

        if (!payOutGen) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "Payout record not found" });
        }

        // const userMeta = await userMetaModel.findOne({ userId: payOutGen.user_id }).session(session);
        const [user, userMeta] = await Promise.all([
            userModel.findById(payOutGen.user_id).session(session),
            userMetaModel.findOne({ userId: payOutGen.user_id }).session(session)
        ]);
        const netAmount = payOutGen.amount + (payOutGen.gatewayCharge || 0);

        if (statusCheck.status.toLowerCase() != "success" || statusCheck.status_code != 101) {

            const updatedUserWallet = await userModel.findByIdAndUpdate(
                payOutGen.user_id,
                { $inc: { upiWalletBalance: +Number(netAmount) } },
                { new: true, session }
            );

            if (!updatedUserWallet) {
                await session.abortTransaction();
                session.endSession();
                return res.status(500).json({ message: "Failed", data: "Wallet update failed" });
            }

            const walletModelDataStore = {
                userId: payOutGen.user_id,
                type: "credit",
                amount: payOutGen.amount,
                beforeAmount: updatedUserWallet.upiWalletBalance - netAmount,
                charges: payOutGen.gatewayCharge || 0,
                afterAmount: updatedUserWallet.upiWalletBalance,
                description: `Successfully credited amount: ${Number(netAmount)} with transaction Id: ${trxId}`,
                transactionStatus: "failed",
            };

            await MainWalletTransaction.create([walletModelDataStore], { session });

            if (userMeta?.payOutCallbackUrl) {
                try {
                    axios.post(userMeta.payOutCallbackUrl, {
                        event: 'payout_failed',
                        txnId: payOutGen.trxId,
                        status: 'Failed',
                        status_code: 400,
                        amount: payOutGen.amount,
                        utr: null,
                        vpaId: null,
                        txnStartDate: payOutGen.createdAt,
                        message: 'Payment failed',
                    })
                } catch (error) {
                    null
                }
            };
            return res.status(200).json({ message: "Success", data: "Status updated successfully" });
        }
        else if (statusCheck.status.toLowerCase() == "success" && statusCheck.status_code == 101) {

            if (!statusCheck.utr) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "bank rrn is required" });
            }

            const payoutDataStore = {
                user_id: payOutGen.user_id,
                amount: payOutGen.amount,
                chargeAmount: payOutGen.gatewayCharge || 0,
                finalAmount: netAmount,
                utr: statusCheck.utr,
                referenceID: statusCheck.optxId,
                trxId: payOutGen.trxId,
                isSuccess: "Success"
            };

            const walletModelDataStore = {
                userId: payOutGen.user_id,
                type: "debit",
                amount: payOutGen.amount,
                beforeAmount: user.upiWalletBalance + Number(netAmount),
                charges: payOutGen.gatewayCharge || 0,
                afterAmount: user.upiWalletBalance,
                description: `Successfully debited amount: ${Number(netAmount)} with transaction Id: ${trxId}`,
                transactionStatus: "success",
            };

            await Promise.all([
                payOutModel.create([payoutDataStore], { session }),
                MainWalletTransaction.create([walletModelDataStore], { session })
            ]);
            if (userMeta?.payOutCallbackUrl) {
                try {
                    axios.post(userMeta.payOutCallbackUrl, {
                        event: 'payout_success',
                        txnId: payOutGen.trxId,
                        status: 'Success',
                        status_code: 200,
                        amount: payOutGen.amount,
                        chargeAmount: payOutGen.gatewayCharge || 0,
                        netAmount: netAmount,
                        utr: statusCheck.utr,
                        txnStartDate: payOutGen.createdAt,
                        message: 'Payment success',
                    })
                } catch (error) {
                    null
                }
            };
            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({ message: "Success", data: "Payout processed successfully" });
        } else {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ message: "Invalid status" });
        }

    } catch (error) {
        console.log(error)
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Failed", data: "Status update failed", error: error.message });
    }
};