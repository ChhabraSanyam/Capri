/**
 * Entry page loading state (task 27.1, Requirement 28.1). Fills the `#capri-load` section of
 * `index.html`, whose static text covers the app bundle download, with the Avatar (VRM) and
 * Voice_Library progress from the `LoadingStatus` board. The voice model has its own progress bar
 * (`model-preload-view.ts`), so it is left out here. Enter AR is never disabled by it.
 */
import type { LoadingSnapshot } from '../../app/loading-status.js';
import { describeLoading } from '../../domain/loading-view.js';

export interface LoadingStatusLike {
  readonly value: LoadingSnapshot;
  subscribe(listener: (snapshot: LoadingSnapshot) => void): () => void;
}

/** Replace the contents of `mount` with the live loading state. Returns a disposer. */
export function mountCapriLoad(mount: HTMLElement, status: LoadingStatusLike): () => void {
  const doc = mount.ownerDocument;
  const title = doc.createElement('p');
  const titleText = doc.createElement('strong');
  title.append(titleText);
  const detail = doc.createElement('p');
  const bar = doc.createElement('progress');
  bar.max = 1;
  bar.setAttribute('aria-label', 'Avatar download');
  const list = doc.createElement('ul');
  mount.replaceChildren(title, detail, bar, list);

  const render = (snapshot: LoadingSnapshot): void => {
    const view = describeLoading({ avatar: snapshot.avatar, voiceLines: snapshot.voiceLines, where: 'page' });
    titleText.textContent = view.title;
    detail.textContent = view.detail;
    mount.dataset.state = view.failed ? 'failed' : snapshot.avatar.phase;
    if (snapshot.avatar.phase === 'loading') {
      bar.hidden = false;
      if (view.avatarFraction === undefined) bar.removeAttribute('value');
      else bar.value = view.avatarFraction;
    } else {
      bar.hidden = true;
    }
    const items = view.lines.map((line) => {
      const item = doc.createElement('li');
      item.textContent = line.text;
      item.dataset.state = line.state;
      return item;
    });
    list.replaceChildren(...items);
  };
  render(status.value);
  return status.subscribe(render);
}
