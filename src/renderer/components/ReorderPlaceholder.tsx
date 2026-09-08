import type { PlaceholderBox } from '../reorder-stage';

interface Props {
  box: PlaceholderBox;
}

/**
 * The slot a dragged button came from.
 *
 * The button itself never leaves the flow, so the space is reserved to the
 * pixel with no reflow; this only marks it, with exactly the same width and
 * height, so the empty slot reads as a place the button belongs in rather than
 * as a hole. It is out of flow and inert, so it changes no measurement.
 */
export function ReorderPlaceholder({ box }: Props): JSX.Element {
  return (
    <span
      className={box.vertical ? 'reorder-slot reorder-slot--row' : 'reorder-slot'}
      aria-hidden="true"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
    />
  );
}
