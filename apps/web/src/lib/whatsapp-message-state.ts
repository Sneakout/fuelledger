import type { WhatsAppRolloutPolicy } from './api';

// Rollout holds describe current controls; delivery outcomes remain historical facts.
export function currentPendingHold(policy: WhatsAppRolloutPolicy, organizationId: string, type: string, recordedHold: string | null) {
  if (policy.paused) return 'delivery_paused';
  if (policy.stage === 'SHADOW') return 'shadow_mode';
  if (!policy.organizationIds.includes(organizationId)) return 'account_not_enrolled';
  if (!policy.enabledCategories.includes(type)) return 'category_paused';
  if (type === 'CUSTOMER_CREDIT_REMINDER' && policy.stage === 'INTERNAL') return 'customer_reminders_paused';
  // These persisted holds are superseded by the live settings above.
  return ['delivery_paused', 'shadow_mode', 'account_not_enrolled', 'category_paused', 'customer_reminders_paused'].includes(recordedHold ?? '') ? null : recordedHold;
}

export function pendingMessageStatus(hold: string | null, needsApproval: boolean) {
  if (hold === 'delivery_paused' || hold === 'category_paused' || hold === 'customer_reminders_paused') return 'Paused';
  if (hold === 'shadow_mode') return 'Preview only';
  if (hold === 'account_not_enrolled') return 'Owner not enabled';
  if (hold === 'deployment_delivery_disabled') return 'Sending unavailable';
  if (hold && hold !== 'preview_only') return 'Sending blocked';
  return needsApproval ? 'Needs preview approval' : 'Approved · awaiting send';
}
