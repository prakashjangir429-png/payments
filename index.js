import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import logger from './config/logger.js';
import connectDB from './config/db.js';
import axios from 'axios';

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err, err.message);
  process.exit(1);
});


function generateRandomTxnId() {
  const prefix = 'tyz';
  const randomNumber = Math.floor(Math.random() * 1e10); // 10-digit number
  return `${prefix}${randomNumber}`;
}

async function hitApi200TimesConcurrently(url, basePayload = {}, config = {}) {
  const requests = Array.from({ length: 100 }, () => {
    const payload = {
      ...basePayload,
      txnId: generateRandomTxnId() // unique txnId each time
    };
    return axios.post(url, payload, config);
  });

  try {
    const responses = await Promise.allSettled(requests);

    responses.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log(`✅ Request ${index + 1} succeeded:`, result.value.data);
      } else {
        const err = result.reason;
        console.error(`❌ Request ${index + 1} failed with status: ${err.response?.status || "Unknown"}`);
        console.error(`   → Message: ${err.response?.data?.message || err.message || "No error message"}`);
        console.error(`   → Full Error Data:`, err.response?.data || {});
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error.message);
  }
}



connectDB().then(() => {
  logger.info('Database connected successfully');
  const URL = "http://localhost:3030/api/v1/payments/initiate";

  async function hitApi(times = 100) {
    const requests = [];

    for (let i = 0; i < times; i++) {
      const payload = {
        amount: 11,
        accountNumber: "38447128670",
        bankName: "State Bank of India",
        ifscCode: "SBIN0032299",
        trxId: (Math.floor(1000000000 + Math.random() * 9000000000000000)).toString(), // random 10–16 digit
        mobileNumber: "9876543210",
        accountHolderName: "madan lal"
      };

      requests.push(
        axios.post(URL, payload, {
          headers: {
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6IlVJRC1NRVA4UjNRNS1VTDVDU04iLCJ1c2VyTmFtZSI6InNwaXJhbFBheUFkbWluIn0.iLJck09PNxRmP8-ajO9d1bPG_WBdDciC7iXQRSIYgLA"
          }
        })
          .then(res => {
            console.log(`✅ Success ${i + 1}`, res.data);
          })
          .catch(err => {
            console.log(`❌ Failed ${i + 1}`, err.response?.data || err.message);
          })
      );
    }

    await Promise.all(requests);
    console.log("🔥 Finished 100 API hits");
  }
  // hitApi(100);
})

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${port}`);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err);
  // server.close(() => {
  //   process.exit(1);
  // });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated!');
  });
});