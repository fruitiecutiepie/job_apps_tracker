import { Fragment, useRef, type ReactNode } from 'react'
import { groupsOf, isGroup, type LayoutNode, type SplitNode, type TabGroup } from './notesLayout'

/**
 * How much of a split one arrow key moves its divider. Small enough to place a pane
 * deliberately, large enough that crossing a split does not take a hundred presses.
 */
export const RESIZE_STEP = 0.02

interface NotesLayoutViewProps {
  node: LayoutNode
  /** Draws one pane. The panel supplies this, since the notes' state all lives there. */
  renderGroup: (group: TabGroup) => ReactNode
  /** Moves one divider by a fraction of its split, positive towards the later pane. */
  onResize: (splitId: string, dividerIndex: number, delta: number) => void
  /** Which pane a group is, counting through the panel, for naming the dividers. */
  paneNumber: (groupId: string) => number
}

/** The first pane inside a node, which is what a divider beside it is named for. */
const firstPaneId = (node: LayoutNode): string => groupsOf(node)[0]?.id ?? ''

const lastPaneId = (node: LayoutNode): string => groupsOf(node).at(-1)?.id ?? ''

interface DividerProps {
  split: SplitNode
  index: number
  onResize: NotesLayoutViewProps['onResize']
  paneNumber: NotesLayoutViewProps['paneNumber']
}

/**
 * The handle between two panes.
 *
 * Dragging is the obvious way to use it and the only way that is no way at all without a
 * pointer, so it is a real `separator` with arrow keys — the same contract the table's
 * column handles already keep. jsdom has no layout, so the pointer path cannot be
 * asserted there and the keyboard path is what the tests drive; that is a reason to keep
 * the two paths through one `onResize` rather than a reason to leave either untested.
 */
function Divider({ split, index, onResize, paneNumber }: DividerProps) {
  const drag = useRef<{ from: number; total: number } | null>(null)
  const vertical = split.direction === 'row'

  const before = paneNumber(lastPaneId(split.children[index]))
  const after = paneNumber(firstPaneId(split.children[index + 1]))
  const share = Math.round((split.sizes[index] ?? 0) * 100)

  const onMouseMove = (event: MouseEvent) => {
    const held = drag.current
    if (!held || held.total <= 0) return
    const at = vertical ? event.clientX : event.clientY
    onResize(split.id, index, (at - held.from) / held.total)
    // Measured from the last position rather than the first, so the pane tracks the
    // pointer instead of accelerating away from it as the deltas accumulate.
    drag.current = { ...held, from: at }
  }

  const onMouseUp = () => {
    drag.current = null
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      aria-label={`Resize pane ${before} and pane ${after}`}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={share}
      className={`panel__resize panel__resize--${vertical ? 'vertical' : 'horizontal'}`}
      onKeyDown={(event) => {
        const back = vertical ? 'ArrowLeft' : 'ArrowUp'
        const on = vertical ? 'ArrowRight' : 'ArrowDown'
        if (event.key !== back && event.key !== on) return
        event.preventDefault()
        onResize(split.id, index, event.key === on ? RESIZE_STEP : -RESIZE_STEP)
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        const box = event.currentTarget.parentElement?.getBoundingClientRect()
        drag.current = {
          from: vertical ? event.clientX : event.clientY,
          total: (vertical ? box?.width : box?.height) ?? 0,
        }
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
      }}
      role="separator"
      tabIndex={0}
    />
  )
}

/**
 * Lays the panel's tree out as nested rows and columns of panes.
 *
 * The shape comes from `notesLayout`, which is where the arrangement is decided; this only
 * draws it. A child is sized by the fraction its split records rather than by an equal
 * share, so a pane the reader has widened stays widened when its neighbours change.
 *
 * Every level sets `min-width: 0; min-height: 0` in the stylesheet: a flex child defaults
 * to refusing to shrink below its content, and a note is wide, so without it a deep tree
 * would push the panel's own scrollbar out to the page instead of scrolling each note.
 */
export function NotesLayoutView({ node, renderGroup, onResize, paneNumber }: NotesLayoutViewProps) {
  if (isGroup(node)) return <>{renderGroup(node)}</>

  return (
    <div className={`panel__split panel__split--${node.direction}`}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? (
            <Divider
              index={index - 1}
              onResize={onResize}
              paneNumber={paneNumber}
              split={node}
            />
          ) : null}
          <div
            className="panel__split-child"
            style={{ flexBasis: `${(node.sizes[index] ?? 1 / node.children.length) * 100}%` }}
          >
            <NotesLayoutView
              node={child}
              onResize={onResize}
              paneNumber={paneNumber}
              renderGroup={renderGroup}
            />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
