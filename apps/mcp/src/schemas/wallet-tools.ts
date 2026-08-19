import type { ToolDefinition } from './index.js';

export const walletTools: ToolDefinition[] = [
  {
    name: 'get_wallet_balance',
    description:
      'Returns the current wallet balance for the authenticated user at their active school. Read-only. Use this to check funds before ordering lunch.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        balanceCents: { type: 'number' },
        balanceFormatted: { type: 'string' },
        currency: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Wallet Balance' },
  },
  {
    name: 'get_wallet_status',
    description:
      'Returns the wallet balance plus recent transactions and pending deposits. Read-only. Use this for a wallet overview.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Wallet Status' },
  },
  {
    name: 'add_funds',
    description:
      "Creates a Stripe checkout session to add funds to the user's wallet and emails the payment link. This is a FINANCIAL operation — always confirm the exact amount with the user before calling. The minimum top-up is $5.00 (500 cents). The wallet is only credited after the user completes the Stripe payment; this tool does not directly move money. Returns a masked email and transaction reference. Idempotent per transaction.",
    inputSchema: {
      type: 'object',
      properties: {
        amount_cents: { type: 'integer', description: 'Amount in cents (minimum 500 = $5.00)', minimum: 500 },
        description: { type: 'string', description: 'Optional note for the deposit' },
      },
      required: ['amount_cents'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, title: 'Add Funds to Wallet' },
  },
  {
    name: 'top_up_balance',
    description:
      "Creates a Stripe checkout session to add funds to the user's wallet and emails the payment link. This is a FINANCIAL operation — always confirm the exact amount with the user before calling. The minimum top-up is $5.00 (500 cents). The wallet is only credited after the user completes the Stripe payment. Idempotent per transaction.",
    inputSchema: {
      type: 'object',
      properties: {
        amount_cents: { type: 'integer', description: 'Amount in cents (minimum 500 = $5.00)', minimum: 500 },
        description: { type: 'string', description: 'Optional note' },
      },
      required: ['amount_cents'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, title: 'Top Up Balance' },
  },
  {
    name: 'donate_to_school',
    description:
      "Donates to a school. Requires school_slug and amount_cents (minimum $1.00 = 100 cents). The donation is deducted from the wallet and recorded in the school's ledger. This is a FINANCIAL + WRITE operation — always confirm the exact amount and school with the user before calling. Idempotent.",
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string', description: 'School slug to donate to' },
        amount_cents: { type: 'integer', description: 'Donation amount in cents (minimum 100 = $1.00)', minimum: 100 },
      },
      required: ['school_slug', 'amount_cents'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Donate to School' },
  },
];
