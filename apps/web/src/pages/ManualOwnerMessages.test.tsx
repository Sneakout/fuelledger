import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ context: vi.fn(), prepare: vi.fn(), copy: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { manualMessageContext: mock.context, prepareManualMessage: mock.prepare }, ApiRequestError: class extends Error {} }));
import { ManualOwnerMessages } from './ManualOwnerMessages';
const preview = { body: 'Verified welcome for Mughal', destination: '918086306454', ownerName: 'Owner', stationName: 'Mughal', checkedAt: '2026-11-19T06:00:00Z', warnings: [] };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); mock.context.mockResolvedValue({ stations: [{ id: 's', name: 'Mughal' }], today: '2026-11-19' }); mock.prepare.mockResolvedValue(preview); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mock.copy.mockResolvedValue(undefined) } }); });
async function open() { render(<ManualOwnerMessages organizationId="org"/>); fireEvent.click(screen.getByText('Manual WhatsApp messages')); await screen.findByRole('button', { name: 'Prepare message' }); fireEvent.click(screen.getByRole('button', { name: 'Prepare message' })); await screen.findByRole('button', { name: 'Copy message' }); }
it('prepares a readable preview without copying or sending automatically', async () => {
 await open(); expect(screen.getByRole('textbox', { name: 'Manual WhatsApp message' })).toHaveValue(preview.body); expect(mock.copy).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: 'Copy message' })); await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(preview.body)); expect(mock.prepare).toHaveBeenCalledTimes(2);
});
it('updates changed records for review instead of copying stale figures', async () => {
 await open(); mock.prepare.mockResolvedValue({ ...preview, body: 'Updated balance' }); fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
 await screen.findByText('Records or recipient changed. The preview has been updated. Review it, then copy again.'); expect(mock.copy).not.toHaveBeenCalled(); expect(screen.getByRole('textbox')).toHaveValue('Updated balance');
});
it('clears the previous preview when the category changes', async () => {
 await open(); fireEvent.change(screen.getByRole('combobox', { name: 'Message' }), { target: { value: 'DAILY_SUMMARY' } });
 expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Report date')).toHaveValue('2026-11-19');
});
