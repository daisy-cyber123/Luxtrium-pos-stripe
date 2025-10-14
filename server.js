
// Import dependencies
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const cors = require('cors');
const path = require('path');

// Initialize Express and Stripe
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
// Create Payment Intent
// --------------------
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
      description: 'Event sale',
    });

    res.json({ payment_intent: paymentIntent.id });
  } catch (e) {
    console.error('❌ Error creating payment intent:', e.message);
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
    res.json({ success: true, payment_intent: result });
  } catch (e) {
    console.error('❌ Error processing on reader:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --------------------
// Stripe Webhook Endpoint
// --------------------
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook verification failed:', err.message);
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
// Serve Frontend Pages
// --------------------

// Root (landing page)
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// POS Interface page
app.get('/pos.html', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pos.html'));
});

// Catch-all fallback
app.use((req, res) => {
  res.status(404).send('❌ Page not found.');
});

// --------------------
// Start Server
// --------------------
app.listen(PORT, () => {
  console.log(`✅ POS server running on port ${PORT}`);
});
