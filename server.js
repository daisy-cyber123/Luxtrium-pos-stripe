// =========================
// Luxtrium POS Server (Stripe Terminal Integration)
// =========================

// Load environment variables
require('dotenv').config();

// Import dependencies
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const path = require('path');

// Initialize Express and Stripe
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Config
const PORT = process.env.PORT || 4242;
const READER_ID = process.env.READER_ID;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

// --------------------
// Create Payment Intent
// --------------------
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', email, metadata = {} } = req.body;
    if (!amount) return res.status(400).json({ error: 'Missing amount' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata,
      description: 'Event sale',
      receipt_email: email || undefined, // For web-based email collection
    });

    res.json({ payment_intent: paymentIntent.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------------------
// Process Payment on Reader
// --------------------
app.post('/process-on-reader', async (req, res) => {
  try {
    const { payment_intent } = req.body;
    if (!payment_intent)
      return res.status(400).json({ error: 'Missing payment_intent' });

    // Tell Stripe which reader to process the payment on
    await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent,
    });

    // Poll until payment completes
    const poll = async () => {
      const pi = await stripe.paymentIntents.retrieve(payment_intent);
      if (pi.status === 'succeeded') return pi;
      await new Promise((r) => setTimeout(r, 1500));
      return poll();
    };

    const result = await poll();

    // Respond to frontend
    res.json({ success: true, payment_intent: result });

    // -----------------------------------------
    // 👇 NEW: Collect Email or SMS on the Reader
    // -----------------------------------------
    try {
      if (result.status === 'succeeded') {
        // Wait 1s to let the reader refresh before showing prompt
        await new Promise((r) => setTimeout(r, 1000));

        const inputResult = await stripe.terminal.readers.collectInputs(
          READER_ID,
          {
            type: 'customer_contact',
            fields: [
              { name: 'email', label: 'Email for receipt (optional)' },
              { name: 'phone_number', label: 'SMS for receipt (optional)' },
            ],
          }
        );

        console.log('📨 Customer input collected:', inputResult);
      }
    } catch (collectErr) {
      console.error('⚠️ Error collecting inputs:', collectErr.message);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------------------
// Webhook Endpoint
// --------------------
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('✅ Payment succeeded:', event.data.object.id);
      break;
    case 'payment_intent.payment_failed':
      console.log('❌ Payment failed:', event.data.object.id);
      break;
    default:
      console.log('Unhandled event:', event.type);
  }

  res.json({ received: true });
});

// --------------------
// Serve the Frontend
// --------------------
app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// --------------------
// Start Server
// --------------------
app.listen(PORT, () =>
  console.log(`✅ Luxtrium POS server running on port ${PORT}`)
);
