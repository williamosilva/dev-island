import type { BoundsDirection } from '../../shared/api';
import { useWindowGesture } from '../useWindowGesture';

interface Props {
  /**
   * A panel is open, so the window has a height worth dragging. The compact
   * capsule has a fixed height and only resizes horizontally.
   */
  resizableHeight: boolean;
}

interface HandleSpec {
  direction: Exclude<BoundsDirection, 'move'>;
  className: string;
  label: string;
  /** Only meaningful once a panel gives the window a height to change. */
  vertical: boolean;
}

const HANDLES: readonly HandleSpec[] = [
  { direction: 'n', className: 'resize--n', label: 'Resize from the top', vertical: true },
  { direction: 's', className: 'resize--s', label: 'Resize from the bottom', vertical: true },
  { direction: 'e', className: 'resize--e', label: 'Resize from the right', vertical: false },
  { direction: 'w', className: 'resize--w', label: 'Resize from the left', vertical: false },
  { direction: 'ne', className: 'resize--ne', label: 'Resize from the top-right corner', vertical: true },
  { direction: 'nw', className: 'resize--nw', label: 'Resize from the top-left corner', vertical: true },
  { direction: 'se', className: 'resize--se', label: 'Resize from the bottom-right corner', vertical: true },
  { direction: 'sw', className: 'resize--sw', label: 'Resize from the bottom-left corner', vertical: true },
];

function Handle({ spec }: { spec: HandleSpec }): JSX.Element {
  const gesture = useWindowGesture(spec.direction);
  return (
    <div
      className={`resize ${spec.className}`}
      role="separator"
      aria-label={spec.label}
      title={spec.label}
      {...gesture}
    />
  );
}

/**
 * All eight edges and corners. The compact capsule keeps only the two
 * horizontal edges: it has a fixed height, so a vertical cursor there would
 * promise something that cannot happen.
 */
export function ResizeHandles({ resizableHeight }: Props): JSX.Element {
  const handles = resizableHeight ? HANDLES : HANDLES.filter((spec) => !spec.vertical);
  return (
    <>
      {handles.map((spec) => (
        <Handle key={spec.direction} spec={spec} />
      ))}
    </>
  );
}
