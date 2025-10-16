// ==========================================================
// Luxtrium POS Server - with Cancel Payment Functionality
// ==========================================================

// Load environment variables
require('dotenv').config();

// Import dependencies
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const path = require('path');
const cors = require('cors');

// Initialize app and Stripe
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Config
const PORT = process.env.PORT || 4242;
const READER_ID = process.env.READER_ID;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

// ==========================================================
// Root route
// ==========================================================
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================================
// POS Page Route
// ==========================================================
app.get('/pos', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pos.html'));
});

// ==========================================================
// Create Payment Intent
// ==========================================================
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', metadata = {} } = req.body;
    if (!amount) return res.status(400).json({ error: 'Missing amount' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata,
      description: 'Luxtrium POS Sale',
    });

    console.log('✅ Payment intent created:', paymentIntent.id);
    res.json({ payment_intent: paymentIntent.id });
  } catch (err) {
    console.error('❌ Stripe error creating payment intent:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// Process Payment on Reader
// ==========================================================
app.post('/process-on-reader', async (req, res) => {
  try {
    const { payment_intent } = req.body;
    if (!payment_intent)
      return res.status(400).json({ error: 'Missing payment_intent' });

    console.log(`💳 Processing payment on reader ${READER_ID}...`);

    await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent,
    });

    // Poll Stripe for the payment result
    const poll = async () => {
      const pi = await stripe.paymentIntents.retrieve(payment_intent);
      if (pi.status === 'succeeded') return pi;
      if (pi.status === 'canceled') throw new Error('Payment canceled');
      await new Promise((r) => setTimeout(r, 1500));
      return poll();
    };

    const result = await poll();
    console.log('✅ Payment successful!');
    res.json({ success: true, payment_intent: result });
  } catch (err) {
    console.error('❌ Error processing payment on reader:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// Cancel Payment on Reader
// ==========================================================
app.post('/cancel-payment', async (req, res) => {
  try {
    const { payment_intent } = req.body;
    console.log('⚠️ Canceling payment...');

    // Cancel any ongoing reader process
    try {
      await stripe.terminal.readers.cancelAction(READER_ID);
      console.log('🟡 Reader process canceled.');
    } catch (err) {
      console.log('ℹ️ No active reader action to cancel:', err.message);
    }

    // If there's a payment intent, cancel it as well
    if (payment_intent) {
      await stripe.paymentIntents.cancel(payment_intent);
      console.log(`🛑 Payment intent ${payment_intent} canceled.`);
    }

    res.json({ success: true, message: 'Payment canceled successfully.' });
  } catch (err) {
    console.error('❌ Error canceling payment:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// Webhook (optional placeholder)
// ==========================================================
app.post('/webhook', (req, res) => {
  res.json({ received: true });
});

// ==========================================================
// Start Server
// ==========================================================
app.listen(PORT, () =>
  console.log(`✅ Luxtrium POS server running on port ${PORT}`)
);
