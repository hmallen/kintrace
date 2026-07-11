import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaViewer } from './MediaViewer';

function fileSrc(el: Element | null | undefined): string {
  return el?.getAttribute('src') ?? '';
}

describe('MediaViewer', () => {
  it('audio → audio element', () => {
    const { container } = render(
      <MediaViewer itemId={5} alt="Recording" mediaType="audio" />,
    );
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(fileSrc(audio)).toMatch(/\/api\/items\/5\/file$/);
  });

  it('video → video element', () => {
    const { container } = render(
      <MediaViewer itemId={6} alt="Clip" mediaType="video" />,
    );
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(fileSrc(video)).toMatch(/\/api\/items\/6\/file$/);
  });

  it('pdf → iframe', () => {
    const { container } = render(
      <MediaViewer itemId={7} alt="Document" mediaType="pdf" />,
    );
    const embedded = container.querySelector('iframe, embed');
    expect(embedded).not.toBeNull();
    expect(fileSrc(embedded)).toMatch(/\/api\/items\/7\/file$/);
  });

  it('image → img', () => {
    const { container } = render(
      <MediaViewer itemId={8} alt="Photo" mediaType="photo" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(fileSrc(img)).toMatch(/\/api\/items\/8\/file$/);
    expect(img?.closest('.print-scroll')).toHaveClass('is-fitted');
    expect(screen.getByRole('toolbar', { name: 'Photo view controls' })).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
  });

  it('zooms a fitted image and restores the fitted view', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MediaViewer itemId={8} alt="Photo" mediaType="photo" />,
    );

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('125%');
    expect(container.querySelector('.print-scroll')).not.toHaveClass('is-fitted');

    await user.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
    expect(container.querySelector('.print-scroll')).toHaveClass('is-fitted');
  });

  it('fits image files regardless of the item type', () => {
    const { container } = render(
      <MediaViewer
        itemId={9}
        alt="Scanned document"
        mediaType="pdf"
        filePath="archive/scanned-document.jpeg"
      />,
    );

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.print-scroll')).toHaveClass('is-fitted');
  });
});
