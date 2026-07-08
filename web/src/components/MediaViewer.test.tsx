import { render } from '@testing-library/react';
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
  });
});
