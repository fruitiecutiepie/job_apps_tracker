import { afterEach, describe, expect, it } from 'vitest'

import { describeChange, describeClick, describeKey, FEEDBACK_UI_ATTRIBUTE } from './steps'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('naming a click', () => {
  it('names a button by its accessible name, from wherever inside it was pressed', () => {
    const root = mount('<button aria-label="Move Acme to Interview 2"><svg><path /></svg></button><button><span>Add application</span></button>')
    expect(describeClick(root.querySelector('path'))).toBe('Clicked button “Move Acme to Interview 2”')
    expect(describeClick(root.querySelector('span'))).toBe('Clicked button “Add application”')
  })

  it('names tabs and links by their role', () => {
    const root = mount('<div role="tab">Offer</div><a href="#x">Docs</a>')
    expect(describeClick(root.querySelector('[role=tab]'))).toBe('Clicked tab “Offer”')
    expect(describeClick(root.querySelector('a'))).toBe('Clicked link “Docs”')
  })

  it('ignores clicks on plain text, which may be somebody’s notes', () => {
    const root = mount('<p>My private interview notes</p>')
    expect(describeClick(root.querySelector('p'))).toBeNull()
  })

  it('leaves fields to their change rather than recording the click into them', () => {
    const root = mount('<label>Company <input type="text"></label><textarea></textarea><input type="checkbox">')
    expect(describeClick(root.querySelector('input[type=text]'))).toBeNull()
    expect(describeClick(root.querySelector('textarea'))).toBeNull()
    expect(describeClick(root.querySelector('input[type=checkbox]'))).toBeNull()
    expect(describeClick(root.querySelector('label'))).toBeNull()
  })

  it('never records the feedback panel itself', () => {
    const root = mount(`<div ${FEEDBACK_UI_ATTRIBUTE}><button>Send</button></div>`)
    expect(describeClick(root.querySelector('button'))).toBeNull()
  })
})

describe('naming a change', () => {
  it('says which field was edited and never what was typed into it', () => {
    const root = mount('<label>Company <input type="text"></label>')
    const input = root.querySelector('input')!
    input.value = 'Secret Employer Pty Ltd'
    const step = describeChange(input)
    expect(step).toBe('Edited “Company”')
    expect(step).not.toContain('Secret')
  })

  it('says what a menu was set to, with the label free of the options', () => {
    const root = mount('<label>Stage <select><option>Applied</option><option selected>Interview 1</option></select></label>')
    expect(describeChange(root.querySelector('select'))).toBe('Set “Stage” to “Interview 1”')
  })

  it('says whether a box was ticked', () => {
    const root = mount('<label><input type="checkbox" checked> Archived</label>')
    expect(describeChange(root.querySelector('input'))).toBe('Ticked “Archived”')
  })
})

describe('naming a key', () => {
  const press = (init: Partial<KeyboardEvent>) => ({
    key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, ...init,
  })

  it('records shortcuts by the key cap, even where a modifier rewrote the character', () => {
    expect(describeKey(press({ key: 'π', code: 'KeyP', metaKey: true, altKey: true }), true)).toBe('Pressed ⌥⌘P')
    expect(describeKey(press({ key: 'p', code: 'KeyP', ctrlKey: true }), false)).toBe('Pressed Ctrl+P')
  })

  it('records Escape and nothing that is plain typing', () => {
    expect(describeKey(press({ key: 'Escape', code: 'Escape' }), true)).toBe('Pressed Escape')
    expect(describeKey(press({ key: 'a', code: 'KeyA' }), true)).toBeNull()
    expect(describeKey(press({ key: 'A', code: 'KeyA', shiftKey: true }), true)).toBeNull()
    expect(describeKey(press({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)).toBeNull()
  })
})
