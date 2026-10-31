import { describe, expect, it } from 'vitest';
import { OVERFLOW_ORDER, hiddenItems } from '../src/ui/toolbarOverflow';

const page = ['toggle-sidebar', 'toggle-inspector', 'delete-selection', 'fit', 'zoom-selection', 'find', 'note-tool', 'duct-tool', 'ruler'];

describe('the buttons that go into the More menu', () => {
  it('are the least used first, and none for a toolbar that fits', () => {
    expect(hiddenItems(page, OVERFLOW_ORDER, 0)).toEqual([]);
    expect(hiddenItems(page, OVERFLOW_ORDER, 1)).toEqual(['ruler']);
    expect(hiddenItems(page, OVERFLOW_ORDER, 2)).toEqual(['duct-tool', 'ruler']);
  });

  it('are listed in the order they stand on the page, not in the order they went', () => {
    expect(hiddenItems(page, OVERFLOW_ORDER, 6)).toEqual(['fit', 'zoom-selection', 'find', 'note-tool', 'duct-tool', 'ruler']);
  });

  it('keep Undo, and the buttons for the library and the inspector that a narrow window opens its drawers with, to the last', () => {
    expect(OVERFLOW_ORDER.slice(-3)).toEqual(['toggle-inspector', 'toggle-sidebar', 'undo']);
    expect(hiddenItems(page, OVERFLOW_ORDER, 8)).not.toContain('toggle-sidebar');
  });

  it('are only the ones that are on the page', () => {
    expect(hiddenItems(['fit', 'ruler'], OVERFLOW_ORDER, 99)).toEqual(['fit', 'ruler']);
  });
});
