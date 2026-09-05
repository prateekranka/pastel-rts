import { describe, expect, it } from 'vitest';
import { BoundedHistory, cloneEditorSnapshot, type EditorHistorySnapshot } from './history';

function snapshot(value: string, pendingImage: boolean): EditorHistorySnapshot {
  return {
    fields: { name: value },
    pendingImage: pendingImage
      ? { dataUrl: `data:image/png;base64,${value}`, name: `${value}.png`, width: 32, height: 32 }
      : null,
    selectedFrame: pendingImage ? 1 : 0,
  };
}

describe('BoundedHistory', () => {
  it('restores edit fields and pending image state with bounded undo/redo', () => {
    const history = new BoundedHistory<EditorHistorySnapshot>(3, cloneEditorSnapshot);
    history.seed(snapshot('original', false));
    history.push(snapshot('replacement', true));
    history.push(snapshot('tuned', true));

    expect(history.undo()).toEqual(snapshot('replacement', true));
    expect(history.undo()).toEqual(snapshot('original', false));
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual(snapshot('replacement', true));
    expect(history.redo()).toEqual(snapshot('tuned', true));
  });

  it('drops the oldest edit after the configured bound', () => {
    const history = new BoundedHistory<EditorHistorySnapshot>(2, cloneEditorSnapshot);
    history.seed(snapshot('a', false));
    history.push(snapshot('b', false));
    history.push(snapshot('c', false));
    history.push(snapshot('d', false));

    expect(history.undo()).toEqual(snapshot('c', false));
    expect(history.undo()).toEqual(snapshot('b', false));
    expect(history.undo()).toBeNull();
  });
});
