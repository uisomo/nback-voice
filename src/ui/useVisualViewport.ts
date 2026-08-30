import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** The part of `window.visualViewport` this needs, so DOM lib is not required. */
interface VisualViewportLike {
  height: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function visualViewport(): VisualViewportLike | undefined {
  if (Platform.OS !== 'web' || typeof globalThis === 'undefined') return undefined;
  return (globalThis as { visualViewport?: VisualViewportLike }).visualViewport;
}

/**
 * How tall the screen actually is right now, in web pixels — null everywhere
 * else.
 *
 * iOS Safari does not resize the page when the keyboard opens: it draws the
 * keyboard *over* it, and `window.innerHeight` goes on reporting the full
 * window. A layout measured against that puts the bottom of the content —
 * here, the last row of the 3×3 grid — behind the keyboard, where it cannot
 * be seen or tapped. `visualViewport.height` is the only figure that shrinks,
 * so it is what the round has to be laid out inside.
 *
 * On native, KeyboardAvoidingView already does this and there is no
 * visualViewport to read; returning null leaves that path untouched.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(
    () => visualViewport()?.height ?? null,
  );

  useEffect(() => {
    const viewport = visualViewport();
    if (!viewport) return;

    const update = () => setHeight(viewport.height);
    update();
    // 'scroll' as well as 'resize': Safari scrolls the visual viewport when
    // the focused field would otherwise sit under the keyboard, and that
    // moves the usable area without changing its size.
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}
