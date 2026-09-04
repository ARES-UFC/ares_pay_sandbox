import Stripe from 'stripe';
import config from './config.js';

const stripe = new Stripe(config.stripeSecretKey);

export default stripe;
