import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { UserGuidePage } from './UserGuidePage';

afterEach(cleanup);
const open = () => render(<MemoryRouter><UserGuidePage /></MemoryRouter>);

describe('User guide', () => {
  it('covers every workflow group and links instructions to the existing app', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Historical DSR imports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: 'Open My account' })).toHaveAttribute('href', '/account');
  });
  it('searches instruction text and expands matching instructions immediately', () => {
    open();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'following morning' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 topic matching');
    expect(screen.getByText('Review readings and calculated fields').closest('details')).toHaveAttribute('open');
    expect(screen.queryByText('Open a shift')).not.toBeInTheDocument();
  });
  it('combines section filtering with search and provides an empty-state reset', () => {
    open();
    const navigation = within(screen.getByRole('navigation', { name: 'Guide sections' }));
    fireEvent.click(navigation.getByRole('button', { name: 'Accounts & reports' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 topics');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched-term' } });
    expect(screen.getByRole('heading', { name: 'No matching topics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all topics' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(navigation.getByRole('button', { name: 'All topics' })).toHaveAttribute('aria-pressed', 'true');
  });
});
