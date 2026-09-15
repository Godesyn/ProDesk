import Stripe from 'stripe';
import { env } from '../../lib/env.js';

/** Shared Stripe client, or null when not configured (dev without keys). */
export const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
export const stripeEnabled = !!stripe;
