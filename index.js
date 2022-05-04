const express = require('express');
const app = express();
//const { resolve } = require('path');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

// Replace if using a different env file or config
require('dotenv').config({ path: './.env' });

// {{{ configuration checking
if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_PUBLISHABLE_KEY
) {
  console.log(
    'The .env file is not configured. Follow the instructions in the readme to configure the .env file. https://github.com/stripe-samples/subscription-use-cases'
  );
  console.log('');
  process.env.STRIPE_SECRET_KEY
    ? ''
    : console.log('Add STRIPE_SECRET_KEY to your .env file.');

  process.env.STRIPE_PUBLISHABLE_KEY
    ? ''
    : console.log('Add STRIPE_PUBLISHABLE_KEY to your .env file.');

  process.exit();
}
// }}}

// {{{ stripe api
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2020-08-27',
  appInfo: { // For sample support and debugging, not required for production:
    name: "stripe-samples/subscription-use-cases/fixed-price",
    version: "0.0.1",
    url: "https://github.com/stripe-samples/subscription-use-cases/fixed-price"
  }
});
// }}}

// {{{ Use cookies to simulate logged in user.
app.use(cookieParser());
// }}}

// {{{ Use JSON parser for parsing payloads as JSON on all non-webhook routes.
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});

app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
// }}}

// {{{ Use static to serve static assets.
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')))
// }}}

app.get('/', (req, res) => {
  res.render("index", {test: "Hello World!!!"});
});

// {{{ terminal calls
app.get('/terminal-config', async (req, res) => {
  res.render('terminal-config');
});

app.post('/add-terminal', async (req, res) => {
  let registrationCode = req.body.reg_code;
  let terminalLabel = req.body.label;
  let location = req.body.location;
  const reader = await stripe.terminal.readers.create({
    registration_code: registrationCode,
    label: terminalLabel,
    location: location,
  });

  res.cookie('terminal', reader.id, { maxAge: 900000, httpOnly: false });
  res.redirect('demo');
});

app.get('/demo', async (req, res) => {
  let reader = undefined;

  if(req.cookies['terminal'])
    reader = await stripe.terminal.readers.retrieve(req.cookies['terminal']);
  if(!reader) {

    const readers = await stripe.terminal.readers.list();
    //just use the single one we are demo'n
    reader = readers.data[0];
    res.cookie('terminal', reader.id, { maxAge: 900000, httpOnly: false });
  }
  res.render('demo', reader);
});

app.post('/simulate-payment', async(req, res) => {
  const paymentIntent = await stripe.paymentIntents.create({
    currency: 'usd',
    payment_method_types: ['card_present'],
    capture_method: 'manual',
    amount: 1000,
  });

  let reader = await stripe.terminal.readers.processPaymentIntent(
    req.cookies['terminal'],
    {payment_intent: paymentIntent.id}
  );

  //Poll the reader status since we are not storing data in this demo
  let status = reader.action.status;
  while(status == 'in_progress') {
    let res = await stripe.terminal.readers.retrieve(req.cookies['terminal']);
    status = res.action.status;
  }

  if(status == 'succeeded')
    stripe.paymentIntents.capture(paymentIntent.id);

  res.redirect('demo');
});

async function capturePayment(paymentIntentId) {
  const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
  console.log(paymentIntent);
}
// }}}

// {{{ webhooks
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.header('Stripe-Signature'),
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.log(e);
      console.log(`⚠️  Webhook signature verification failed.`);
      console.log(
        `⚠️  Check the env file and enter the correct webhook secret.`
      );
      return res.sendStatus(400);
    }

    const dataObject = event.data.object;
    //console.log(dataObject);
    switch(event.type) {
      case 'terminal.reader.action_succeeded':
        console.log(dataObject);
        if(dataObject.action.status == 'succeeded') {
          //take action here, you could async the capture etc
        }
        break;
      case 'terminal.reader.action_failed':
        console.log("Terminal Payment Failed");
      default:
        break;
    }
    res.sendStatus(200);
  }
);
// }}}

app.listen(3000, () => console.log(`Node server listening on port http://localhost:${3000}!`));
