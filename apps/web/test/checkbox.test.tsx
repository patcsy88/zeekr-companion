import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from '../src/components/ui/checkbox';

// Wrapped in a label, as on the pages that use it.
function Labelled({ text = 'Driver front' }: { text?: string }) {
  const [on, setOn] = useState(false);
  return (
    <label>
      <Checkbox checked={on} onCheckedChange={setOn} /> {text}
    </label>
  );
}

describe('Checkbox', () => {
  it('is named by its label, ticks from the label, Space and a tap, and hides the tick icon', async () => {
    const user = userEvent.setup();
    render(<Labelled />);
    const box = screen.getByRole('checkbox', { name: 'Driver front' });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText('Driver front'));
    expect(box).toBeChecked();
    expect(box.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    box.focus();
    await user.keyboard(' ');
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
  });
});
