require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const PORT = process.env.PORT || 3002;
const url = process.env.MONGO_URL;
const app = express();

const authRoutes = require("./routes/authRoutes");

const cron = require("node-cron");
const { syncPrices } = require("./jobs/priceSync");
const { recordDailySnapshot } = require("./jobs/portfolioSnapshot");
const { marketSync } = require("./jobs/marketSync");

// dev origins stay hardcoded; production origin comes from CORS_ORIGIN (e.g. https://tradium.netlify.app)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
];
if (process.env.CORS_ORIGIN) allowedOrigins.push(process.env.CORS_ORIGIN);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/auth", authRoutes);

app.use("/api/holdings", require("./routes/holdingsRoutes"));
app.use("/api/positions", require("./routes/positionsRoutes"));
app.use("/api/orders", require("./routes/ordersRoutes"));
app.use("/api/watchlist", require("./routes/watchlistRoutes"));
app.use("/api/funds", require("./routes/fundsRoutes"));
app.use("/api/portfolio", require("./routes/portfolioRoutes"));
app.use("/api/instruments", require("./routes/instrumentRoutes"));
app.use("/api/market", require("./routes/marketRoutes"));
app.use("/api/assistant", require("./routes/assistantRoutes"));

// Cheapest possible "is it alive" answer — the keep-alive ping and any uptime
// monitor hit this; it does no DB or Yahoo work.
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// anything that didn't match a route above
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Central error handler for the whole app.
// eslint-disable-next-line no-unused-vars -- Express needs all 4 args to treat this as an error handler
app.use((err, req, res, next) => {
  console.error(err);

  if (err.name === "ValidationError") {
    return res.status(400).json({ message: err.message });
  }

  // don't leak details of errors we didn't throw on purpose
  const status = err.status || 500;
  res.status(status).json({
    message: status === 500 ? "Something went wrong" : err.message,
  });
});

mongoose
  .connect(url)
  .then(() => {
    console.log("MongoDB connected successfully");

    // Runs every minute — also fills open limit orders. Times are in IST.
    cron.schedule("* * * * *", syncPrices, { timezone: "Asia/Kolkata" });
    syncPrices();
    cron.schedule("*/5 * * * *", marketSync, { timezone: "Asia/Kolkata" });
    marketSync(); // populates the NIFTY 50 cache on a cold start
    cron.schedule("0 18 * * *", recordDailySnapshot, { timezone: "Asia/Kolkata" }); // once daily, after market close 6PM IST

    app.listen(PORT, () => {
      console.log(`Server is listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });