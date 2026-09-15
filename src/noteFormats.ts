import { Bold, Heading2, Italic, List } from 'lucide-react'

/**
 * The marks the editor's toolbar writes, and what each one is called.
 *
 * Their own module because the buttons and the writing of them are drawn in different
 * places: the panel puts the buttons in a note's header row, where the editor beneath it
 * still owns the caret they act on.
 */
export interface Format {
  id: string
  title: string
  icon: typeof Bold
  wrap?: string
  prefix?: string
}

export const FORMATS: readonly Format[] = [
  { id: 'bold', title: 'Bold', icon: Bold, wrap: '**' },
  { id: 'italic', title: 'Italic', icon: Italic, wrap: '_' },
  { id: 'heading', title: 'Heading', icon: Heading2, prefix: '## ' },
  { id: 'bullet', title: 'Bullet point', icon: List, prefix: '- ' },
]
