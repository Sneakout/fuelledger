import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

const mocks = vi.hoisted(() => ({
  user: { id: 'owner', name: 'Fixture Owner', role: 'OWNER', demoExpiresAt: null as string | null, isPlatformAdmin: false },
  subscription: vi.fn(),
  approvals: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api: { subscription: mocks.subscription, approvals: mocks.approvals } }));
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ user: mocks.user, logout: vi.fn() }) }));
vi.mock('./StationProvider', () => ({ useStation: () => ({
  stations: [{ id: 'main', name: 'Main fuel station' }], selectedStationId: 'main',
  selectedStation: { name: 'Main fuel station' }, selectStation: vi.fn(),
}) }));
vi.mock('./OfflineSyncStatus', () => ({ OfflineSyncStatus: () => <span>All records synced</span> }));

function openAt(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route element={<AppShell />}><Route path="*" element={<main>Current page</main>} /></Route>
  </Routes></MemoryRouter>);
}

const primary = () => within(screen.getByRole('navigation', { name: 'Primary navigation' }));

beforeEach(() => {
  Object.assign(mocks.user, { role: 'OWNER', demoExpiresAt: null, isPlatformAdmin: false });
  mocks.subscription.mockReset().mockResolvedValue({ intelligenceEnabledAt: null, intelligenceExpiresAt: null });
  mocks.approvals.mockReset().mockResolvedValue({ approvals: [] });
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('workspace navigation', () => {
  it('keeps the Core sidebar compact and keeps Approvals accessible at zero pending', async () => {
    openAt('/purchases');
    await waitFor(() => expect(mocks.subscription).toHaveBeenCalledOnce());
    expect(primary().getAllByRole('link').map(link => link.textContent))
      .toEqual(['Dashboard', 'Operations', 'Sales', 'Stock', 'Accounts', 'Settings']);
    expect(primary().getByRole('link', { name: 'Stock' })).toHaveAttribute('aria-current', 'location');
    const stock = within(screen.getByRole('navigation', { name: 'Stock navigation' }));
    expect(stock.getByRole('link', { name: 'Purchases' })).toHaveAttribute('aria-current', 'page');
    expect(stock.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/products');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
  });

  it('opens Daily Brief for an active subscriber and keeps the existing agent route reachable', async () => {
    mocks.subscription.mockResolvedValue({ intelligenceEnabledAt: '2026-01-01T00:00:00Z', intelligenceExpiresAt: null });
    openAt();
    const intelligence = await primary().findByRole('link', { name: 'Nerve Intelligence' });
    expect(intelligence).toHaveAttribute('href', '/insights/daily-brief');
    fireEvent.click(intelligence);
    const tools = within(screen.getByRole('navigation', { name: 'Nerve Intelligence navigation' }));
    expect(tools.getByRole('link', { name: 'Daily Brief' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(tools.getByRole('link', { name: 'Agents' }));
    expect(tools.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');

    mocks.subscription.mockResolvedValue({ intelligenceEnabledAt: '2026-01-01T00:00:00Z', intelligenceExpiresAt: '2026-02-01T00:00:00Z' });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(primary().queryByRole('link', { name: 'Nerve Intelligence' })).toBeNull());
  });

  it('updates the approval badge from the same pending list used for reminders', async () => {
    mocks.approvals.mockResolvedValueOnce({ approvals: [{ id: 'one', version: 1 }] });
    openAt();
    const approvals = await screen.findByRole('link', { name: 'Approvals 1 pending' });
    expect(approvals).toHaveAttribute('href', '/approvals');
    expect(await screen.findByRole('dialog', { name: 'One decision is waiting' })).toBeInTheDocument();
    fireEvent(window, new Event('fuelnerve:approvals-changed'));
    await screen.findByRole('link', { name: 'Approvals' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps nested routes in their section and exposes mobile More', () => {
    mocks.user.role = 'MANAGER';
    openAt('/sales/history/import');
    const mobile = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    expect(mobile.getByRole('link', { name: 'Sales' })).toHaveAttribute('aria-current', 'location');
    const sales = within(screen.getByRole('navigation', { name: 'Sales navigation' }));
    expect(sales.getByRole('link', { name: 'Sales history' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Approvals' })).toBeNull();
    expect(mocks.subscription).not.toHaveBeenCalled();
    const more = mobile.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });
});
