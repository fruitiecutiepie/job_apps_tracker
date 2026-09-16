import { describe, expect, it } from 'vitest'

import css from '../styles.css?raw'

/** The declarations of one rule, by selector, so a block can be asserted on as a whole. */
function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))
  if (!match) throw new Error(`no rule for ${selector}`)
  return match[1]
}

describe('dialog actions', () => {
  it('pins delete, cancel and save to the bottom of the scrolling dialog', () => {
    const body = ruleBody('.dialog__actions')

    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/bottom:\s*calc\(var\(--s5\) \* -1\)/)
    // Opaque, or the fields scrolling underneath would show through the row.
    expect(body).toMatch(/background:\s*var\(--surface\)/)
    // The dialog is the scroll container, so nothing between may clip the row.
    expect(ruleBody('.dialog')).toMatch(/overflow-y:\s*auto/)
  })
})

describe('idle pill', () => {
  it('reads as a chip on the recessed card, in tokens only', () => {
    const body = ruleBody('.application-card__idle')

    expect(body).toMatch(/border-radius:\s*var\(--pill\)/)
    // The card behind it is --surface-3 when idle, so a --surface-3 chip would vanish.
    expect(body).toMatch(/background:\s*var\(--surface\)/)
    expect(ruleBody('.application-card--idle')).toMatch(/background:\s*var\(--surface-3\)/)
    // Silence is a nudge, not an alarm: no accent, no danger, and no raw values.
    expect(body).not.toMatch(/--accent|--danger/)
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(body).toMatch(/padding:\s*0 var\(--s2\)/)
    expect(body).toMatch(/font-size:\s*var\(--t1\)/)
    // The 1px hairline is the card's own border convention; every colour is a token.
    expect(body).toMatch(/border:\s*1px solid var\(--line\)/)
  })
})

describe('shortcut keys', () => {
  it('draws the key chip from the token scale, like every other chip', () => {
    const body = ruleBody('.panel__shortcut-key')

    expect(body).toMatch(/border:\s*1px solid var\(--line-strong\)/)
    expect(body).toMatch(/border-radius:\s*var\(--r1\)/)
    expect(body).toMatch(/background:\s*var\(--surface-2\)/)
    expect(body).toMatch(/font-size:\s*var\(--t1\)/)
    // A key is a label, not a state: no accent, no danger, and no raw values.
    expect(body).not.toMatch(/--accent|--danger/)
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    // The 1px hairline is the interface's own border convention; nothing else is raw.
    expect(body.replace(/1px solid/g, '')).not.toMatch(/\d+px/)
    // The popover hangs off the trigger, so the trigger has to be the containing block.
    expect(ruleBody('.panel__shortcuts')).toMatch(/position:\s*relative/)
    expect(ruleBody('.panel__shortcuts-panel')).toMatch(/position:\s*absolute/)
  })
})

describe('a closed sidebar', () => {
  it('leaves its edge and nothing else', () => {
    // The control that brings it back is in the title bar, so the column has nothing to
    // hold but the handle the sidebar is pulled out by — one handle wide, where a rail
    // kept for one button was forty.
    expect(ruleBody('.panel__body--rail')).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/)
    expect(ruleBody('.panel__sidebar-resize')).toMatch(/width:\s*var\(--pane-handle\)/)
    expect(ruleBody('.panel__sidebar')).toMatch(/background:\s*var\(--surface-2\)/)
  })
})

