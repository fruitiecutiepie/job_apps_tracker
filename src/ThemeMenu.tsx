import { useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { THEME_OPTIONS, useThemePreference, type ThemePreference } from './theme'

const ICONS: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

/**
 * The topbar's theme control: a disclosure over three radios, the same shape and the same
 * Escape, outside-press and focus-return contract as More actions. Radios rather than a
 * button cycling through three states, because a cycle hides two of the options and makes
 * the reader press through one they did not want to reach the one they did. The panel stays
 * open on a pick — arrow keys move a radio group's selection by clicking it, so closing on
 * click would shut the panel under anyone choosing from the keyboard.
 *
 * The trigger shows the preference, not the colour it resolves to: a monitor for System, so
 * following the OS reads as a choice that has been made rather than as whichever of the sun
 * or the moon happens to be up.
 */
export function ThemeMenu() {
  const [preference, setPreference, system] = useThemePreference()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const Icon = ICONS[preference]
  const current = THEME_OPTIONS.find((option) => option.id === preference)?.label
  const summary = preference === 'system' ? `${current} (${system})` : current

  return (
    <div className="actions-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Theme: ${summary}`}
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={`Theme: ${summary}`}
        type="button"
      >
        <Icon aria-hidden="true" size={18} />
      </button>
      {open && (
        <fieldset className="actions-menu__panel theme-menu">
          <legend className="theme-menu__legend">Theme</legend>
          {THEME_OPTIONS.map((option) => {
            const OptionIcon = ICONS[option.id]
            return (
              <label className="actions-menu__item theme-menu__option" key={option.id}>
                <input
                  aria-label={option.id === 'system' ? `${option.label}, currently ${system}` : undefined}
                  checked={preference === option.id}
                  className="sr-only"
                  name="theme"
                  onChange={() => setPreference(option.id)}
                  type="radio"
                  value={option.id}
                />
                <OptionIcon aria-hidden="true" size={16} />
                <span>{option.label}</span>
                {option.id === 'system' && (
                  <span aria-hidden="true" className="theme-menu__hint">
                    {system}
                  </span>
                )}
              </label>
            )
          })}
        </fieldset>
      )}
    </div>
  )
}
