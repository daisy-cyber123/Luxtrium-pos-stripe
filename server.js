// --- IMPORTS ---
const express = require("express");
const bodyParser = require("body-parser");
const Stripe = require("stripe");
const cors = require("cors");
const path = require("path");

// --- INITIAL SETUP ---
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const READER_ID = process.env.READER_ID;
const PORT = process.env.PORT || 4242;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// --- ROUTES ---

// Health check
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// POS interface
app.get("/pos.html", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "pos.html"));
});

// Create a payment intent
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency = "usd" } = req.body;
    if (!amount) return res.status(400).json({ error: "Missing amount" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      description: "Luxtrium POS Sale",
    });

    console.log("✅ Created PaymentIntent:", paymentIntent.id);
    res.json({ payment_intent: paymentIntent.id });
  } catch (err) {
    console.error("❌ Stripe error creating payment intent:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Process payment on reader
app.post("/process-on-reader", async (req, res) => {
  try {
    const { payment_intent } = req.body;
    if (!payment_intent)
      return res.status(400).json({ error: "Missing payment_intent" });

    await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Stripe error processing on reader:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fallback for 404s
app.use((req, res) => {
  res.status(404).send("❌ Page not found.");
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`✅ Luxtrium POS Server running on port ${PORT}`);
});
