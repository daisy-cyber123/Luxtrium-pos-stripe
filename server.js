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

// --------------------
// Root route
// --------------------
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------------
// POS page route
// --------------------
app.get('/pos', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pos.html'));
});

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
      description: 'Luxtrium POS Sale',
      receipt_email: email || undefined, // fallback for web input
    });

    res.json({ payment_intent: paymentIntent.id });
  } catch (err) {
    console.error('Stripe error creating payment intent:', err.message);
    res.status(500).json({ error: err.message });
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

    // Tell Stripe to process this intent on your reader
    await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent,
    });

    // Poll until payment succeeds
    const poll = async () => {
      const pi = await stripe.paymentIntents.retrieve(payment_intent);
      if (pi.status === 'succeeded') return pi;
      await new Promise((r) => setTimeout(r, 1500));
      return poll();
    };

    const result = await poll();

    // Send response to frontend
    res.json({ success: true, payment_intent: result });

    // ----------------------------------------------------
    // NEW: Prompt customer for Email/SMS on the WisePOS E
    // ----------------------------------------------------
    try {
      if (result.status === 'succeeded') {
        // Give the reader a second to refresh
        await new Promise((r) => setTimeout(r, 1000));

        // Show receipt options on device (once collect_inputs enabled)
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
      console.error('⚠️ Error collecting on-reader inputs:', collectErr.message);
    }
  } catch (err) {
    console.error('Error processing payment on reader:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Webhook (optional)
// --------------------
app.post('/webhook', (req, res) => {
  res.json({ received: true });
});

// --------------------
// Start server
// --------------------
app.listen(PORT, () =>
  console.log(`✅ Luxtrium POS server running on port ${PORT}`)
);
