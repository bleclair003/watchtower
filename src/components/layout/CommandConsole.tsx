import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal } from 'lucide-react';
import { COMMAND_HELP, parseCommand, suggestCommands } from '../../lib/commands';
import { useDashboard } from '../../state/DashboardContext';
import { getRegion } from '@shared/domain/regions';

/**
 * Command / search field. Every command executes a real application action;
 * the response line reports what was actually done. Press "/" anywhere to focus.
 */
export function CommandConsole() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [response, setResponse] = useState<{ text: string; error: boolean } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const { setFilters, resetFilters, requestGlobalView, selectEvent } = useDashboard();

  const suggestions = open ? suggestCommands(value) : [];

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function run(input: string) {
    const cmd = parseCommand(input);
    setShowHelp(false);
    switch (cmd.kind) {
      case 'help':
        setShowHelp(true);
        setResponse({ text: `${COMMAND_HELP.length} COMMANDS AVAILABLE`, error: false });
        break;
      case 'navigate':
        navigate(cmd.to);
        setResponse({ text: `NAVIGATED ${cmd.to === '/' ? 'GOC' : cmd.to.slice(1).toUpperCase()}`, error: false });
        break;
      case 'map-global':
        requestGlobalView();
        navigate('/');
        setResponse({ text: 'MAP RESET — GLOBAL VIEW', error: false });
        break;
      case 'watch':
        setFilters({ regionId: cmd.regionId });
        selectEvent(null);
        navigate('/');
        setResponse({ text: `WATCH ${getRegion(cmd.regionId)?.shortCode} — FEED FILTERED, MAP FOCUSED`, error: false });
        break;
      case 'feed-source':
        setFilters({ sourceId: cmd.sourceId });
        navigate('/');
        setResponse({ text: `FEED FILTERED TO SOURCE ${cmd.sourceId.toUpperCase()}`, error: false });
        break;
      case 'search':
        setFilters({ keyword: cmd.keyword });
        navigate('/');
        setResponse({ text: cmd.keyword ? `KEYWORD FILTER "${cmd.keyword.toUpperCase()}"` : 'KEYWORD FILTER CLEARED', error: false });
        break;
      case 'clear':
        resetFilters();
        selectEvent(null);
        setResponse({ text: 'ALL FILTERS RESET', error: false });
        break;
      case 'error':
        setResponse({ text: cmd.message, error: true });
        break;
    }
    setValue('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Tab' && suggestions.length && value) {
      e.preventDefault();
      setValue(suggestions[active] ?? value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = open && suggestions.length && value && suggestions[active] && !suggestions[active].endsWith(' ')
        ? suggestions[active]
        : value;
      if (chosen.trim()) run(chosen);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setShowHelp(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="relative w-full max-w-md min-w-0">
      <div className="flex h-7 items-center gap-1.5 border border-wt-line-strong bg-wt-bg px-2 focus-within:border-wt-info">
        <Terminal size={12} className="shrink-0 text-wt-fg-muted" aria-hidden />
        <span className="text-wt-fg-muted" aria-hidden>&gt;</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="COMMAND OR SEARCH  ( / )"
          aria-label="Command or search"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={suggestions.length > 0}
          role="combobox"
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-wt-fg uppercase placeholder:text-wt-fg-dim placeholder:normal-case focus:outline-none"
        />
      </div>
      {response && !open && (
        <p
          role="status"
          className={`absolute top-full left-0 z-30 mt-0.5 text-2xs tracking-wider ${response.error ? 'text-wt-warn' : 'text-wt-fg-muted'}`}
        >
          {response.error ? '!! ' : '>> '}
          {response.text}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-40 mt-px border border-wt-line-strong bg-wt-panel py-0.5 shadow-lg shadow-black"
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                if (s.endsWith(' ')) {
                  setValue(s);
                  inputRef.current?.focus();
                } else run(s);
              }}
              className={`cursor-pointer px-2 py-0.5 text-xs ${i === active ? 'bg-wt-fg text-wt-bg' : 'text-wt-fg-muted'}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      {showHelp && (
        <div className="absolute top-full right-0 left-0 z-40 mt-5 border border-wt-line-strong bg-wt-panel p-2 shadow-lg shadow-black">
          <div className="mb-1 flex items-center justify-between text-2xs text-wt-fg-dim">
            <span>COMMAND REFERENCE</span>
            <button className="hover:text-wt-fg" onClick={() => setShowHelp(false)}>[CLOSE]</button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
            {COMMAND_HELP.map((c) => (
              <div key={c.syntax} className="contents">
                <dt className="text-wt-fg">{c.syntax}</dt>
                <dd className="text-wt-fg-muted">{c.description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-2xs text-wt-fg-dim">Any other input is applied as a keyword filter.</p>
        </div>
      )}
    </div>
  );
}
