import { describe, expect, it } from 'vitest';
import { ownerNotificationPacketSchema } from '@fuelledger/shared';
import { localOwnerNotificationFixtures, localTransportFixtures } from './fixtures/local-owner-notification-scenarios.js';

const internalLanguage = /evidence-backed|supported observation|possible connection|deterministic investigation|finding id|run id|fact packet/i;
const mutatingActions = new Set(['SEND', 'EXECUTE', 'CHANGE_INVENTORY', 'CORRECT_INVOICE']);

describe('Phase 7 sanitized local owner-notification scenarios', () => {
  it.each(localOwnerNotificationFixtures)('$key is human, specific, scoped and safely actionable', ({ scenario, expectedText }) => {
    const packet = ownerNotificationPacketSchema.parse({ schemaVersion: 1, ...scenario.facts, responsibleAgent: null });
    expect(scenario.sentence).not.toMatch(internalLanguage);
    for (const text of expectedText) expect(scenario.sentence).toContain(text);
    expect(packet.station).toEqual({ id: 'sanitized-station-c', name: 'Station C' });
    expect(packet.evidence.length).toBeGreaterThan(0);
    expect(packet.evidence.every(item => item.path.startsWith('/'))).toBe(true);
    expect(packet.availableActions).toContain('VIEW_RECORD');
    expect(packet.availableActions.some(action => mutatingActions.has(action))).toBe(false);
  });

  it('does not produce duplicate scenario identities', () => {
    const identities = localOwnerNotificationFixtures.map(({ scenario }) => [scenario.facts.recordType, scenario.facts.subjectName, scenario.facts.status, scenario.facts.eventDate].join(':'));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('only offers comparison when at least two supporting records exist', () => {
    for (const { scenario } of localOwnerNotificationFixtures) {
      expect(scenario.facts.availableActions.includes('COMPARE_RECORDS')).toBe(scenario.facts.evidence.length > 1);
    }
  });

  it('keeps cross-station denial and offline fallback fail-closed', () => {
    expect(localTransportFixtures.crossStationDenial.requestedStationId).not.toBe(localTransportFixtures.crossStationDenial.permittedStationIds[0]);
    expect(localTransportFixtures.crossStationDenial).toMatchObject({ status: 403, code: 'STATION_ACCESS_DENIED' });
    expect(localTransportFixtures.offlineBackend.mustUseSampleData).toBe(false);
  });
});
