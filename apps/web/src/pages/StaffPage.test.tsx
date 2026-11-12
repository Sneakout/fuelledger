import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffPage } from './StaffPage';

const { accessBootstrap, shiftBootstrap, staffDeactivationCheck, deactivateStaff } = vi.hoisted(() => ({
  accessBootstrap: vi.fn(),
  shiftBootstrap: vi.fn(),
  staffDeactivationCheck: vi.fn(),
  deactivateStaff: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { accessBootstrap, shiftBootstrap, staffDeactivationCheck, deactivateStaff },
}));
vi.mock('../components/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ selectedStationId: 'station-1', selectedStation: { id: 'station-1', name: 'Saleema Petroleum' } }) }));

describe('StaffPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    accessBootstrap.mockResolvedValue({
      stations: [{ id: 'station-1', name: 'Saleema Petroleum', configurations: [] }],
      users: [
        { id: 'manager-1', name: 'Asha Manager', email: 'asha@example.com', role: 'MANAGER', stationIds: ['station-1'], mustChangePassword: false, lastLoginAt: null },
        { id: 'staff-1', name: 'Ravi Attendant', email: null, role: 'STAFF', stationIds: ['station-1'] },
      ],
    });
    shiftBootstrap.mockResolvedValue({ shifts: [] });
    staffDeactivationCheck.mockResolvedValue({
      user: { id: 'staff-1', name: 'Ravi Attendant', role: 'STAFF' },
      canDeactivate: true,
      blockers: [],
      activeShifts: [],
      historicalShiftCount: 8,
      historicalSalesCount: 42,
      defaultNozzleCount: 1,
      pendingHandoverCount: 0,
      possibleAmountDue: 0,
      historyPreserved: true,
    });
    deactivateStaff.mockResolvedValue({ id: 'staff-1', active: false, historyPreserved: true, clearedDefaultNozzles: 1 });
  });

  it('presents managers, attendants, and optional nozzle custody as one workspace', async () => {
    render(<StaffPage />);
    expect(await screen.findByRole('heading', { name: 'Team control for Saleema Petroleum' })).toBeInTheDocument();
    expect(screen.getByText('Manager logins')).toBeInTheDocument();
    expect(screen.getAllByText('Active attendants').length).toBeGreaterThan(0);
    expect(screen.getByText('Optional opening suggestions')).toBeInTheDocument();
    expect(screen.getByText('Asha Manager')).toBeInTheDocument();
    expect(screen.getByText('Ravi Attendant')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nozzle assignments' })).toBeInTheDocument();
  });

  it('shows the opening assignments read-only until the shift closes', async () => {
    accessBootstrap.mockResolvedValue({
      stations: [{
        id: 'station-1',
        name: 'Saleema Petroleum',
        configurations: [{
          dispensers: [{
            id: 'dispenser-1',
            code: 'D-1',
            location: 'Forecourt',
            nozzles: [{
              id: 'nozzle-1',
              code: 'MS-1',
              product: { code: 'MS', name: 'Motor Spirit' },
              attendantAssignment: { userId: 'staff-1' },
            }],
          }],
        }],
      }],
      users: [
        { id: 'staff-1', name: 'Ravi Attendant', email: null, role: 'STAFF', stationIds: ['station-1'] },
        { id: 'staff-2', name: 'Meena Attendant', email: null, role: 'STAFF', stationIds: ['station-1'] },
      ],
    });
    shiftBootstrap.mockResolvedValue({
      shifts: [{
        id: 'shift-1',
        shiftNumber: 12,
        status: 'OPEN',
        station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SALEEMA' },
        nozzleAssignments: [{
          nozzleId: 'nozzle-1',
          userId: 'staff-2',
          user: { id: 'staff-2', name: 'Meena Attendant', role: 'STAFF' },
        }],
      }],
    });

    render(<StaffPage />);

    expect((await screen.findAllByText('Locked until shift closes')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Confirmed when shift #12 opened/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save opening defaults/i })).not.toBeInTheDocument();
    const assignment = screen.getByRole('combobox', { name: 'Attendant for D-1 / MS-1' });
    expect(assignment).toBeDisabled();
    await waitFor(() => expect(assignment).toHaveValue('staff-2'));
  });

  it('checks obligations and requires confirmation before deactivating an attendant', async () => {
    render(<StaffPage />);
    await screen.findByText('Ravi Attendant');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Ravi Attendant' }));

    expect(await screen.findByRole('dialog', { name: 'Check Ravi Attendant first' })).toBeInTheDocument();
    expect(staffDeactivationCheck).toHaveBeenCalledWith('staff-1');
    expect(screen.getByText('History will remain intact')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(deactivateStaff).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(deactivateStaff).toHaveBeenCalledWith('staff-1'));
  });
});
