import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../src/components/Skeleton';

describe('skeleton', () => {
  it('is announced as Loading and draws the requested number of hidden lines', () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    const lines = container.querySelectorAll('.skeleton-line');
    expect(lines).toHaveLength(4);
    for (const l of Array.from(lines)) expect(l).toHaveAttribute('aria-hidden', 'true');
  });
});
