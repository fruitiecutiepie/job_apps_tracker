import type { ReactNode } from 'react'
import { isGroup, type LayoutNode, type TabGroup } from './notesLayout'

interface NotesLayoutViewProps {
  node: LayoutNode
  /** Draws one pane. The panel supplies this, since the notes' state all lives there. */
  renderGroup: (group: TabGroup) => ReactNode
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
export function NotesLayoutView({ node, renderGroup }: NotesLayoutViewProps) {
  if (isGroup(node)) return <>{renderGroup(node)}</>

  return (
    <div className={`panel__split panel__split--${node.direction}`}>
      {node.children.map((child, index) => (
        <div
          className="panel__split-child"
          key={child.id}
          style={{ flexBasis: `${(node.sizes[index] ?? 1 / node.children.length) * 100}%` }}
        >
          <NotesLayoutView node={child} renderGroup={renderGroup} />
        </div>
      ))}
    </div>
  )
}
