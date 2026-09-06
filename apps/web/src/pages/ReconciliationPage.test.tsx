import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ReconciliationPage } from './ReconciliationPage';
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { reconciliationBootstrap: vi.fn().mockResolvedValue({shifts:[],customers:[]}) } }));
it('explains the empty state and provides a route to operations', async () => {
  render(<MemoryRouter><ReconciliationPage /></MemoryRouter>);
  expect(await screen.findByRole('heading',{name:'No shifts are waiting for review'})).toBeInTheDocument();
  expect(screen.getByText('Close a shift first. Its sales will appear here automatically.')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href','/operations');
});
