import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from './main';

afterEach(() => cleanup());

describe('Meowversee prompt input', () => {
  it('starts with an empty prompt so users do not need to delete a template', () => {
    render(<App />);

    expect(screen.getByLabelText('Prompt')).toHaveValue('');
  });
  it('notifies when selected motion files exceed their size limits', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motion control' }));

    const oversizeImage = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'besar.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Gambar Referensi/i), { target: { files: [oversizeImage] } });

    expect(screen.getByText(/File Gambar Referensi terlalu besar/i)).toBeInTheDocument();
    expect(screen.getByText(/maksimal 10\.0 MB/i)).toBeInTheDocument();
  });
});
