/**
 * Per-tool authorization policies for event tools.
 */

import type { ToolPolicy } from '../contracts.js';

export const EVENT_POLICIES: Record<string, ToolPolicy> = {
  // --- Events ---
  get_upcoming_events: {
    capability: 'view_events',
    requiresEntitlement: false,
    classifications: ['READ'],
    requiredRoles: [],
    mutates: false,
    financial: false,
    destructive: false,
    requiresConfirmation: false,
  },
  create_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  update_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['WRITE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  cancel_event: {
    capability: 'ai_write',
    requiresEntitlement: true,
    classifications: ['DESTRUCTIVE', 'ADMIN'],
    requiredRoles: ['school_master', 'event_cordinator'],
    mutates: true,
    financial: false,
    destructive: true,
    requiresConfirmation: true,
  },
  register_event: {
    capability: 'ai_write',
    requiresEntitlement: false,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
  request_volunteer: {
    capability: 'ai_write',
    requiresEntitlement: false,
    classifications: ['WRITE'],
    requiredRoles: [],
    mutates: true,
    financial: false,
    destructive: false,
    requiresConfirmation: true,
  },
};
