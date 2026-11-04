import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface PremiumDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export const PremiumDropdown: React.FC<PremiumDropdownProps> = ({
  options,
  value,
  onChange,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  required = false,
  disabled = false,
  className = '',
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [typeahead, setTypeahead] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadTimeout = useRef<number | null>(null);
  const closeTimeout = useRef<number | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const menuId = id ? `${id}-listbox` : undefined;
  const activeOptionId = open && activeIndex >= 0 && id ? `${id}-option-${activeIndex}` : undefined;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const maxHeight = Math.min(288, window.innerHeight * 0.55);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const openAbove = below < Math.min(220, maxHeight) && above > below;
    const height = Math.min(maxHeight, openAbove ? above : below);
    setPosition({
      top: openAbove ? Math.max(margin, rect.top - height - 6) : rect.bottom + 6,
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)),
      width: rect.width,
      maxHeight: Math.max(100, height),
    });
  };

  const openMenu = () => {
    if (disabled) return;
    if (closeTimeout.current !== null) window.clearTimeout(closeTimeout.current);
    setClosing(false);
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndices[0] ?? -1);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setClosing(true);
    if (closeTimeout.current !== null) window.clearTimeout(closeTimeout.current);
    closeTimeout.current = window.setTimeout(() => {
      setPosition(null);
      setClosing(false);
      closeTimeout.current = null;
    }, 140);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const selectOption = (option: DropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)
        && !document.getElementById(menuId || '')?.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('pointerdown', onOutsidePointer);
    document.addEventListener('keydown', onEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer);
      document.removeEventListener('keydown', onEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, menuId]);

  useEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => () => {
    if (typeaheadTimeout.current !== null) window.clearTimeout(typeaheadTimeout.current);
    if (closeTimeout.current !== null) window.clearTimeout(closeTimeout.current);
  }, []);

  const moveActive = (direction: 1 | -1) => {
    if (!enabledIndices.length) return;
    const currentPosition = enabledIndices.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? (direction === 1 ? 0 : enabledIndices.length - 1)
      : (currentPosition + direction + enabledIndices.length) % enabledIndices.length;
    setActiveIndex(enabledIndices[nextPosition]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) selectOption(options[activeIndex]);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) openMenu();
      setActiveIndex(event.key === 'Home' ? enabledIndices[0] ?? -1 : enabledIndices.at(-1) ?? -1);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const nextSearch = `${typeahead}${event.key}`.toLocaleLowerCase();
      setTypeahead(nextSearch);
      if (typeaheadTimeout.current !== null) window.clearTimeout(typeaheadTimeout.current);
      typeaheadTimeout.current = window.setTimeout(() => setTypeahead(''), 700);
      const match = enabledIndices.find((index) => options[index].label.toLocaleLowerCase().startsWith(nextSearch));
      if (match !== undefined) {
        if (!open) openMenu();
        setActiveIndex(match);
      }
    }
  };

  return (
    <div ref={rootRef} className="premium-dropdown relative min-w-0">
      {(name || required) && (
        <select
          ref={nativeRef}
          name={name}
          value={value}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="premium-dropdown-native"
          onChange={(event) => onChange(event.currentTarget.value)}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
            openMenu();
          }}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
        className={`premium-dropdown-trigger ${className}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedOption?.label || placeholder || ''}
        </span>
        <ChevronDown className={`premium-dropdown-chevron h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {(open || closing) && position && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          aria-hidden={!open}
          className={`premium-dropdown-menu ${closing ? 'is-closing' : ''}`}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => { optionRefs.current[index] = element; }}
                id={id ? `${id}-option-${index}` : undefined}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                className={`premium-dropdown-option ${selected ? 'is-selected' : ''} ${activeIndex === index ? 'is-active' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};
