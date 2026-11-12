import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpensesPage } from './ExpensesPage';

const { purchasesBootstrap, createExpenseCategory } = vi.hoisted(() => ({
  purchasesBootstrap: vi.fn(),
  createExpenseCategory: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { purchasesBootstrap, createExpenseCategory },
}));

describe('ExpensesPage category creation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    purchasesBootstrap.mockResolvedValue({
      suppliers: [], invoices: [], products: [], expenses: [],
      stations: [{ id: 'station', name: 'Saleema Petroleum', code: 'SAL' }],
      categories: [{ id: 'utilities', name: 'Utilities', code: 'UTILITIES', active: true }],
      summary: { payables: 0, overdue: 0, expensesThisMonth: 0 },
    });
    createExpenseCategory.mockResolvedValue({ category: { id: 'generator', name: 'Generator Fuel', code: 'GENERATOR-FUEL', active: true } });
  });

  it('generates a valid category code from the entered name', async () => {
    render(<ExpensesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /category/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Generator fuel' } });
    expect(screen.getByLabelText('Code')).toHaveValue('GENERATOR-FUEL');
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));

    await waitFor(() => expect(createExpenseCategory).toHaveBeenCalledWith({
      name: 'Generator fuel',
      code: 'GENERATOR-FUEL',
    }));
  });

  it('filters the register and summary by month and category', async () => {
    purchasesBootstrap.mockResolvedValue({
      suppliers: [], invoices: [], products: [],
      stations: [{ id: 'station', name: 'Saleema Petroleum', code: 'SAL' }],
      categories: [
        { id: 'salary', name: 'Staff Salary', code: 'STAFF-SALARY', active: true },
        { id: 'electricity', name: 'Electricity', code: 'ELECTRICITY', active: true },
      ],
      expenses: [
        { id: 'oct-salary', description: 'October salary', amount: '19500', paymentMethod: 'CASH', incurredAt: '2026-10-26T00:00:00+05:30', referenceNo: null, notes: null, station: { id: 'station', name: 'Saleema Petroleum', code: 'SAL' }, category: { id: 'salary', name: 'Staff Salary', code: 'STAFF-SALARY', active: true }, attachments: [], createdBy: { name: 'Owner' } },
        { id: 'oct-power', description: 'October power', amount: '5000', paymentMethod: 'UPI', incurredAt: '2026-10-20T00:00:00+05:30', referenceNo: null, notes: null, station: { id: 'station', name: 'Saleema Petroleum', code: 'SAL' }, category: { id: 'electricity', name: 'Electricity', code: 'ELECTRICITY', active: true }, attachments: [], createdBy: { name: 'Owner' } },
        { id: 'sep-power', description: 'September power', amount: '12000', paymentMethod: 'CASH', incurredAt: '2026-09-23T00:00:00+05:30', referenceNo: null, notes: null, station: { id: 'station', name: 'Saleema Petroleum', code: 'SAL' }, category: { id: 'electricity', name: 'Electricity', code: 'ELECTRICITY', active: true }, attachments: [], createdBy: { name: 'Owner' } },
      ],
      summary: { payables: 0, overdue: 0, expensesThisMonth: 0 },
    });

    render(<ExpensesPage />);
    await screen.findByText('October salary');

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter expenses by month' }), { target: { value: '2026-10' } });
    expect(screen.queryByText('September power')).not.toBeInTheDocument();
    expect(screen.getByText('October power')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter expenses by category' }), { target: { value: 'salary' } });
    expect(screen.getByText('October salary')).toBeInTheDocument();
    expect(screen.queryByText('October power')).not.toBeInTheDocument();
    expect(screen.getByText('1 entries')).toBeInTheDocument();
    expect(screen.getAllByText('₹19,500').length).toBeGreaterThan(0);
  });
});
