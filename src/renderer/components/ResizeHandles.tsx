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
  { direction: 'n', className: 'resize--n', label: 'Redimensionar pelo topo', vertical: true },
  { direction: 's', className: 'resize--s', label: 'Redimensionar pela base', vertical: true },
  { direction: 'e', className: 'resize--e', label: 'Redimensionar pela direita', vertical: false },
  { direction: 'w', className: 'resize--w', label: 'Redimensionar pela esquerda', vertical: false },
  { direction: 'ne', className: 'resize--ne', label: 'Redimensionar pelo canto superior direito', vertical: true },
  { direction: 'nw', className: 'resize--nw', label: 'Redimensionar pelo canto superior esquerdo', vertical: true },
  { direction: 'se', className: 'resize--se', label: 'Redimensionar pelo canto inferior direito', vertical: true },
  { direction: 'sw', className: 'resize--sw', label: 'Redimensionar pelo canto inferior esquerdo', vertical: true },
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