describe('pane handles and drop zones', () => {
  it('sizes the handle from a token and gives it a cursor for the axis it moves on', () => {
    const handle = ruleBody('.panel__resize')

    expect(handle).toMatch(/flex:\s*0 0 var\(--pane-handle\)/)
    expect(handle).toMatch(/background:\s*var\(--line\)/)
    // The pointer owns the handle for the length of a drag, or a touch drag scrolls the
    // panel out from under it instead of moving the divider.
    expect(handle).toMatch(/touch-action:\s*none/)
    expect(handle.replace(/1px solid/g, '')).not.toMatch(/\d+px/)
    expect(handle).not.toMatch(/#[0-9a-fA-F]{3,8}/)

    expect(ruleBody('.panel__resize--vertical')).toMatch(/cursor:\s*col-resize/)
    expect(ruleBody('.panel__resize--horizontal')).toMatch(/cursor:\s*row-resize/)
  })

  it('lays the drop zones over the pane without covering its middle', () => {
    expect(ruleBody('.panel__dropzones')).toMatch(/position:\s*absolute/)
    // Over the note, and over the sticky header and dock the pane pins at z-index 2.
    expect(ruleBody('.panel__dropzones')).toMatch(/z-index:\s*3/)
    /*
     * The note half of the pane is the containing block, not the whole pane. Measured from
     * the pane the zones covered its tab strip too, and since they sit on top of
     * everything, a drop aimed at a tab found an edge zone instead of the tab's own slot.
     */
    expect(ruleBody('.panel__group-body')).toMatch(/position:\s*relative/)
    expect(ruleBody('.panel__group')).not.toMatch(/position:\s*relative/)

    const zone = ruleBody('.panel__dropzone')
    // A third a side leaves the middle clear, so a drag can still be abandoned over the
    // note rather than every pointer-up somewhere in the pane splitting a pane open.
    expect(zone).toMatch(/width:\s*33%/)
    expect(zone).toMatch(/height:\s*100%/)

    // The edge being aimed at reads in the accent, like every other drop target here.
    expect(ruleBody('.panel__dropzone--over')).toMatch(/background:\s*var\(--accent-weak\)/)
    expect(ruleBody('.panel__dropzone--over')).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})

describe('context bar buttons', () => {
  it('keeps every filter-row button label on one line', () => {
    // A flex item shrinks below its content by default, and a button narrower than its
    // own two words is what a wrapped label looks like. Scoped to the row rather than to
    // one button's wrapper, so a button added here cannot quietly get the old behaviour.
    const body = ruleBody('.context-bar__filters .button')

    expect(body).toMatch(/white-space:\s*nowrap/)
    // Nothing to shrink means the selects give the width up instead, down to the floors
    // they set for themselves.
    expect(body).toMatch(/flex:\s*none/)
  })
})

describe('prep notes view', () => {
  it('sizes the panel against the header rather than the whole viewport', () => {
    const body = ruleBody('.panel-view')

    // The panel sits under the topbar and the context bar now. It takes what they leave
    // through the column above it, rather than a viewport height minus a guess at theirs.
    expect(body).toMatch(/height:\s*100%/)
    // Its own height, that is — the `max-height` beside it is the cap, not the sizing.
    expect(body).not.toMatch(/(?<!max-)height:\s*100(?:d|l)?vh/)
    expect(ruleBody('.app-shell')).toMatch(/flex-direction:\s*column/)
    expect(ruleBody('.app-shell > main')).toMatch(/flex:\s*1/)

    // The panel's own chrome is the frame; the surface around it adds nothing.
    const surface = ruleBody('.view-surface--panel')
    expect(surface).toMatch(/flex:\s*1/)
    expect(surface).toMatch(/padding:\s*0/)
    expect(surface).not.toMatch(/\d+px|#[0-9a-fA-F]{3,8}/)
  })

  it('holds the panel inside the viewport rather than letting the page grow past it', () => {
    // The panel pins its own chrome, so a page scrolling behind it would carry the title
    // bar and the status bar off screen. The shell is pinned to the viewport instead.
    // Matched straight off the file: `ruleBody` names a rule by a plain class selector,
    // and this one is a functional pseudo-class with its own parentheses.
    const shell = css.match(/\n\.app-shell:has\(\.view-surface--panel\) \{([^}]*)\}/)![1]
    expect(shell).toMatch(/height:\s*100dvh/)
    expect(shell).toMatch(/overflow:\s*hidden/)
    // A minimum outranks a maximum, so the shell's own `min-height: 100vh` has to go with
    // it or it would win over the cap on exactly the viewports the cap exists for.
    expect(shell).toMatch(/min-height:\s*0/)
    expect(ruleBody('.panel-view')).toMatch(/max-height:\s*100dvh/)
  })

  it('lays the panel out against its own width, not the window\'s', () => {
    // The panel had the whole viewport while it was a modal, so window width and panel
    // width were the same measurement. In a view they are not: the surface around it
    // takes a gutter each side, and the window says nothing about what the panel has.
    expect(ruleBody('.panel-view')).toMatch(/container-type:\s*inline-size/)
    expect(ruleBody('.panel-view')).toMatch(/container-name:\s*panel/)

    const narrowPanel = css.slice(css.indexOf('@container panel (max-width: 760px)'))
    expect(narrowPanel).toMatch(/\.panel__body \{/)
    expect(narrowPanel).toMatch(/\.panel__split--row \{/)

    // And those rules are gone from the viewport query they used to live in.
    const narrowWindow = css.slice(
      css.indexOf('@media (max-width: 760px)'),
      css.indexOf('@media (max-width: 520px)'),
    )
    expect(narrowWindow).not.toMatch(/\.panel__body \{/)
    expect(narrowWindow).not.toMatch(/\.panel__split--row \{/)
  })

  it('lets the notes column narrow to the panel instead of to its own content', () => {
    // A grid item in `.panel__main`, whose single column is `auto`: an auto track is at
    // least its item's min-content, and the notes' min-content runs to about a thousand
    // pixels. Left at `auto` the column takes that width whatever the panel was given, and
    // the panel clips the difference — the breadcrumbs, the tab strip's end, the status bar
    // and the right of every note go off the edge instead of the column narrowing.
    expect(ruleBody('.panel__notes')).toMatch(/min-width:\s*0/)
  })

  it('keeps the note header to one row, the name having gone from it entirely', () => {
    // The header's parts want some seven hundred pixels between them, and in a split pane
    // a plain wrap gave each of them a line of its own. The name gave way first by
    // truncating; it is `sr-only` now, the tab above carrying it in full, so what is left
    // is controls that keep their width and wrap as one piece rather than splitting up.
    expect(ruleBody('.stage-note__actions')).toMatch(/flex:\s*none/)
  })

  it('caps the captured lines against the note they are docked under', () => {
    // The height the handle sets is the reader's ask; this is what stops it being granted
    // in full when the pane has not got it. Without the cap, dragging to the top of the
    // range left the note a single line high.
    const dock = ruleBody('.panel__notes .stage-note > .stage-note__dock')
    expect(dock).toMatch(/max-height:\s*var\(--capture-max\)/)
    // The whole dock is capped, so the log is the part that has to give.
    expect(ruleBody('.stage-note__log')).toMatch(/min-height:\s*0/)
    expect(ruleBody('.stage-note__log')).toMatch(/max-height:\s*var\(--capture-log\)/)
    // A handle, not a border: it takes the pointer for the length of a drag.
    expect(ruleBody('.stage-note__dock-resize')).toMatch(/touch-action:\s*none/)
    expect(ruleBody('.stage-note__dock-resize')).toMatch(/cursor:\s*row-resize/)
  })

  it('insets a pane once rather than three times over', () => {
    // The pane, the note's body and the note's header each inset what is inside them, and
    // three roomy frames around one column of text cost more of a split pane than any of
    // them is worth. All three sit a step down the scale from a form's spacing.
    expect(ruleBody('.panel__pane')).toMatch(/padding:\s*var\(--s3\)/)
    expect(ruleBody('.panel__notes .stage-note__body')).toMatch(/padding:\s*0 var\(--s3\) var\(--s3\)/)
    expect(ruleBody('.panel__notes .stage-note__header')).toMatch(/padding:\s*var\(--s2\) var\(--s3\)/)
  })

  it('sizes the tab strip by the chrome measure', () => {
    // A strip of tabs is chrome, and takes the dense measure the rest of the chrome does
    // rather than the form measure a button would inherit.
    expect(ruleBody('.panel__tab')).toMatch(/min-height:\s*var\(--control\)/)
  })

  it('leaves only the edge when the sidebar is closed', () => {
    // One handle wide, where a rail kept for one button was forty. What brings the sidebar
    // back is in the title bar, so the column has nothing left to hold.
    expect(ruleBody('.panel__body')).toMatch(/grid-template-columns:\s*var\(--sidebar\) auto minmax\(0, 1fr\)/)
    expect(ruleBody('.panel__body--rail')).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/)
  })

  it('marks a tree row by what it is rather than by colour alone', () => {
    // The open note carries a stronger guide and darker text; the one being read carries
    // the accent as well. Both read as a change in weight before they read as a hue.
    expect(ruleBody('.notes-tree__note--open')).toMatch(/border-left-color:\s*var\(--line-strong\)/)
    expect(ruleBody('.notes-tree__note--current')).toMatch(/border-left-color:\s*var\(--accent\)/)
    // The same indent guide the outline draws, so one sidebar reads as one sidebar.
    expect(ruleBody('.notes-tree__note')).toMatch(/border-left:\s*2px solid var\(--line\)/)
  })

  it('ends a search hit in an ellipsis rather than past the sidebar', () => {
    // A snippet is one long line in a flex row, so without a floor of zero the row refuses
    // to shrink below it and the ellipsis never arrives — the words run off the edge.
    expect(ruleBody('.notes-tree__hit')).toMatch(/min-width:\s*0/)
    // And every list above it, each being a grid item with the same refusal to shrink:
    // the rule they share is named by its last selector.
    expect(ruleBody('.notes-tree__hits > li')).toMatch(/min-width:\s*0/)
    const text = ruleBody('.notes-tree__hit-text')
    expect(text).toMatch(/min-width:\s*0/)
    expect(text).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('lets the sidebar narrow to its floor without anything hanging past it', () => {
    // The shared search field holds a 9rem floor — right in the context bar, wider than
    // the whole sidebar at its narrowest — so this is where it gives that width up.
    expect(ruleBody('.notes-tree__search')).toMatch(/min-width:\s*0/)
    expect(ruleBody('.search-field')).toMatch(/min-width:\s*9rem/)
    // And the input inside it, which keeps an intrinsic width of its own: the rule that
    // sizes the context bar's copy is scoped to that bar and never reaches this one.
    expect(ruleBody('.notes-tree__search input')).toMatch(/width:\s*100%/)
    // A long stage heading gives way; the count beside it does not.
    expect(ruleBody('.notes-tree__stage-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(ruleBody('.notes-tree__count')).toMatch(/flex:\s*none/)
  })

  it('draws the title bar controls as icons rather than boxes', () => {
    // Five outlined buttons are five frames inside a bar that already has one. The box
    // comes back under the pointer, which is when it says something.
    const chrome = ruleBody('.panel__chrome-button')
    expect(chrome).toMatch(/border-color:\s*transparent/)
    expect(chrome).toMatch(/background:\s*none/)
    expect(ruleBody('.panel__chrome-button:hover:not\\(:disabled\\)')).toMatch(/background:\s*var\(--surface-3\)/)
    // Pressed is a state of the thing the button controls, so it reads as the accent.
    expect(ruleBody(".panel__chrome-button\\[aria-pressed='true'\\]")).toMatch(/--accent/)
  })

  it('says where you are on the header control, not only what you pressed', () => {
    // The workspace is a layer over a view rather than one of the views in the strip, so it
    // cannot borrow their underline — and a quiet button that looks the same open as shut
    // answers the one question it is asked, "am I in there", with nothing at all.
    const pressed = ruleBody(".topbar__notes\\[aria-pressed='true'\\]")
    expect(pressed).toMatch(/background:\s*var\(--accent-weak\)/)
    expect(pressed).toMatch(/border-color:\s*var\(--accent\)/)
    expect(pressed).toMatch(/color:\s*var\(--accent\)/)
  })

  it('keeps a word on Open while the rest of the bar is bare', () => {
    // It is the way to a note not on screen yet, which is when an icon helps least.
    expect(ruleBody('.panel__chrome-button--labelled')).toMatch(/padding:\s*0 var\(--s3\)/)
    expect(ruleBody('.panel__chrome-key')).toMatch(/font-size:\s*var\(--t1\)/)
  })

  it('tints the tab as well as the slot a drag is aimed at', () => {
    // The tab a pane is showing paints its own opaque surface, which sits over the slot
    // behind it: without this the drop mark showed on every tab except the one you were
    // most likely to aim at, and a pane holding one tab never showed it at all.
    expect(ruleBody('.panel__tab-slot--drop-target .panel__tab')).toMatch(/background:\s*var\(--accent-weak\)/)
    // Both selectors are two classes deep, so source order is what decides between them.
    expect(css.indexOf('.panel__tab--open')).toBeLessThan(
      css.indexOf('.panel__tab-slot--drop-target .panel__tab'),
    )
  })

  it('wraps the chrome rather than letting a narrow panel clip it', () => {
    // The panel clips its own overflow, so a title bar that cannot wrap loses its last
    // control rather than scrolling to it. The stage header already wraps for this reason.
    expect(ruleBody('.panel__titlebar')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('sizes the panel buttons before the chrome narrows them again', () => {
    // Both rules are one class deep, so source order is what decides between them: the
    // dense chrome has to come after the panel-wide rule it is undoing.
    expect(ruleBody('.panel .button')).toMatch(/min-height:\s*var\(--control-form\)/)
    expect(css.indexOf('.panel .button')).toBeLessThan(css.indexOf('.panel__titlebar .button'))
  })

  it('promotes the whole places cell to its own row when the bar is tight, not the strip inside it', () => {
    // The strip is a flex item of that cell now, so grid placement on it is ignored while
    // any `order` it carried is not — which reorders the strip past the toggle beside it.
    const narrow = css.slice(css.indexOf('@media (max-width: 1000px)'))
    const block = narrow.slice(0, narrow.indexOf('@media', 1))

    expect(block).toMatch(/\.topbar__places\s*\{[^}]*grid-row: 2/)
    expect(block).not.toMatch(/\.view-nav\s*\{[^}]*order:/)
  })
})
