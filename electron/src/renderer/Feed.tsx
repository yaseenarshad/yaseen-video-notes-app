import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { relativeDate } from '../core/feed'
import type { FeedItem, FeedState } from '../shared/api'

const name = (p: string): string => p.split('/').filter(Boolean).pop() ?? p
/** "/Users/x/Documents/…" → "~/Documents/…" (for display). */
const tildePath = (p: string): string => p.replace(/^\/Users\/[^/]+\//, '~/')

/**
 * The 📺 Feed view of a New Tab: the latest long-form videos of followed channels (never Shorts), apart from the
 * Library. Nothing goes into the vault's video folders until "Add to Library" (the same flow as pasting a link).
 */
export function FeedView({ feed, tabId, destination, onOpenFolder }: {
  feed: FeedState | null; tabId: string; destination: string; onOpenFolder: (folder: string) => void
}) {
  const [channel, setChannel] = useState<string>('all')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  /** The channel the typed-confirm "Unfollow…" dialog is open for. */
  const [unfollowing, setUnfollowing] = useState<{ id: string; title: string } | null>(null)
  const [, tick] = useState(0)

  // "2 hours ago" stays right while the page is open
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t) }, [])
  // a channel that is no longer followed is no filter
  useEffect(() => { if (channel !== 'all' && feed && !feed.channels.some((c) => c.id === channel)) setChannel('all') }, [feed, channel])

  const items = useMemo(() => (feed?.items ?? []).filter((i) => !hidden.has(i.id) && (channel === 'all' || i.channelId === channel)), [feed, hidden, channel])
  const current = feed?.channels.find((c) => c.id === channel)

  const follow = async () => {
    const v = input.trim()
    if (!v || busy) return
    setBusy(true)
    setError('')
    const err = await window.fa.feedFollow(v)
    setBusy(false)
    if (err) setError(err)
    else setInput('')
  }

  const channelMenu = async () => {
    const id = await window.fa.popup([
      { id: 'all', label: 'All channels', checked: channel === 'all' },
      { separator: true },
      ...(feed?.channels ?? []).map((c) => ({ id: 'ch:' + c.id, label: c.title, checked: channel === c.id })),
    ])
    if (id === 'all') setChannel('all')
    else if (id?.startsWith('ch:')) setChannel(id.slice(3))
  }

  const chipMenu = async (e: MouseEvent, id: string, title: string) => {
    e.preventDefault()
    const r = await window.fa.popup([
      { id: 'only', label: `Show Only ${title}` },
      { id: 'all', label: 'Show All Channels', enabled: channel !== 'all' },
      { separator: true },
      { id: 'unfollow', label: 'Unfollow…' },
    ])
    if (r === 'only') setChannel(id)
    else if (r === 'all') setChannel('all')
    else if (r === 'unfollow') setUnfollowing({ id, title })
  }

  const add = (i: FeedItem) => window.fa.create(tabId, i.url, destination)
  const hide = (i: FeedItem) => { setHidden((h) => new Set(h).add(i.id)); window.fa.feedHide(i.id) }

  const rowMenu = async (e: MouseEvent, i: FeedItem) => {
    e.preventDefault()
    const r = await window.fa.popup([
      i.folder ? { id: 'open', label: 'Open from Library' } : { id: 'add', label: `Add to Library (→ ${name(destination)})` },
      { id: 'hide', label: 'Hide' },
      { separator: true },
      { id: 'only', label: `Show Only ${i.channelTitle}` },
    ])
    if (r === 'open' && i.folder) onOpenFolder(i.folder)
    else if (r === 'add') add(i)
    else if (r === 'hide') hide(i)
    else if (r === 'only') setChannel(i.channelId)
  }

  const noChannels = feed !== null && feed.channels.length === 0
  return (
    <>
      <div className="listheader">
        <h2 className="listheader__title">📺 Feed</h2>
        {feed?.refreshing && <span className="spinner" title="Getting the latest videos…" />}
        <span className="grow" />
        {!noChannels && (
          <button className="togglebtn" onClick={channelMenu} title="Show one channel">
            {current ? current.title : 'All channels'} <span className="statusbtn__caret">⌄</span>
          </button>
        )}
        {!noChannels && <button className="togglebtn" disabled={feed?.refreshing} onClick={() => window.fa.feedRefresh()}>Refresh</button>}
      </div>
      <div className="followbar">
        <label className="followbox">
          <span className="followbox__plus">+</span>
          <input placeholder="Follow channel: @handle, channel link, or a video link" value={input} spellCheck={false}
            onChange={(e) => { setInput(e.target.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') void follow() }} />
          {busy ? <span className="spinner" /> : <button className="followbtn" disabled={!input.trim()} onClick={() => void follow()}>Follow</button>}
        </label>
        {error && <div className="linkerror">{error}</div>}
        {!!feed?.channels.length && (
          <div className="chips">
            {feed.channels.map((c) => (
              <span key={c.id} className={'fchip' + (channel === c.id ? ' fchip--on' : '') + (c.error ? ' fchip--err' : '')}
                title={c.error ? `${c.title}: ${c.error}` : `${c.title} · ${c.videos} video${c.videos === 1 ? '' : 's'}${c.fetchedAt ? ` · checked ${relativeDate(c.fetchedAt)}` : ''} · right-click to unfollow`}
                onContextMenu={(e) => chipMenu(e, c.id, c.title)}>
                <button className="fchip__name" onClick={() => setChannel(channel === c.id ? 'all' : c.id)}>
                  {c.error && <span className="fchip__warn">!</span>}{c.title}
                </button>
              </span>
            ))}
          </div>
        )}
        {current?.error && <div className="feednote">Could not check {current.title}: {current.error}</div>}
        {feed?.problems.map((p) => <div key={p} className="feednote">subscriptions.md: could not read {p}</div>)}
        {feed && (
          <div className="feedfile">
            The list is <button className="feedfile__link" title="Show in Finder" onClick={() => window.fa.showInFinder(feed.file)}>{tildePath(feed.file)}</button>
            {' '}— edit it to add (a line with <code>- </code> and a YouTube link) or remove channels.
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><span className="empty__emoji">📺</span></div>
          <div className="empty__text">{noChannels
            ? 'Follow a channel to see its latest videos here.\nThey stay out of your Library until you add one. Shorts are never shown.'
            : feed?.refreshing ? 'Getting the latest videos…' : 'No videos to show.'}</div>
        </div>
      ) : (
        <div className="feedlist">
          {items.map((i) => (
            <div key={i.id} className="feedrow" onContextMenu={(e) => rowMenu(e, i)} onDoubleClick={() => (i.folder ? onOpenFolder(i.folder) : undefined)}>
              <img className="feedrow__thumb" src={i.thumbnail} alt="" loading="lazy" draggable={false} />
              <div className="feedrow__main">
                <div className="feedrow__title" title={i.title}>{i.isNew && <span className="feedrow__new" title="New since you last looked" />}{i.title}</div>
                <div className="feedrow__meta">
                  <button className="feedrow__channel" onClick={() => setChannel(i.channelId)}>{i.channelTitle}</button>
                  <span> · </span><span title={new Date(i.published).toLocaleString()}>{relativeDate(i.published)}</span>
                  {i.duration && <><span> · </span><span>{i.duration}</span></>}
                </div>
              </div>
              <div className="feedrow__actions">
                {i.folder
                  ? <button className="inlib" title={`Open ${name(i.folder)}`} onClick={() => onOpenFolder(i.folder!)}>✓ In Library</button>
                  : <button className="addbtn" title={`Make the folder in ${name(destination)} and open it`} onClick={() => add(i)}>Add to Library</button>}
                <button className="hidebtn" title="Remove from the Feed for good" onClick={() => hide(i)}>Hide</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {unfollowing && (
        <UnfollowDialog title={unfollowing.title} onCancel={() => setUnfollowing(null)}
          onConfirm={() => { window.fa.feedUnfollow(unfollowing.id); setUnfollowing(null) }} />
      )}
    </>
  )
}

/**
 * Unfollowing is deliberate: the Unfollow button stays disabled until the field reads "unfollow" (any case,
 * trimmed). Esc / Cancel closes; Enter works only when enabled. Only then is the line removed from subscriptions.md.
 */
function UnfollowDialog({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  const [text, setText] = useState('')
  const ok = text.trim().toLowerCase() === 'unfollow'
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}>
      <div className="card" role="alertdialog" aria-modal="true" aria-labelledby="unfollow-title">
        <div className="card__title" id="unfollow-title">Unfollow {title}?</div>
        <div className="confirm__text">Its videos leave your Feed. Type <b>unfollow</b> to confirm.</div>
        <input className="confirm__input" autoFocus value={text} spellCheck={false} placeholder="unfollow" aria-label="Type unfollow to confirm"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok) onConfirm() } }} />
        <div className="card__buttons confirm__buttons">
          <button className="cancelbtn" onClick={onCancel}>Cancel</button>
          <button className="dangerbtn" disabled={!ok} onClick={onConfirm}>Unfollow</button>
        </div>
      </div>
    </div>
  )
}
