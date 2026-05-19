import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './main';

describe('Meowversee prompt input', () => {
  it('starts with an empty prompt so users do not need to delete a template', () => {
    render(<App />);

    expect(screen.getByLabelText('Prompt')).toHaveValue('');
  });
});
