import { useEffect, useRef } from 'react'
import { ChevronDown, Terminal, X } from 'lucide-react'
import type { LogLevel } from '../gmail'

export interface LogLine { t: string; level: LogLevel; msg: string }
interface Props { lines: LogLine[]; busy: boolean; open: boolean; onToggle: () => void; onClear: () => void }

export default function SyncLog({ lines, busy, open, onToggle, onClear }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open && box.current) box.current.scrollTop = box.current.scrollHeight }, [lines, open])
  const last = lines[lines.length - 1]
  return <section className="synclog">
    <header>
      <button className="synclog-toggle" onClick={onToggle} aria-expanded={open}>
        <Terminal size={14} /> Sync log {busy && <span className="live-dot" aria-label="running" />}
        <span className="synclog-last">{!open && last ? last.msg : ''}</span>
        <ChevronDown size={14} className={open ? 'flip' : ''} />
      </button>
      {!busy && <button className="clear-x" onClick={onClear} aria-label="Clear sync log"><X size={14} /></button>}
    </header>
    {open && <div className="synclog-body" ref={box} role="log" aria-live="off">
      {lines.map((l, i) => <div key={i} className={`log-line ${l.level.toLowerCase()}`}><time>{l.t}</time><b>{l.level}</b><span>{l.msg}</span></div>)}
    </div>}
  </section>
}
