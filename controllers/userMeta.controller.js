import UserMeta from '../models/userMeta.model.js';
import AppError from '../utils/appError.js';
import crypto from "crypto";
import catchAsync from "../utils/catchAsync.js";
import User from '../models/user.model.js';

export const upsertUserMeta = async (req, res, next) => {
  try {
    const { payInCallbackUrl, payOutCallbackUrl, meta } = req.body;
    const updated = await UserMeta.findOneAndUpdate(
      { userId: req.user._id },
      { payInCallbackUrl, payOutCallbackUrl, meta, clientId: req.user.clientId },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
};

// Get Meta by User ID (Self)
export const getUserMeta = async (req, res, next) => {
  try {
    const data = await UserMeta.findOne({ userId: req.user._id });

    if (!data) return next(new AppError('User meta not found', 400));

    res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

// Admin: Get Meta by any userId
export const getMetaByUserId = async (req, res, next) => {
  try {
    const data = await UserMeta.findOne({ userId: req.params.userId });

    if (!data) return next(new AppError('Meta not found', 404));

    res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

// Admin: Add or update whitelisted IPs
export const updateWhitelistedIPs = async (req, res, next) => {
  try {
    const { userId, whitelistedIPs } = req.body;

    if (!Array.isArray(whitelistedIPs)) {
      return next(new AppError('whitelistedIPs must be an array', 400));
    }

    const updated = await UserMeta.findOneAndUpdate(
      { userId },
      { whitelistedIPs, clientId: req.user.clientId },
      { new: true, upsert: true}
    );

    if (!updated) return next(new AppError('User meta not found', 404));

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
};

// Admin: Delete Meta
export const deleteUserMeta = async (req, res, next) => {
  try {
    const result = await UserMeta.findOneAndDelete({ userId: req.params.userId });

    if (!result) {
      return res.status(404).json({ success: false, message: 'User meta not found' });
    }

    res.status(200).json({ success: true, message: 'User meta deleted' });
  } catch (error) {
    return next(error);
  }
};


export const verifyUserForPasswordReset = catchAsync(async (req, res, next) => {
  const { fullName, userName, clientId, email, mobileNumber } = req.body;

  if (!fullName || !userName || !clientId || !email || !mobileNumber) {
    return next(new AppError("All fields are required for verification", 400));
  }

  const user = await User.findOne({
    fullName: { $regex: new RegExp(`^${fullName}$`, 'i') },
    userName: { $regex: new RegExp(`^${userName}$`, 'i') },
    clientId,
    email: { $regex: new RegExp(`^${email}$`, 'i') },
    mobileNumber
  }).select('+clientSecret');

  if (!user) {
    return next(new AppError("Account verification failed. Please check your details.", 400));
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  user.verificationToken = verificationToken;
  user.verificationTokenExpires = Date.now() + 5 * 60 * 1000; // 15 minutes
  await user.save();

  user.clientSecret = undefined;

  res.status(200).json({
    status: "Success",
    status_code: 200,
    message: "Account verified successfully",
    verificationToken,
    expiresIn: "5 minutes"
  });
});

export const resetPasswordWithToken = catchAsync(async (req, res, next) => {
  const { verificationToken, newPassword, confirmPassword } = req.body;

  if (!verificationToken || !newPassword || !confirmPassword) {
    return next(new AppError("Verification token and new password are required", 400));
  }

  if (newPassword !== confirmPassword) {
    return next(new AppError("Passwords do not match", 400));
  }

  if (newPassword.length < 8) {
    return next(new AppError("Password must be at least 8 characters long", 400));
  }

  const user = await User.findOne({
    verificationToken,
    verificationTokenExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError("Invalid or expired verification token", 400));
  }

  user.password = newPassword;
  user.verificationToken = undefined;
  user.verificationTokenExpires = undefined;
  
  await user.save();

  res.status(200).json({
    status: "Success",
    status_code: 200,
    message: "Password reset successfully. You can now login with your new password."
  });
});
